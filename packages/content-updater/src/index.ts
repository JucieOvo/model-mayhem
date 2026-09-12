/**
 * 系统内容更新管理器。
 *
 * 作者：JucieOvo
 *
 * 更新过程采用 A-B-C 单回滚点：安装 C 前备份玩家数据，成功后将 B 提升为新的
 * 回滚点并清理旧 A。玩家数据不参与系统内容哈希判断。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ContentInstallation,
  UpdateChannel,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateRollbackResult,
  UpdateStatus,
} from "@modelmayhem/contracts";
import { ulid } from "ulid";
import {
  copyContentDirectory,
  readJsonFile,
  releaseContentDirectory,
  writeJsonAtomic,
} from "./files";
import { GitContentSource } from "./git-source";
import { contentManifestHash, fingerprintContentDirectory, readContentManifest } from "./manifest";

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
  readonly branch: string;
  readonly channel: UpdateChannel;
  readonly checkOnStart: boolean;
  readonly autoInstall: boolean;
  readonly gitExecutable?: string;
  readonly contentPath?: string;
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

interface PendingUpdate {
  readonly commit: string;
  readonly contentDirectory: string;
  readonly contentVersion: string;
  readonly contentTreeHash: string;
}

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

export class ContentUpdater {
  private readonly installationRoot: string;
  private readonly releasesRoot: string;
  private readonly backupRoot: string;
  private readonly activePath: string;
  private readonly rollbackPath: string;
  private readonly pendingPath: string;
  private readonly lockPath: string;
  private readonly now: () => Date;
  private restartRequired = false;

  constructor(private readonly options: ContentUpdaterOptions) {
    this.installationRoot = join(options.dataDirectory, "installation");
    this.releasesRoot = join(this.installationRoot, "releases");
    this.backupRoot = join(options.dataDirectory, "backups", "rollback");
    this.activePath = join(this.installationRoot, "active.json");
    this.rollbackPath = join(this.installationRoot, "rollback.json");
    this.pendingPath = join(this.installationRoot, "pending.json");
    this.lockPath = join(this.installationRoot, "update.lock");
    this.now = options.now ?? (() => new Date());
  }

  /** 首次运行时把仓库内容复制到不可变版本目录并记录安装清单。 */
  async ensureInitialInstallation(
    fallbackContentDirectory: string,
    databaseSchemaHash: string,
    lastMigrationId: string,
  ): Promise<ContentInstallation> {
    const existing = this.readActive();
    if (existing && existsSync(existing.contentDirectory)) {
      const fingerprint = fingerprintContentDirectory(existing.contentDirectory);
      if (fingerprint.treeHash !== existing.installation.contentTreeHash) {
        return existing.installation;
      }
      const refreshed: ContentInstallation = {
        ...existing.installation,
        appVersion: this.options.appVersion,
        databaseSchemaHash: ensureSchemaFingerprint(databaseSchemaHash),
        lastMigrationId,
        installedAt: this.now().toISOString(),
      };
      writeJsonAtomic(
        join(this.releasesRoot, refreshed.contentTreeHash, "installation.json"),
        refreshed,
      );
      writeJsonAtomic(this.activePath, {
        contentDirectory: existing.contentDirectory,
        installation: refreshed,
      } satisfies ActivePointer);
      return refreshed;
    }
    const source = resolve(fallbackContentDirectory);
    const fingerprint = fingerprintContentDirectory(source);
    await this.options.validateContent(source);
    const targetContent = releaseContentDirectory(this.releasesRoot, fingerprint.treeHash);
    if (!existsSync(targetContent)) {
      copyContentDirectory(source, targetContent);
    }
    const manifest = readContentManifest(targetContent);
    const installation: ContentInstallation = {
      installationId: ulid(this.now().getTime()),
      appVersion: this.options.appVersion,
      contentVersion: manifest.version,
      contentCommit: "local",
      contentTreeHash: fingerprint.treeHash,
      contentManifestHash: contentManifestHash(targetContent),
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
      branch: this.options.repository ? this.options.branch : null,
      channel: this.options.channel,
      checkOnStart: this.options.checkOnStart,
      autoInstall: this.options.autoInstall,
      active: active?.installation ?? null,
      pendingCommit: pending?.commit ?? null,
      pendingContentVersion: pending?.contentVersion ?? null,
      restartRequired: this.restartRequired || pending !== null,
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
      const source = this.requireGitSource();
      const active = this.readActive();
      if (!active) {
        throw new Error("系统内容尚未完成首次安装");
      }
      if (this.inspectActiveIntegrity(active) !== "official") {
        throw new Error("当前系统内容已被修改，拒绝检查或安装官方更新");
      }
      this.assertDatabaseCompatibility(active.installation);
      const commit = source.checkRemoteHead();
      const stagingDirectory = join(
        this.installationRoot,
        "temp",
        `check-${Date.now()}-${process.pid}`,
      );
      const staged = source.stageCommit(commit, stagingDirectory);
      await this.options.validateContent(staged.contentDirectory);
      const fingerprint = fingerprintContentDirectory(staged.contentDirectory);
      const manifest = readContentManifest(staged.contentDirectory);
      if (
        active.installation.contentCommit === commit &&
        active.installation.contentTreeHash === fingerprint.treeHash
      ) {
        rmSync(stagingDirectory, { recursive: true, force: true });
        return {
          status: "up_to_date",
          remoteCommit: commit,
          contentVersion: manifest.version,
          contentTreeHash: fingerprint.treeHash,
          restartRequired: false,
          message: "当前已经是远端分支版本",
        };
      }
      writeJsonAtomic(this.pendingPath, {
        commit,
        contentDirectory: staged.contentDirectory,
        contentVersion: manifest.version,
        contentTreeHash: fingerprint.treeHash,
      } satisfies PendingUpdate);
      return {
        status: "update_available",
        remoteCommit: commit,
        contentVersion: manifest.version,
        contentTreeHash: fingerprint.treeHash,
        restartRequired: false,
        message: "更新已暂存，可以执行安装",
      };
    });
  }

  /** 安装已暂存内容，并在失败时恢复当前指针与玩家数据。 */
  async installPending(): Promise<UpdateInstallResult> {
    return this.withLock(async () => {
      const pending = this.readPending();
      const previous = this.readActive();
      const oldRollback = readJsonFile<RollbackPointer>(this.rollbackPath);
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
      await this.options.validateContent(pending.contentDirectory);
      const fingerprint = fingerprintContentDirectory(pending.contentDirectory);
      if (fingerprint.treeHash !== pending.contentTreeHash) {
        throw new Error("暂存内容哈希发生变化，拒绝安装");
      }

      mkdirSync(this.backupRoot, { recursive: true });
      const snapshotPath = join(
        this.backupRoot,
        `player-${previous.installation.installationId}.sqlite`,
      );
      const snapshotInfo = await this.options.snapshotPlayerData(snapshotPath);
      const snapshot: PlayerDataSnapshot = {
        path: snapshotPath,
        createdAt: this.now().toISOString(),
        databaseSchemaHash: ensureSchemaFingerprint(snapshotInfo.databaseSchemaHash),
        lastMigrationId: snapshotInfo.lastMigrationId,
      };
      const targetContent = releaseContentDirectory(this.releasesRoot, pending.contentTreeHash);
      let switched = false;
      try {
        if (!existsSync(targetContent)) {
          copyContentDirectory(pending.contentDirectory, targetContent);
        }
        await this.options.validateContent(targetContent);
        const manifest = readContentManifest(targetContent);
        const installation: ContentInstallation = {
          installationId: ulid(this.now().getTime()),
          appVersion: this.options.appVersion,
          contentVersion: manifest.version,
          contentCommit: pending.commit,
          contentTreeHash: pending.contentTreeHash,
          contentManifestHash: contentManifestHash(targetContent),
          contentSchemaVersion: 1,
          databaseSchemaHash: snapshot.databaseSchemaHash,
          lastMigrationId: snapshot.lastMigrationId,
          installMode: "official",
          knownMods: [],
          installedAt: this.now().toISOString(),
        };
        writeJsonAtomic(
          join(this.releasesRoot, pending.contentTreeHash, "installation.json"),
          installation,
        );
        writeJsonAtomic(this.rollbackPath, {
          active: previous,
          playerDataSnapshot: snapshot,
        } satisfies RollbackPointer);
        writeJsonAtomic(this.activePath, {
          contentDirectory: targetContent,
          installation,
        } satisfies ActivePointer);
        switched = true;
        this.restartRequired = true;
        rmSync(this.pendingPath, { force: true });
        rmSync(pending.contentDirectory, { recursive: true, force: true });
        this.cleanupOldRollback(oldRollback, previous.installation, installation, snapshotPath);
        return {
          installed: installation,
          previous: previous.installation,
          restartRequired: true,
          message: "更新安装完成，请重启服务加载新内容",
        };
      } catch (error) {
        if (switched) {
          writeJsonAtomic(this.activePath, previous);
          await this.options.restorePlayerData(snapshotPath);
        }
        rmSync(snapshotPath, { force: true });
        throw error;
      }
    });
  }

  /** 恢复上一次玩家数据快照和系统内容指针。 */
  async rollback(): Promise<UpdateRollbackResult> {
    return this.withLock(async () => {
      const rollback = readJsonFile<RollbackPointer>(this.rollbackPath);
      if (!rollback || !existsSync(rollback.playerDataSnapshot.path)) {
        throw new Error("没有可用回滚点");
      }
      await this.options.restorePlayerData(rollback.playerDataSnapshot.path);
      writeJsonAtomic(this.activePath, rollback.active);
      this.restartRequired = true;
      rmSync(this.rollbackPath, { force: true });
      return {
        restored: rollback.active.installation,
        restartRequired: true,
        playerDataRestored: true,
        message: "已恢复上一版本和对应玩家数据，请重启服务",
      };
    });
  }

  private requireGitSource(): GitContentSource {
    if (!this.options.repository) {
      throw new Error("未配置 MODELMAYHEM_UPDATE_REPOSITORY");
    }
    return new GitContentSource({
      repository: this.options.repository,
      branch: this.options.branch,
      ...(this.options.gitExecutable ? { gitExecutable: this.options.gitExecutable } : {}),
      ...(this.options.contentPath ? { contentPath: this.options.contentPath } : {}),
    });
  }

  private readActive(): ActivePointer | null {
    return readJsonFile<ActivePointer>(this.activePath);
  }

  private readPending(): PendingUpdate | null {
    return readJsonFile<PendingUpdate>(this.pendingPath);
  }

  private inspectActiveIntegrity(active: ActivePointer): "official" | "community" | "unknown" {
    if (!existsSync(active.contentDirectory)) {
      return "unknown";
    }
    try {
      return fingerprintContentDirectory(active.contentDirectory).treeHash ===
        active.installation.contentTreeHash
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
      ? join(this.releasesRoot, oldRollback.active.installation.contentTreeHash)
      : null;
    if (
      oldRelease &&
      oldRelease !== join(this.releasesRoot, previousInstallation.contentTreeHash) &&
      oldRelease !== join(this.releasesRoot, installed.contentTreeHash)
    ) {
      rmSync(oldRelease, { recursive: true, force: true });
    }
    if (oldRollback && oldRollback.playerDataSnapshot.path !== currentSnapshotPath) {
      rmSync(oldRollback.playerDataSnapshot.path, { force: true });
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    mkdirSync(this.installationRoot, { recursive: true });
    try {
      writeFileSync(
        this.lockPath,
        JSON.stringify({ pid: process.pid, createdAt: this.now().toISOString() }),
        { encoding: "utf8", flag: "wx" },
      );
    } catch {
      const existing = readFileSync(this.lockPath, "utf8");
      throw new Error(`更新事务正在执行：${existing}`);
    }
    try {
      return await operation();
    } finally {
      rmSync(this.lockPath, { force: true });
    }
  }
}

export * from "./files";
export * from "./git-source";
export * from "./manifest";
