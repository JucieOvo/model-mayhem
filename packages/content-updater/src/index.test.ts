/**
 * 双源系统内容更新事务的真实文件系统测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用真实 Git 仓库、真实 Git 分支和真实临时目录，不替身 Git 行为。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentUpdater, recoverInterruptedUpdateTransaction } from "./index";

interface RemoteRepository {
  readonly bare: string;
  readonly work: string;
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRemoteRepository(root: string): RemoteRepository {
  const bare = join(root, "remote.git");
  const work = join(root, "work");
  mkdirSync(bare, { recursive: true });
  git(bare, ["init", "--bare"]);
  git(root, ["clone", bare, work]);
  git(work, ["config", "user.email", "tests@modelmayhem.local"]);
  git(work, ["config", "user.name", "Model Mayhem Tests"]);
  return { bare, work };
}

function writeManifest(work: string, version: string): void {
  const manifestDirectory = join(work, "content", "manifest");
  mkdirSync(manifestDirectory, { recursive: true });
  writeFileSync(
    join(manifestDirectory, "model-mayhem-reference.yaml"),
    [
      "id: model-mayhem-reference",
      `version: ${version}`,
      `rulesetVersion: ${version}`,
      "balanceId: standard-v0.1",
    ].join("\n"),
    "utf8",
  );
}

function writeRepositoryFile(work: string, relativePath: string, value: string): void {
  const path = join(work, "content", relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function commitAndPush(work: string, branch: string, message: string): string {
  git(work, ["add", "content"]);
  git(work, ["commit", "-m", message]);
  git(work, ["push", "-u", "origin", branch]);
  return git(work, ["rev-parse", "HEAD"]);
}

function createInitializedRemote(root: string): RemoteRepository {
  const repository = createRemoteRepository(root);
  writeFileSync(join(repository.work, ".gitattributes"), "* text=auto eol=lf\n", "utf8");
  writeManifest(repository.work, "0.0.1");
  writeRepositoryFile(repository.work, "presentation/cards/model.yaml", "name: 初始模型\n");
  writeRepositoryFile(repository.work, "cards/model.yaml", "id: model\n");
  writeRepositoryFile(repository.work, "balance/standard.yaml", "id: standard-v0.1\n");
  git(repository.work, ["checkout", "-b", "main"]);
  git(repository.work, ["add", ".gitattributes"]);
  commitAndPush(repository.work, "main", "initial content");
  git(repository.work, ["checkout", "-b", "content/stable", "main"]);
  git(repository.work, ["push", "-u", "origin", "content/stable"]);
  git(repository.work, ["checkout", "-b", "balance/stable", "main"]);
  git(repository.work, ["push", "-u", "origin", "balance/stable"]);
  return repository;
}

function updateBranch(
  repository: RemoteRepository,
  branch: "content/stable" | "balance/stable",
  version: string,
  files: Readonly<Record<string, string>>,
): string {
  git(repository.work, ["checkout", branch]);
  writeManifest(repository.work, version);
  for (const [relativePath, value] of Object.entries(files)) {
    writeRepositoryFile(repository.work, relativePath, value);
  }
  return commitAndPush(repository.work, branch, `${branch} ${version}`);
}

function createBootstrapContent(root: string): string {
  const bootstrap = join(root, "bootstrap-content");
  mkdirSync(join(bootstrap, "manifest"), { recursive: true });
  mkdirSync(join(bootstrap, "presentation", "cards"), { recursive: true });
  mkdirSync(join(bootstrap, "cards"), { recursive: true });
  mkdirSync(join(bootstrap, "balance"), { recursive: true });
  writeFileSync(
    join(bootstrap, "manifest", "model-mayhem-reference.yaml"),
    [
      "id: model-mayhem-reference",
      "version: 0.0.1",
      "rulesetVersion: 0.0.1",
      "balanceId: standard-v0.1",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(bootstrap, "presentation", "cards", "model.yaml"), "name: 初始模型\n", "utf8");
  writeFileSync(join(bootstrap, "cards", "model.yaml"), "id: model\n", "utf8");
  writeFileSync(join(bootstrap, "balance", "standard.yaml"), "id: standard-v0.1\n", "utf8");
  return bootstrap;
}

function createUpdater(
  root: string,
  repository: string,
  validateContent: (contentRoot: string) => void | Promise<void> = () => {},
): ContentUpdater {
  return new ContentUpdater({
    appVersion: "0.1.0",
    dataDirectory: join(root, "data"),
    repository,
    contentBranch: "content/stable",
    balanceBranch: "balance/stable",
    channel: "stable",
    checkOnStart: true,
    autoInstall: false,
    validateContent,
    snapshotPlayerData: async (destination) => {
      writeFileSync(destination, "player snapshot", "utf8");
      return {
        databaseSchemaHash: "b".repeat(64),
        lastMigrationId: "0004",
      };
    },
    restorePlayerData: async (source) => {
      expect(readFileSync(source, "utf8")).toBe("player snapshot");
    },
    databaseSchemaHash: () => "b".repeat(64),
    lastMigrationId: () => "0004",
  });
}

async function createInstalledUpdater(
  root: string,
  repository: string,
  validateContent?: (contentRoot: string) => void | Promise<void>,
): Promise<{
  readonly updater: ContentUpdater;
  readonly bootstrap: string;
}> {
  const bootstrap = createBootstrapContent(root);
  const updater = createUpdater(root, repository, validateContent);
  await updater.ensureInitialInstallation(bootstrap, "b".repeat(64), "0004");
  return { updater, bootstrap };
}

describe("ContentUpdater", () => {
  it("兼容旧的迁移标识记录并更新安装指纹", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-legacy-migration-"));
    const repository = createInitializedRemote(root);
    const bootstrap = createBootstrapContent(root);
    const updater = createUpdater(root, repository.bare);

    await updater.ensureInitialInstallation(bootstrap, "b".repeat(64), "legacy-hash");
    const refreshed = await updater.ensureInitialInstallation(
      bootstrap,
      "b".repeat(64),
      "ordered-latest",
      "legacy-hash",
    );

    expect(refreshed.lastMigrationId).toBe("ordered-latest");
    await expect(
      updater.ensureInitialInstallation(bootstrap, "b".repeat(64), "ordered-latest", "legacy-hash"),
    ).resolves.toMatchObject({ lastMigrationId: "ordered-latest" });
  });

  it("两边都没有变化时返回最新", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-up-to-date-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);

    await expect(updater.checkForUpdate()).resolves.toMatchObject({
      status: "up_to_date",
      contentVersion: "0.0.1",
      balanceVersion: "0.0.1",
    });
    expect((await updater.getStatus()).pendingContentCommit).toBeNull();
    expect((await updater.getStatus()).pendingBalanceCommit).toBeNull();
  });

  it("只改变卡面源时只更新卡面版本", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-content-only-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);

    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 更新模型\n",
    });
    const check = await updater.checkForUpdate();
    expect(check).toMatchObject({
      status: "update_available",
      contentVersion: "0.0.2",
      balanceVersion: "0.0.1",
    });
    const installed = await updater.installPending();
    expect(installed.installed.contentVersion).toBe("0.0.2");
    expect(installed.installed.balanceVersion).toBe("0.0.1");
    expect(installed.installed.contentCommit).not.toBe(installed.installed.balanceCommit);
  });

  it("只改变数值源时只更新数值版本", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-balance-only-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);

    updateBranch(repository, "balance/stable", "0.0.2", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 2\n",
    });
    const check = await updater.checkForUpdate();
    expect(check).toMatchObject({
      status: "update_available",
      contentVersion: "0.0.1",
      balanceVersion: "0.0.2",
    });
    const installed = await updater.installPending();
    expect(installed.installed.contentVersion).toBe("0.0.1");
    expect(installed.installed.balanceVersion).toBe("0.0.2");
  });

  it("两个来源同时变化时一次安装成功", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-both-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);

    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 联合更新模型\n",
    });
    updateBranch(repository, "balance/stable", "0.0.2", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 2\n",
    });

    await expect(updater.checkForUpdate()).resolves.toMatchObject({
      status: "update_available",
      contentVersion: "0.0.2",
      balanceVersion: "0.0.2",
    });
    const installed = await updater.installPending();
    expect(installed.installed.contentVersion).toBe("0.0.2");
    expect(installed.installed.balanceVersion).toBe("0.0.2");
  });

  it("组合内容校验失败时保持原安装并清理 pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-validation-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare, (contentRoot) => {
      if (existsSync(join(contentRoot, "balance", "invalid.txt"))) {
        throw new Error("组合内容无效");
      }
    });
    const original = (await updater.getStatus()).active;

    updateBranch(repository, "balance/stable", "0.0.2", {
      "balance/invalid.txt": "invalid\n",
    });
    await expect(updater.checkForUpdate()).rejects.toThrow("组合内容无效");
    expect((await updater.getStatus()).active).toEqual(original);
    expect((await updater.getStatus()).pendingBalanceCommit).toBeNull();
  });

  it("远端提交移动后拒绝安装旧暂存并清理 pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-moved-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);

    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 临时模型\n",
    });
    await updater.checkForUpdate();
    updateBranch(repository, "content/stable", "0.0.3", {
      "presentation/cards/model.yaml": "name: 新模型\n",
    });

    await expect(updater.installPending()).rejects.toThrow("撤回或移动");
    expect((await updater.getStatus()).pendingContentCommit).toBeNull();
  });

  it("双源更新完成 A-B-C 单回滚点轮换", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-rollback-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);
    const first = (await updater.getStatus()).active;
    if (!first) {
      throw new Error("首次安装记录缺失");
    }

    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 第二版模型\n",
    });
    updateBranch(repository, "balance/stable", "0.0.2", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 2\n",
    });
    await updater.checkForUpdate();
    const second = await updater.installPending();

    updateBranch(repository, "content/stable", "0.0.3", {
      "presentation/cards/model.yaml": "name: 第三版模型\n",
    });
    updateBranch(repository, "balance/stable", "0.0.3", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 3\n",
    });
    await updater.checkForUpdate();
    const third = await updater.installPending();

    const firstRelease = join(root, "data", "installation", "releases", first.installationTreeHash);
    const thirdRelease = join(
      root,
      "data",
      "installation",
      "releases",
      third.installed.installationTreeHash,
    );
    expect(existsSync(firstRelease)).toBe(false);
    expect(existsSync(thirdRelease)).toBe(true);

    const rollback = await updater.rollback();
    expect(rollback.restored.contentVersion).toBe(second.installed.contentVersion);
    expect(rollback.restored.balanceVersion).toBe(second.installed.balanceVersion);
    expect(rollback.playerDataRestored).toBe(true);
  });

  it("拒绝来源版本降级并清理 pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-downgrade-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);

    updateBranch(repository, "balance/stable", "0.0.2", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 2\n",
    });
    await updater.checkForUpdate();
    await updater.installPending();
    updateBranch(repository, "balance/stable", "0.0.1", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 0\n",
    });

    await expect(updater.checkForUpdate()).rejects.toThrow("拒绝降级");
    expect((await updater.getStatus()).pendingBalanceCommit).toBeNull();
  });

  it("启动恢复安装事务时同时清理暂存源和组合目录", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-recovery-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);
    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 恢复模型\n",
    });
    updateBranch(repository, "balance/stable", "0.0.2", {
      "balance/standard.yaml": "id: standard-v0.1\nvalue: 2\n",
    });
    await updater.checkForUpdate();
    const installed = await updater.installPending();

    const installationRoot = join(root, "data", "installation");
    const active = JSON.parse(readFileSync(join(installationRoot, "active.json"), "utf8")) as {
      readonly contentDirectory: string;
      readonly installation: typeof installed.installed;
    };
    const rollback = JSON.parse(readFileSync(join(installationRoot, "rollback.json"), "utf8")) as {
      readonly active: typeof active;
      readonly playerDataSnapshot: {
        readonly path: string;
        readonly createdAt: string;
        readonly databaseSchemaHash: string;
        readonly lastMigrationId: string;
      };
    };
    const pendingPath = join(installationRoot, "pending.json");
    const pendingDirectory = join(installationRoot, "temp", "interrupted-pending");
    const combinedContentDirectory = join(pendingDirectory, "combined");
    mkdirSync(combinedContentDirectory, { recursive: true });
    writeFileSync(pendingPath, "pending", "utf8");
    writeFileSync(
      join(installationRoot, "update-transaction.json"),
      `${JSON.stringify(
        {
          kind: "install",
          target: active,
          rollback,
          pendingPath,
          pendingDirectory,
          combinedContentDirectory,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const recovered = await recoverInterruptedUpdateTransaction({
      dataDirectory: join(root, "data"),
      restorePlayerData: async () => {},
    });
    expect(recovered).toBe(true);
    expect(existsSync(pendingPath)).toBe(false);
    expect(existsSync(pendingDirectory)).toBe(false);
    expect(existsSync(combinedContentDirectory)).toBe(false);
  });

  it("同主机陈旧锁可以安全回收", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-lock-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);
    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 锁测试模型\n",
    });
    const lockPath = join(root, "data", "installation", "update.lock");
    writeFileSync(
      lockPath,
      `${JSON.stringify(
        {
          pid: 999_999,
          hostname: hostname(),
          token: "stale-lock-token",
          createdAt: "2026-09-12T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(updater.checkForUpdate()).resolves.toMatchObject({
      status: "update_available",
      contentVersion: "0.0.2",
    });
    expect(existsSync(lockPath)).toBe(false);
  });

  it("同主机存活进程的超龄锁也会被回收", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-lock-age-"));
    const repository = createInitializedRemote(root);
    const { updater } = await createInstalledUpdater(root, repository.bare);
    updateBranch(repository, "content/stable", "0.0.2", {
      "presentation/cards/model.yaml": "name: 超龄锁模型\n",
    });
    const lockPath = join(root, "data", "installation", "update.lock");
    writeFileSync(
      lockPath,
      `${JSON.stringify(
        {
          pid: process.pid,
          hostname: hostname(),
          token: "aged-lock-token",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(updater.checkForUpdate()).resolves.toMatchObject({
      status: "update_available",
      contentVersion: "0.0.2",
    });
    expect(existsSync(lockPath)).toBe(false);
  });
});
