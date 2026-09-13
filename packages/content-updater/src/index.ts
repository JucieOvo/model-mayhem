/**
 * 系统内容更新管理器。
 *
 * 作者：JucieOvo
 *
 * 更新过程采用 A-B-C 单回滚点：安装 C 前备份玩家数据，成功后将 B 提升为新的
 * 回滚点并清理旧 A。内容指针、玩家数据库恢复和回滚使用持久事务记录，进程在
 * 关键步骤退出后会在下一次启动补全，避免内容与玩家数据错配。
 */

import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  ContentInstallation,
  UpdateChannel,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateRollbackResult,
  UpdateStatus,
} from "@modelmayhem/contracts";
import { ulid } from "ulid";
import { stringify } from "yaml";
import {
  copyContentDirectory,
  readJsonFile,
  releaseContentDirectory,
  writeJsonAtomic,
} from "./files";
import { GitContentSource, normalizeContentPath } from "./git-source";
import {
  type ContentManifestFile,
  contentManifestHash,
  findManifestFile,
  fingerprintContentDirectory,
  fingerprintContentPaths,
  readContentManifest,
} from "./manifest";

export interface PlayerDataSnapshot {
  readonly path: string;
  readonly createdAt: string;
  readonly databaseSchemaHash: string;
  readonly lastMigrationId: string;
}

export interface ContentUpdaterOptions {
  readonly appVersion: string;
  readonly dataDirectory: string;
  readonly repository?: string;
  readonly contentBranch: string;
  readonly balanceBranch: string;
  readonly channel: UpdateChannel;
  readonly checkOnStart: boolean;
  readonly autoInstall: boolean;
  readonly gitExecutable?: string;
  readonly contentRoot?: string;
  readonly balanceRoot?: string;
  readonly contentPaths?: readonly string[];
  readonly balancePaths?: readonly string[];
  readonly validateContent: (contentRoot: string) => void | Promise<void>;
  readonly snapshotPlayerData: (directory: string) => Promise<{
    readonly databaseSchemaHash: string;
    readonly lastMigrationId: string;
  }>;
  readonly restorePlayerData: (snapshotPath: string) => void | Promise<void>;
  readonly databaseSchemaHash: () => string;
  readonly lastMigrationId: () => string;
  readonly now?: () => Date;
}

interface ActivePointer {
  readonly contentDirectory: string;
  readonly installation: ContentInstallation;
}

interface RollbackPointer {
  readonly active: ActivePointer;
  readonly playerDataSnapshot: PlayerDataSnapshot;
}

interface SourceUpdate {
  readonly commit: string;
  readonly sourceDirectory: string;
  readonly version: string;
  readonly treeHash: string;
  readonly manifestHash: string;
}

interface StagedSourceUpdate extends SourceUpdate {
  readonly manifest: ContentManifestFile;
}

interface PendingUpdate {
  readonly content: SourceUpdate;
  readonly balance: SourceUpdate;
  readonly contentChanged: boolean;
  readonly balanceChanged: boolean;
  readonly stagingDirectory: string;
  readonly combinedContentDirectory: string;
  readonly combinedTreeHash: string;
}

interface InstallUpdateTransaction {
  readonly kind: "install";
  readonly target: ActivePointer;
  readonly rollback: RollbackPointer;
  readonly pendingPath: string;
  readonly pendingDirectory: string;
  readonly combinedContentDirectory: string;
}

interface RollbackUpdateTransaction {
  readonly kind: "rollback";
  readonly target: ActivePointer;
  readonly playerDataSnapshot: PlayerDataSnapshot;
}

type UpdateTransaction = InstallUpdateTransaction | RollbackUpdateTransaction;

interface LockMetadata {
  readonly pid: number;
  readonly hostname: string;
  readonly token: string;
  readonly createdAt: string;
}

const STALE_MALFORMED_LOCK_MS = 5 * 60 * 1000;
const STALE_REMOTE_LOCK_MS = 24 * 60 * 60 * 1000;
const STALE_LOCAL_LOCK_MS = 2 * 60 * 60 * 1000;

function safeRepositoryLabel(repository: string | undefined): string | null {
  if (!repository) {
    return null;
  }
  try {
    const parsed = new URL(repository);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return repository.replace(/\/\/[^/@]+@/, "//[REDACTED]@");
  }
}

function ensureSchemaFingerprint(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("数据库结构指纹必须是 SHA-256 十六进制");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/**
 * 把早期单源安装记录提升为双源记录。
 *
 * Alpha 基线可能已经创建了 active.json。迁移时把旧的完整安装树哈希同时作为两边
 * 来源哈希和组合树哈希，首次双源检查会自动安装真正的分来源版本。
 */
function normalizeActivePointer(value: unknown): ActivePointer | null {
  if (
    !isRecord(value) ||
    typeof value.contentDirectory !== "string" ||
    !isRecord(value.installation)
  ) {
    return null;
  }
  const installation = value.installation;
  const contentVersion = readString(installation.contentVersion);
  const contentCommit = readString(installation.contentCommit);
  const contentTreeHash = readString(installation.contentTreeHash);
  const contentManifestHash = readString(installation.contentManifestHash);
  const installationTreeHash = readString(installation.installationTreeHash) ?? contentTreeHash;
  if (
    !contentVersion ||
    !contentCommit ||
    !contentTreeHash ||
    !contentManifestHash ||
    !installationTreeHash
  ) {
    return null;
  }
  return {
    contentDirectory: value.contentDirectory,
    installation: {
      ...(installation as unknown as ContentInstallation),
      contentVersion,
      contentCommit,
      contentTreeHash,
      contentManifestHash,
      balanceVersion: readString(installation.balanceVersion) ?? contentVersion,
      balanceCommit: readString(installation.balanceCommit) ?? contentCommit,
      balanceTreeHash: readString(installation.balanceTreeHash) ?? contentTreeHash,
      balanceManifestHash: readString(installation.balanceManifestHash) ?? contentManifestHash,
      installationTreeHash,
    },
  };
}

function normalizePendingUpdate(value: unknown): PendingUpdate | null {
  if (
    !isRecord(value) ||
    !isRecord(value.content) ||
    !isRecord(value.balance) ||
    typeof value.stagingDirectory !== "string" ||
    typeof value.combinedContentDirectory !== "string" ||
    typeof value.combinedTreeHash !== "string"
  ) {
    return null;
  }
  const normalizeSource = (source: Record<string, unknown>): SourceUpdate | null => {
    const commit = readString(source.commit);
    const sourceDirectory = readString(source.sourceDirectory);
    const version = readString(source.version);
    const treeHash = readString(source.treeHash);
    const manifestHash = readString(source.manifestHash);
    if (!commit || !sourceDirectory || !version || !treeHash || !manifestHash) {
      return null;
    }
    return { commit, sourceDirectory, version, treeHash, manifestHash };
  };
  const content = normalizeSource(value.content);
  const balance = normalizeSource(value.balance);
  if (!content || !balance) {
    return null;
  }
  return {
    content,
    balance,
    contentChanged: value.contentChanged === true,
    balanceChanged: value.balanceChanged === true,
    stagingDirectory: value.stagingDirectory,
    combinedContentDirectory: value.combinedContentDirectory,
    combinedTreeHash: value.combinedTreeHash,
  };
}

function normalizeRollbackPointer(value: unknown): RollbackPointer | null {
  if (
    !isRecord(value) ||
    !isRecord(value.playerDataSnapshot) ||
    typeof value.playerDataSnapshot.path !== "string" ||
    typeof value.playerDataSnapshot.createdAt !== "string" ||
    typeof value.playerDataSnapshot.databaseSchemaHash !== "string" ||
    typeof value.playerDataSnapshot.lastMigrationId !== "string"
  ) {
    return null;
  }
  const active = normalizeActivePointer(value.active);
  if (!active) {
    return null;
  }
  return {
    active,
    playerDataSnapshot: {
      path: value.playerDataSnapshot.path,
      createdAt: value.playerDataSnapshot.createdAt,
      databaseSchemaHash: value.playerDataSnapshot.databaseSchemaHash,
      lastMigrationId: value.playerDataSnapshot.lastMigrationId,
    },
  };
}

function transactionPath(dataDirectory: string): string {
  return join(dataDirectory, "installation", "update-transaction.json");
}

function updateLockPath(dataDirectory: string): string {
  return join(dataDirectory, "installation", "update.lock");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code !== "ESRCH";
  }
}

function readLockMetadata(path: string): LockMetadata | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockMetadata>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return parsed as LockMetadata;
  } catch {
    return null;
  }
}

function isStaleLock(path: string, metadata: LockMetadata | null, now: Date): boolean {
  if (metadata === null) {
    try {
      return now.getTime() - statSync(path).mtimeMs > STALE_MALFORMED_LOCK_MS;
    } catch {
      return true;
    }
  }
  const createdAt = Date.parse(metadata.createdAt);
  if (!Number.isFinite(createdAt)) {
    return true;
  }
  if (metadata.hostname === hostname()) {
    // 进程号可能被系统复用。即便进程仍存活，超过最大锁年龄也视为陈旧记录，
    // 否则一次异常退出会在同号进程存活期间永久阻塞更新。
    return !isProcessAlive(metadata.pid) || now.getTime() - createdAt > STALE_LOCAL_LOCK_MS;
  }
  return now.getTime() - createdAt > STALE_REMOTE_LOCK_MS;
}

async function withUpdateLock<T>(
  lockPath: string,
  now: () => Date,
  operation: () => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomBytes(16).toString("hex");
  const metadata: LockMetadata = {
    pid: process.pid,
    hostname: hostname(),
    token,
    createdAt: now().toISOString(),
  };
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      writeFileSync(lockPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      acquired = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      const existing = readLockMetadata(lockPath);
      if (!isStaleLock(lockPath, existing, now())) {
        throw new Error(`更新事务正在执行：${JSON.stringify(existing)}`);
      }
      rmSync(lockPath, { force: true });
    }
  }
  if (!acquired) {
    throw new Error("无法取得更新事务锁");
  }
  try {
    return await operation();
  } finally {
    const current = readLockMetadata(lockPath);
    if (current?.token === token) {
      rmSync(lockPath, { force: true });
    }
  }
}

function parseVersion(value: string): {
  readonly core: readonly number[];
  readonly prerelease: readonly string[];
} {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) {
    throw new Error(`内容版本不是受支持的三段版本号：${value}`);
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumber !== null) {
      return -1;
    }
    if (rightNumber !== null) {
      return 1;
    }
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

/** 按语义化版本比较内容版本，返回值与常见比较函数一致。 */
export function compareContentVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

/** 在打开数据库前补全上次进程中断的安装或回滚事务。 */
export async function recoverInterruptedUpdateTransaction(options: {
  readonly dataDirectory: string;
  readonly restorePlayerData: (snapshotPath: string) => void | Promise<void>;
  readonly now?: () => Date;
}): Promise<boolean> {
  const now = options.now ?? (() => new Date());
  const path = transactionPath(options.dataDirectory);
  return withUpdateLock(updateLockPath(options.dataDirectory), now, async () => {
    const transaction = readJsonFile<UpdateTransaction>(path);
    if (!transaction) {
      return false;
    }
    if (transaction.kind === "rollback") {
      await options.restorePlayerData(transaction.playerDataSnapshot.path);
    } else {
      if (!existsSync(transaction.target.contentDirectory)) {
        throw new Error("中断的更新事务缺少目标内容，拒绝启动");
      }
      writeJsonAtomic(
        join(options.dataDirectory, "installation", "rollback.json"),
        transaction.rollback satisfies RollbackPointer,
      );
      rmSync(transaction.pendingPath, { force: true });
      rmSync(transaction.pendingDirectory, { recursive: true, force: true });
      rmSync(transaction.combinedContentDirectory, { recursive: true, force: true });
    }
    writeJsonAtomic(join(options.dataDirectory, "installation", "active.json"), transaction.target);
    rmSync(path, { force: true });
    return true;
  });
}

export class ContentUpdater {
  private readonly installationRoot: string;
  private readonly releasesRoot: string;
  private readonly backupRoot: string;
  private readonly activePath: string;
  private readonly rollbackPath: string;
  private readonly pendingPath: string;
  private readonly transactionPath: string;
  private readonly lockPath: string;
  private readonly contentRoot: string;
  private readonly balanceRoot: string;
  private readonly contentPaths: readonly string[];
  private readonly balancePaths: readonly string[];
  private readonly now: () => Date;
  private restartRequired = false;

  constructor(private readonly options: ContentUpdaterOptions) {
    this.installationRoot = join(options.dataDirectory, "installation");
    this.releasesRoot = join(this.installationRoot, "releases");
    this.backupRoot = join(options.dataDirectory, "backups", "rollback");
    this.activePath = join(this.installationRoot, "active.json");
    this.rollbackPath = join(this.installationRoot, "rollback.json");
    this.pendingPath = join(this.installationRoot, "pending.json");
    this.transactionPath = transactionPath(options.dataDirectory);
    this.lockPath = updateLockPath(options.dataDirectory);
    this.contentRoot = normalizeContentPath(options.contentRoot ?? "content");
    this.balanceRoot = normalizeContentPath(options.balanceRoot ?? "content");
    this.contentPaths = (options.contentPaths ?? ["presentation", "thumbnails", "questions"]).map(
      normalizeContentPath,
    );
    this.balancePaths = (
      options.balancePaths ?? ["cards", "balance", "decks", "research", "eras", "doctrines"]
    ).map(normalizeContentPath);
    if (this.contentPaths.length === 0 || this.balancePaths.length === 0) {
      throw new Error("内容源和平衡源都必须至少拥有一个受管路径");
    }
    const overlap = this.contentPaths.filter((path) =>
      this.balancePaths.some((balancePath) => pathsOverlap(path, balancePath)),
    );
    if (overlap.length > 0) {
      throw new Error(`内容源和平衡源路径不能重叠：${overlap.join("、")}`);
    }
    this.now = options.now ?? (() => new Date());
  }

  /** 首次运行时把仓库内容复制到不可变版本目录并记录安装清单。 */
  async ensureInitialInstallation(
    fallbackContentDirectory: string,
    databaseSchemaHash: string,
    lastMigrationId: string,
    legacyMigrationId?: string,
  ): Promise<ContentInstallation> {
    return this.withLock(async () => {
      const existing = this.readActive();
      if (existing && existsSync(existing.contentDirectory)) {
        const fingerprint = fingerprintContentDirectory(existing.contentDirectory);
        if (fingerprint.treeHash !== existing.installation.installationTreeHash) {
          return existing.installation;
        }
        let activeContentAccepted = true;
        try {
          await this.options.validateContent(existing.contentDirectory);
        } catch {
          activeContentAccepted = false;
        }
        if (activeContentAccepted) {
          const currentSchemaHash = ensureSchemaFingerprint(databaseSchemaHash);
          const schemaChanged = currentSchemaHash !== existing.installation.databaseSchemaHash;
          const migrationChanged = lastMigrationId !== existing.installation.lastMigrationId;
          const isLegacyMigrationRecord =
            migrationChanged &&
            legacyMigrationId !== undefined &&
            existing.installation.lastMigrationId === legacyMigrationId;
          if (schemaChanged || (migrationChanged && !isLegacyMigrationRecord)) {
            throw new Error("数据库结构或迁移记录已偏离官方安装记录，拒绝启动自动更新");
          }
          if (
            existing.installation.appVersion === this.options.appVersion &&
            !isLegacyMigrationRecord
          ) {
            return existing.installation;
          }
          const refreshed: ContentInstallation = {
            ...existing.installation,
            appVersion: this.options.appVersion,
            lastMigrationId,
          };
          writeJsonAtomic(
            join(this.releasesRoot, refreshed.installationTreeHash, "installation.json"),
            refreshed,
          );
          writeJsonAtomic(this.activePath, {
            contentDirectory: existing.contentDirectory,
            installation: refreshed,
          } satisfies ActivePointer);
          return refreshed;
        }
      }
      const source = resolve(fallbackContentDirectory);
      await this.options.validateContent(source);
      const fingerprint = fingerprintContentDirectory(source);
      const targetContent = await this.materializeReleaseContent(source, fingerprint.treeHash);
      const manifest = readContentManifest(targetContent);
      const manifestHash = contentManifestHash(targetContent);
      const contentFingerprint = fingerprintContentPaths(source, this.contentPaths);
      const balanceFingerprint = fingerprintContentPaths(source, this.balancePaths);
      const installation: ContentInstallation = {
        installationId: ulid(this.now().getTime()),
        appVersion: this.options.appVersion,
        contentVersion: manifest.version,
        contentCommit: "local",
        contentTreeHash: contentFingerprint.treeHash,
        contentManifestHash: manifestHash,
        balanceVersion: manifest.version,
        balanceCommit: "local",
        balanceTreeHash: balanceFingerprint.treeHash,
        balanceManifestHash: manifestHash,
        installationTreeHash: fingerprint.treeHash,
        contentSchemaVersion: 1,
        databaseSchemaHash: ensureSchemaFingerprint(databaseSchemaHash),
        lastMigrationId,
        installMode: "official",
        knownMods: [],
        installedAt: this.now().toISOString(),
      };
      writeJsonAtomic(
        join(this.installationRoot, "releases", fingerprint.treeHash, "installation.json"),
        installation,
      );
      writeJsonAtomic(this.activePath, {
        contentDirectory: targetContent,
        installation,
      } satisfies ActivePointer);
      return installation;
    });
  }

  /** 返回当前需要加载的内容目录；尚未安装时返回 fallback。 */
  resolveContentDirectory(fallbackContentDirectory: string): string {
    const active = this.readActive();
    return active && existsSync(active.contentDirectory)
      ? active.contentDirectory
      : resolve(fallbackContentDirectory);
  }

  /** 生成可公开的更新状态，不返回仓库凭据或玩家数据。 */
  async getStatus(): Promise<UpdateStatus> {
    const active = this.readActive();
    const pending = this.readPending();
    const rollback = normalizeRollbackPointer(readJsonFile<unknown>(this.rollbackPath));
    const contentIntegrity = active ? this.inspectActiveIntegrity(active) : "unknown";
    const integrity =
      active && contentIntegrity === "official" && this.isDatabaseCompatible(active.installation)
        ? "official"
        : contentIntegrity === "unknown"
          ? "unknown"
          : "community";
    return {
      enabled: this.options.repository !== undefined,
      repository: safeRepositoryLabel(this.options.repository),
      contentBranch: this.options.repository ? this.options.contentBranch : null,
      balanceBranch: this.options.repository ? this.options.balanceBranch : null,
      channel: this.options.channel,
      checkOnStart: this.options.checkOnStart,
      autoInstall: this.options.autoInstall,
      controlTokenRequired: false,
      active: active?.installation ?? null,
      pendingContentCommit: pending?.contentChanged ? pending.content.commit : null,
      pendingBalanceCommit: pending?.balanceChanged ? pending.balance.commit : null,
      pendingContentVersion: pending?.contentChanged ? pending.content.version : null,
      pendingBalanceVersion: pending?.balanceChanged ? pending.balance.version : null,
      rollbackAvailable:
        rollback !== null &&
        existsSync(rollback.playerDataSnapshot.path) &&
        existsSync(rollback.active.contentDirectory),
      restartRequired: this.restartRequired,
      integrity,
      message:
        this.options.repository === undefined
          ? "未配置远端更新仓库"
          : integrity === "community"
            ? "当前系统内容被修改，已停止自动更新"
            : this.restartRequired
              ? "更新已安装，重启服务后生效"
              : pending
                ? "发现待安装更新"
                : "当前安装可供检查更新",
    };
  }

  /** 检查远端分支并验证候选内容，结果保存在本地 pending 文件。 */
  async checkForUpdate(): Promise<UpdateCheckResult> {
    return this.withLock(async () => {
      const contentSource = this.requireGitSource("content");
      const balanceSource = this.requireGitSource("balance");
      const active = this.readActive();
      if (!active) {
        throw new Error("系统内容尚未完成首次安装");
      }
      if (this.inspectActiveIntegrity(active) !== "official") {
        throw new Error("当前系统内容已被修改，拒绝检查或安装官方更新");
      }
      this.assertDatabaseCompatibility(active.installation);
      const contentCommit = contentSource.checkRemoteHead();
      const balanceCommit = balanceSource.checkRemoteHead();
      const stagingDirectory = join(
        this.installationRoot,
        "temp",
        `check-${Date.now()}-${process.pid}`,
      );
      try {
        const content = this.stageSourceUpdate(
          contentSource,
          contentCommit,
          join(stagingDirectory, "content"),
          this.contentPaths,
        );
        const balance = this.stageSourceUpdate(
          balanceSource,
          balanceCommit,
          join(stagingDirectory, "balance"),
          this.balancePaths,
        );
        if (content.manifest.id !== balance.manifest.id) {
          throw new Error("卡面内容源和数值内容源的清单标识不一致");
        }
        const contentChanged =
          content.treeHash !== active.installation.contentTreeHash ||
          content.manifestHash !== active.installation.contentManifestHash;
        const balanceChanged =
          balance.treeHash !== active.installation.balanceTreeHash ||
          balance.manifestHash !== active.installation.balanceManifestHash;
        if (!contentChanged && !balanceChanged) {
          this.clearPending();
          rmSync(stagingDirectory, { recursive: true, force: true });
          return {
            status: "up_to_date",
            contentCommit,
            contentVersion: content.version,
            contentTreeHash: content.treeHash,
            balanceCommit,
            balanceVersion: balance.version,
            balanceTreeHash: balance.treeHash,
            restartRequired: false,
            message: "卡面内容和数值内容都已是远端稳定版本",
          };
        }
        if (
          contentChanged &&
          compareContentVersions(content.version, active.installation.contentVersion) < 0
        ) {
          throw new Error(
            `远端卡面版本 ${content.version} 低于当前版本 ${active.installation.contentVersion}，拒绝降级`,
          );
        }
        if (
          balanceChanged &&
          compareContentVersions(balance.version, active.installation.balanceVersion) < 0
        ) {
          throw new Error(
            `远端数值版本 ${balance.version} 低于当前版本 ${active.installation.balanceVersion}，拒绝降级`,
          );
        }
        const combinedContentDirectory = join(stagingDirectory, "combined");
        await this.composeContentRelease(
          active.contentDirectory,
          combinedContentDirectory,
          content,
          balance,
        );
        const combinedFingerprint = fingerprintContentDirectory(combinedContentDirectory);
        this.clearPending();
        writeJsonAtomic(this.pendingPath, {
          content: this.toSourceUpdate(content),
          balance: this.toSourceUpdate(balance),
          contentChanged,
          balanceChanged,
          stagingDirectory,
          combinedContentDirectory,
          combinedTreeHash: combinedFingerprint.treeHash,
        } satisfies PendingUpdate);
        const changedLabels = [
          contentChanged ? "卡面内容" : null,
          balanceChanged ? "数值内容" : null,
        ].filter((label): label is string => label !== null);
        return {
          status: "update_available",
          contentCommit,
          contentVersion: content.version,
          contentTreeHash: content.treeHash,
          balanceCommit,
          balanceVersion: balance.version,
          balanceTreeHash: balance.treeHash,
          restartRequired: false,
          message: `${changedLabels.join("和")}已暂存，可以执行一次原子安装`,
        };
      } catch (error) {
        if (!existsSync(this.pendingPath)) {
          rmSync(stagingDirectory, { recursive: true, force: true });
        }
        throw error;
      }
    });
  }

  /** 安装已暂存内容，并在失败时保留可恢复事务。 */
  async installPending(): Promise<UpdateInstallResult> {
    return this.withLock(async () => {
      const pending = this.readPending();
      const previous = this.readActive();
      const oldRollback = normalizeRollbackPointer(readJsonFile<unknown>(this.rollbackPath));
      if (!pending) {
        throw new Error("没有待安装更新，请先检查更新");
      }
      if (!previous) {
        throw new Error("当前系统安装记录不存在");
      }
      if (this.inspectActiveIntegrity(previous) !== "official") {
        throw new Error("当前系统内容已被修改，拒绝安装官方更新");
      }
      this.assertDatabaseCompatibility(previous.installation);
      const contentSource = this.requireGitSource("content");
      const balanceSource = this.requireGitSource("balance");
      if (
        contentSource.checkRemoteHead() !== pending.content.commit ||
        balanceSource.checkRemoteHead() !== pending.balance.commit
      ) {
        this.clearPending();
        throw new Error("至少一个待安装提交已从远端撤回或移动，已清除失效更新");
      }
      this.assertStagedSource(pending.content, this.contentPaths, "卡面内容");
      this.assertStagedSource(pending.balance, this.balancePaths, "数值内容");
      if (!pending.contentChanged && !pending.balanceChanged) {
        this.clearPending();
        throw new Error("待安装记录没有实际变化，已清除");
      }
      if (
        pending.contentChanged &&
        compareContentVersions(pending.content.version, previous.installation.contentVersion) < 0
      ) {
        this.clearPending();
        throw new Error(
          `待安装卡面版本 ${pending.content.version} 低于当前版本 ${previous.installation.contentVersion}，拒绝降级`,
        );
      }
      if (
        pending.balanceChanged &&
        compareContentVersions(pending.balance.version, previous.installation.balanceVersion) < 0
      ) {
        this.clearPending();
        throw new Error(
          `待安装数值版本 ${pending.balance.version} 低于当前版本 ${previous.installation.balanceVersion}，拒绝降级`,
        );
      }
      await this.options.validateContent(pending.combinedContentDirectory);
      const fingerprint = fingerprintContentDirectory(pending.combinedContentDirectory);
      if (fingerprint.treeHash !== pending.combinedTreeHash) {
        throw new Error("暂存组合内容哈希发生变化，拒绝安装");
      }

      mkdirSync(this.backupRoot, { recursive: true });
      const snapshotPath = join(
        this.backupRoot,
        `player-${previous.installation.installationId}.sqlite`,
      );
      rmSync(snapshotPath, { force: true });
      const snapshotInfo = await this.options.snapshotPlayerData(snapshotPath);
      const snapshot: PlayerDataSnapshot = {
        path: snapshotPath,
        createdAt: this.now().toISOString(),
        databaseSchemaHash: ensureSchemaFingerprint(snapshotInfo.databaseSchemaHash),
        lastMigrationId: snapshotInfo.lastMigrationId,
      };
      const targetContent = await this.materializeReleaseContent(
        pending.combinedContentDirectory,
        pending.combinedTreeHash,
      );
      const installation: ContentInstallation = {
        installationId: ulid(this.now().getTime()),
        appVersion: this.options.appVersion,
        contentVersion: pending.content.version,
        contentCommit: pending.content.commit,
        contentTreeHash: pending.content.treeHash,
        contentManifestHash: pending.content.manifestHash,
        balanceVersion: pending.balance.version,
        balanceCommit: pending.balance.commit,
        balanceTreeHash: pending.balance.treeHash,
        balanceManifestHash: pending.balance.manifestHash,
        installationTreeHash: pending.combinedTreeHash,
        contentSchemaVersion: 1,
        databaseSchemaHash: snapshot.databaseSchemaHash,
        lastMigrationId: snapshot.lastMigrationId,
        installMode: "official",
        knownMods: [],
        installedAt: this.now().toISOString(),
      };
      const target: ActivePointer = {
        contentDirectory: targetContent,
        installation,
      };
      const rollback: RollbackPointer = {
        active: previous,
        playerDataSnapshot: snapshot,
      };
      writeJsonAtomic(
        join(this.releasesRoot, pending.combinedTreeHash, "installation.json"),
        installation,
      );
      writeJsonAtomic(this.transactionPath, {
        kind: "install",
        target,
        rollback,
        pendingPath: this.pendingPath,
        pendingDirectory: pending.stagingDirectory,
        combinedContentDirectory: pending.combinedContentDirectory,
      } satisfies InstallUpdateTransaction);
      try {
        writeJsonAtomic(this.rollbackPath, rollback);
        writeJsonAtomic(this.activePath, target);
        this.restartRequired = true;
        this.cleanupOldRollback(oldRollback, previous.installation, installation, snapshotPath);
        rmSync(this.pendingPath, { force: true });
        rmSync(pending.stagingDirectory, { recursive: true, force: true });
        rmSync(pending.combinedContentDirectory, { recursive: true, force: true });
        rmSync(this.transactionPath, { force: true });
      } catch (error) {
        throw new Error(
          `更新已进入恢复事务，重新启动后将自动完成：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return {
        installed: installation,
        previous: previous.installation,
        restartRequired: true,
        message: "更新安装完成，请重启服务加载新内容",
      };
    });
  }

  /** 恢复上一次玩家数据快照和系统内容指针。 */
  async rollback(): Promise<UpdateRollbackResult> {
    return this.withLock(async () => {
      const rollback = normalizeRollbackPointer(readJsonFile<unknown>(this.rollbackPath));
      if (!rollback || !existsSync(rollback.playerDataSnapshot.path)) {
        throw new Error("没有可用回滚点");
      }
      if (!existsSync(rollback.active.contentDirectory)) {
        throw new Error(`回滚内容目录不存在：${rollback.active.contentDirectory}`);
      }
      const rollbackFingerprint = fingerprintContentDirectory(rollback.active.contentDirectory);
      if (rollbackFingerprint.treeHash !== rollback.active.installation.installationTreeHash) {
        throw new Error("回滚内容目录哈希与安装记录不一致，拒绝回滚");
      }
      writeJsonAtomic(this.transactionPath, {
        kind: "rollback",
        target: rollback.active,
        playerDataSnapshot: rollback.playerDataSnapshot,
      } satisfies RollbackUpdateTransaction);
      try {
        await this.options.restorePlayerData(rollback.playerDataSnapshot.path);
        writeJsonAtomic(this.activePath, rollback.active);
        this.restartRequired = true;
        rmSync(this.rollbackPath, { force: true });
        rmSync(this.transactionPath, { force: true });
      } catch (error) {
        throw new Error(
          `回滚已进入恢复事务，重新启动后将自动完成：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return {
        restored: rollback.active.installation,
        restartRequired: true,
        playerDataRestored: true,
        message: "已恢复上一版本和对应玩家数据，请重启服务",
      };
    });
  }

  private requireGitSource(source: "content" | "balance"): GitContentSource {
    if (!this.options.repository) {
      throw new Error("未配置 MODELMAYHEM_UPDATE_REPOSITORY");
    }
    const isContent = source === "content";
    return new GitContentSource({
      repository: this.options.repository,
      branch: isContent ? this.options.contentBranch : this.options.balanceBranch,
      sourceRoot: isContent ? this.contentRoot : this.balanceRoot,
      paths: isContent ? this.contentPaths : this.balancePaths,
      ...(this.options.gitExecutable ? { gitExecutable: this.options.gitExecutable } : {}),
    });
  }

  private stageSourceUpdate(
    source: GitContentSource,
    commit: string,
    destination: string,
    paths: readonly string[],
  ): StagedSourceUpdate {
    const staged = source.stageCommit(commit, destination);
    const manifest = readContentManifest(staged.sourceDirectory);
    const fingerprint = fingerprintContentPaths(staged.sourceDirectory, paths);
    return {
      commit,
      sourceDirectory: staged.sourceDirectory,
      version: manifest.version,
      treeHash: fingerprint.treeHash,
      manifestHash: contentManifestHash(staged.sourceDirectory),
      manifest,
    };
  }

  private toSourceUpdate(source: StagedSourceUpdate): SourceUpdate {
    return {
      commit: source.commit,
      sourceDirectory: source.sourceDirectory,
      version: source.version,
      treeHash: source.treeHash,
      manifestHash: source.manifestHash,
    };
  }

  private assertStagedSource(source: SourceUpdate, paths: readonly string[], label: string): void {
    const manifest = readContentManifest(source.sourceDirectory);
    if (manifest.version !== source.version) {
      throw new Error(`${label}暂存版本与检查结果不一致，拒绝安装`);
    }
    if (contentManifestHash(source.sourceDirectory) !== source.manifestHash) {
      throw new Error(`${label}暂存清单哈希发生变化，拒绝安装`);
    }
    const fingerprint = fingerprintContentPaths(source.sourceDirectory, paths);
    if (fingerprint.treeHash !== source.treeHash) {
      throw new Error(`${label}暂存目录哈希发生变化，拒绝安装`);
    }
  }

  private async composeContentRelease(
    baseDirectory: string,
    destination: string,
    content: StagedSourceUpdate,
    balance: StagedSourceUpdate,
  ): Promise<void> {
    if (content.manifest.id !== balance.manifest.id) {
      throw new Error("卡面内容源和数值内容源不能使用不同的清单标识");
    }
    rmSync(destination, { recursive: true, force: true });
    copyContentDirectory(baseDirectory, destination);
    this.overlaySourcePaths(content.sourceDirectory, destination, this.contentPaths);
    this.overlaySourcePaths(balance.sourceDirectory, destination, this.balancePaths);
    writeFileSync(
      findManifestFile(destination),
      stringify({
        id: content.manifest.id,
        version: content.manifest.version,
        rulesetVersion: balance.manifest.rulesetVersion,
        balanceId: balance.manifest.balanceId,
      }),
      "utf8",
    );
    await this.options.validateContent(destination);
  }

  private overlaySourcePaths(
    sourceDirectory: string,
    targetDirectory: string,
    paths: readonly string[],
  ): void {
    for (const relativePath of paths) {
      const sourcePath = join(sourceDirectory, relativePath);
      const targetPath = join(targetDirectory, relativePath);
      rmSync(targetPath, { recursive: true, force: true });
      if (existsSync(sourcePath)) {
        mkdirSync(dirname(targetPath), { recursive: true });
        cpSync(sourcePath, targetPath, { recursive: true, dereference: false });
      }
    }
  }

  private readActive(): ActivePointer | null {
    return normalizeActivePointer(readJsonFile<unknown>(this.activePath));
  }

  private readPending(): PendingUpdate | null {
    return normalizePendingUpdate(readJsonFile<unknown>(this.pendingPath));
  }

  private clearPending(): void {
    const raw = readJsonFile<unknown>(this.pendingPath);
    if (isRecord(raw)) {
      for (const field of [
        "stagingDirectory",
        "combinedContentDirectory",
        "contentDirectory",
        "pendingContentDirectory",
      ]) {
        const path = readString(raw[field]);
        if (path) {
          rmSync(path, { recursive: true, force: true });
        }
      }
    }
    rmSync(this.pendingPath, { force: true });
  }

  private async materializeReleaseContent(
    sourceDirectory: string,
    expectedTreeHash: string,
  ): Promise<string> {
    const targetDirectory = releaseContentDirectory(this.releasesRoot, expectedTreeHash);
    if (existsSync(targetDirectory)) {
      try {
        if (fingerprintContentDirectory(targetDirectory).treeHash === expectedTreeHash) {
          await this.options.validateContent(targetDirectory);
          return targetDirectory;
        }
      } catch {
        // 上一次中断留下的不完整目录会在重建前移除。
      }
      rmSync(targetDirectory, { recursive: true, force: true });
    }
    copyContentDirectory(sourceDirectory, targetDirectory);
    await this.options.validateContent(targetDirectory);
    if (fingerprintContentDirectory(targetDirectory).treeHash !== expectedTreeHash) {
      rmSync(targetDirectory, { recursive: true, force: true });
      throw new Error("发布目录复制后哈希不一致，已移除不完整版本");
    }
    return targetDirectory;
  }

  private inspectActiveIntegrity(active: ActivePointer): "official" | "community" | "unknown" {
    if (!existsSync(active.contentDirectory)) {
      return "unknown";
    }
    try {
      return fingerprintContentDirectory(active.contentDirectory).treeHash ===
        active.installation.installationTreeHash
        ? "official"
        : "community";
    } catch {
      return "community";
    }
  }

  private assertDatabaseCompatibility(installation: ContentInstallation): void {
    if (this.isDatabaseCompatible(installation)) {
      return;
    }
    throw new Error("数据库结构或迁移记录已偏离官方安装记录，拒绝自动更新");
  }

  private isDatabaseCompatible(installation: ContentInstallation): boolean {
    const currentSchemaHash = ensureSchemaFingerprint(this.options.databaseSchemaHash());
    if (currentSchemaHash !== installation.databaseSchemaHash) {
      return false;
    }
    const currentMigrationId = this.options.lastMigrationId();
    return currentMigrationId === installation.lastMigrationId;
  }

  private cleanupOldRollback(
    oldRollback: RollbackPointer | null,
    previousInstallation: ContentInstallation,
    installed: ContentInstallation,
    currentSnapshotPath: string,
  ): void {
    const oldRelease = oldRollback
      ? join(this.releasesRoot, oldRollback.active.installation.installationTreeHash)
      : null;
    if (
      oldRelease &&
      oldRelease !== join(this.releasesRoot, previousInstallation.installationTreeHash) &&
      oldRelease !== join(this.releasesRoot, installed.installationTreeHash)
    ) {
      rmSync(oldRelease, { recursive: true, force: true });
    }
    if (oldRollback && oldRollback.playerDataSnapshot.path !== currentSnapshotPath) {
      rmSync(oldRollback.playerDataSnapshot.path, { force: true });
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withUpdateLock(this.lockPath, this.now, operation);
  }
}

export * from "./files";
export * from "./git-source";
export * from "./manifest";
