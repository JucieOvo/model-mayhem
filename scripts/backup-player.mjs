/**
 * 本地玩家数据库一致性备份。
 *
 * 作者：JucieOvo
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(process.env.MODELMAYHEM_DATA_DIR ?? join(projectRoot, "data"));
const databasePath = resolve(
  process.env.MODELMAYHEM_DATABASE_PATH ?? join(dataDirectory, "model-mayhem.sqlite"),
);
const backupDirectory = resolve(
  process.env.MODELMAYHEM_BACKUP_DIR ?? join(dataDirectory, "backups", "manual"),
);
mkdirSync(backupDirectory, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const destination = join(backupDirectory, `player-${timestamp}.sqlite`);
const database = new Database(databasePath, { readonly: true });
try {
  await database.backup(destination);
} finally {
  database.close();
}
console.log(`玩家数据已备份：${destination}`);
