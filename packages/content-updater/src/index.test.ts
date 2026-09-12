/**
 * 系统内容更新事务的真实文件系统测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用真实 Git 仓库、真实 Git 命令和真实临时目录，不替身 Git 行为。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentUpdater } from "./index";

function git(directory: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRemoteRepository(root: string): {
  readonly bare: string;
  readonly work: string;
} {
  const bare = join(root, "remote.git");
  const work = join(root, "work");
  mkdirSync(bare, { recursive: true });
  git(bare, ["init", "--bare"]);
  git(root, ["clone", bare, work]);
  git(work, ["checkout", "-b", "main"]);
  git(work, ["config", "user.email", "tests@modelmayhem.local"]);
  git(work, ["config", "user.name", "Model Mayhem Tests"]);
  return { bare, work };
}

function commitContent(work: string, marker: string): string {
  const manifestDirectory = join(work, "content", "manifest");
  mkdirSync(manifestDirectory, { recursive: true });
  writeFileSync(
    join(manifestDirectory, "model-mayhem-reference.yaml"),
    [
      "id: model-mayhem-reference",
      `version: ${marker}`,
      `rulesetVersion: ${marker}`,
      "balanceId: standard-v0.1",
    ].join("\n"),
    "utf8",
  );
  git(work, ["add", "content"]);
  git(work, ["commit", "-m", `content ${marker}`]);
  git(work, ["push", "-u", "origin", "main"]);
  return git(work, ["rev-parse", "HEAD"]);
}

describe("ContentUpdater", () => {
  it("使用真实 Git 提交完成 A-B-C 更新与单回滚点轮换", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-mayhem-updater-"));
    const repository = createRemoteRepository(root);
    const initialContent = join(root, "initial-content");
    mkdirSync(join(initialContent, "manifest"), { recursive: true });
    writeFileSync(
      join(initialContent, "manifest", "model-mayhem-reference.yaml"),
      [
        "id: model-mayhem-reference",
        "version: 0.0.1",
        "rulesetVersion: 0.0.1",
        "balanceId: standard-v0.1",
      ].join("\n"),
      "utf8",
    );
    const updater = new ContentUpdater({
      appVersion: "0.1.0",
      dataDirectory: join(root, "data"),
      repository: repository.bare,
      branch: "main",
      channel: "stable",
      checkOnStart: true,
      autoInstall: false,
      validateContent: () => {},
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

    const first = await updater.ensureInitialInstallation(initialContent, "b".repeat(64), "0004");
    expect(first.contentVersion).toBe("0.0.1");
    const firstRelease = join(root, "data", "installation", "releases", first.contentTreeHash);

    commitContent(repository.work, "0.0.2");
    const secondCheck = await updater.checkForUpdate();
    expect(secondCheck.status).toBe("update_available");
    const second = await updater.installPending();
    expect(second.previous?.contentVersion).toBe("0.0.1");
    expect(second.installed.contentVersion).toBe("0.0.2");

    commitContent(repository.work, "0.0.3");
    await updater.checkForUpdate();
    const third = await updater.installPending();
    expect(third.previous?.contentVersion).toBe("0.0.2");
    expect(third.installed.contentVersion).toBe("0.0.3");
    expect(existsSync(firstRelease)).toBe(false);

    const rollback = await updater.rollback();
    expect(rollback.restored.contentVersion).toBe("0.0.2");
    expect(rollback.playerDataRestored).toBe(true);

    const thirdRelease = join(
      root,
      "data",
      "installation",
      "releases",
      third.installed.contentTreeHash,
    );
    expect(existsSync(thirdRelease)).toBe(true);
  });
});
