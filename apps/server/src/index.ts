/**
 * Model Mayhem 本地服务启动入口。
 *
 * 作者：JucieOvo
 *
 * 启动时只加载内容、数据库和 Pi 运行时代码，不调用大模型。只有对局中轮到 Agent
 * 且存在 DEEPSEEK_API_KEY 时，才由 Agent Runner 发起真实模型请求。
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { ContentUpdater } from "@modelmayhem/content-updater";
import { loadContentPack } from "@modelmayhem/model-mayhem-content";
import {
  applyPendingDatabaseRestore,
  createDatabaseSnapshot,
  databaseSchemaFingerprint,
  lastMigrationId,
  openPersistence,
  PersistenceStore,
  queueDatabaseRestore,
} from "@modelmayhem/persistence";
import { createPiBattleAgentRunner } from "@modelmayhem/pi-agent-adapter";
import { createServerRuntime } from "./app";
import { loadServerConfig } from "./config";
import { createLocalLogger } from "./logging";
import { safeError } from "./redaction";

function loadLocalEnvironment(): void {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const environmentPath = resolve(process.env.MODELMAYHEM_ENV_FILE ?? join(projectRoot, ".env"));
  if (existsSync(environmentPath)) {
    loadEnvFile(environmentPath);
  }
}

export async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = loadServerConfig();
  applyPendingDatabaseRestore(config.databasePath);
  const persistence = openPersistence(config.databasePath);
  const store = new PersistenceStore(persistence.db);
  const localLogger = createLocalLogger({
    directory: config.logDirectory,
    level: config.logLevel,
    maxBytes: config.logMaxBytes,
    maxFiles: config.logMaxFiles,
  });
  const updater = new ContentUpdater({
    appVersion: "0.1.0",
    dataDirectory: config.dataDirectory,
    ...(config.updateRepository ? { repository: config.updateRepository } : {}),
    branch: config.updateBranch,
    channel: config.updateChannel,
    checkOnStart: config.updateCheckOnStart,
    autoInstall: config.updateAutoInstall,
    gitExecutable: config.gitExecutable,
    contentPath: config.updateContentPath,
    validateContent: (root) => {
      loadContentPack(root);
    },
    snapshotPlayerData: (destination) => createDatabaseSnapshot(persistence.client, destination),
    restorePlayerData: (snapshotPath) => {
      queueDatabaseRestore(snapshotPath, config.databasePath);
    },
    databaseSchemaHash: () => databaseSchemaFingerprint(persistence.client),
    lastMigrationId: () => lastMigrationId(persistence.client),
  });
  await updater.ensureInitialInstallation(
    config.contentDirectory,
    databaseSchemaFingerprint(persistence.client),
    lastMigrationId(persistence.client),
  );
  if (config.updateRepository && config.updateCheckOnStart) {
    try {
      const check = await updater.checkForUpdate();
      localLogger.logger.info(
        {
          category: "update",
          status: check.status,
          remoteCommit: check.remoteCommit,
          contentVersion: check.contentVersion,
        },
        "启动更新检查完成",
      );
      if (check.status === "update_available" && config.updateAutoInstall) {
        const installed = await updater.installPending();
        localLogger.logger.info(
          {
            category: "update",
            contentVersion: installed.installed.contentVersion,
            contentCommit: installed.installed.contentCommit,
          },
          "启动自动更新已安装",
        );
      }
    } catch (error) {
      localLogger.logger.warn(
        { category: "update", error: safeError(error) },
        "启动更新检查失败，继续使用当前安装",
      );
    }
  }
  const contentDirectory = updater.resolveContentDirectory(config.contentDirectory);
  const content = loadContentPack(contentDirectory);
  const runtime = createServerRuntime({
    content,
    persistence,
    store,
    profileId: config.profileId,
    appVersion: "0.1.0",
    dataDirectory: config.dataDirectory,
    agentRuntimeDirectory: config.agentRuntimeDirectory,
    updateUpdater: updater,
    localLogger,
    webDirectory: config.webDirectory,
    corsOrigins: config.corsOrigins,
    sandboxConfig: {
      enabled: config.sandboxEnabled && config.devApiEnabled,
      remoteEnabled: config.devRemoteEnabled,
      profileId: config.sandboxProfileId,
    },
    agentRunner: createPiBattleAgentRunner({
      runtimeDirectory: config.agentRuntimeDirectory,
      allowedRuntimeRoot: config.dataDirectory,
      promptTimeoutMs: config.piAgentPromptTimeoutMs,
      toolTimeoutMs: config.piAgentToolTimeoutMs,
    }),
  });
  const server = serve({
    fetch: runtime.app.fetch,
    hostname: config.host,
    port: config.port,
  });
  console.log(`Model Mayhem 服务已启动：http://${config.host}:${config.port}`);
  console.log(`规则版本：${content.balance.version}`);
  console.log(`内容版本：${content.manifest.version}`);
  console.log(`内容目录：${contentDirectory}`);
  console.log(`数据库：${config.databasePath}`);
  console.log(`日志目录：${config.logDirectory}`);

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    console.log(`收到 ${signal}，正在关闭服务`);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await runtime.close();
    localLogger.close();
  };
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
