/**
 * 把一致性快照排队为下一次启动恢复的玩家数据库。
 *
 * 作者：JucieOvo
 *
 * 活动服务持有 SQLite 连接时直接覆盖数据库会破坏 WAL/SHM 状态。因此脚本只校验
 * 快照并写入同目录的待恢复文件，真正的原子替换由服务启动阶段完成。
 */

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

if (!process.argv.includes("--confirm")) {
  throw new Error("恢复会覆盖当前玩家数据。必须显式传入 --confirm。");
}

const sourceArgument = process.argv.find((argument) => argument.startsWith("--snapshot="));
if (!sourceArgument) {
  throw new Error("缺少 --snapshot=<快照路径>");
}
const snapshotPath = resolve(sourceArgument.slice("--snapshot=".length));
if (!existsSync(snapshotPath)) {
  throw new Error(`快照不存在：${snapshotPath}`);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(process.env.MODELMAYHEM_DATA_DIR ?? join(projectRoot, "data"));
const databasePath = resolve(
  process.env.MODELMAYHEM_DATABASE_PATH ?? join(dataDirectory, "model-mayhem.sqlite"),
);

const client = new Database(snapshotPath, { readonly: true, fileMustExist: true });
try {
  const result = client.pragma("quick_check", { simple: true });
  if (result !== "ok") {
    throw new Error(`快照未通过完整性检查：${String(result)}`);
  }
} finally {
  client.close();
}

mkdirSync(dirname(databasePath), { recursive: true });
const pendingPath = `${databasePath}.pending-restore`;
const temporaryPath = `${pendingPath}.${process.pid}.tmp`;
try {
  copyFileSync(snapshotPath, temporaryPath);
  rmSync(pendingPath, { force: true });
  renameSync(temporaryPath, pendingPath);
} catch (error) {
  rmSync(temporaryPath, { force: true });
  throw error;
}

console.log(`玩家数据恢复已排队：${pendingPath}`);
console.log("请停止并重新启动 Model Mayhem，启动阶段会原子替换数据库及其 WAL/SHM。");
