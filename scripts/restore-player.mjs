/**
 * 从一致性快照恢复玩家数据库。
 *
 * 作者：JucieOvo
 */

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

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

const dataDirectory = resolve(process.env.MODELMAYHEM_DATA_DIR ?? "data");
const databasePath = resolve(
  process.env.MODELMAYHEM_DATABASE_PATH ?? join(dataDirectory, "model-mayhem.sqlite"),
);

copyFileSync(snapshotPath, databasePath);
rmSync(`${databasePath}-wal`, { force: true });
rmSync(`${databasePath}-shm`, { force: true });
console.log(`玩家数据已恢复：${databasePath}`);
