/**
 * SQLite 一致性快照与结构指纹。
 *
 * 作者：JucieOvo
 *
 * 备份使用 better-sqlite3 的真实 backup API，避免在 WAL 模式下复制出不一致
 * 数据库。结构指纹只覆盖表和迁移元数据，不读取玩家可变记录。
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type Database from "better-sqlite3";

export interface DatabaseBackupMetadata {
  readonly databaseSchemaHash: string;
  readonly lastMigrationId: string;
}

/** 对 SQLite 表和结构生成稳定 SHA-256。 */
export function databaseSchemaFingerprint(client: Database.Database): string {
  const rows = client
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as readonly {
    readonly type: string;
    readonly name: string;
    readonly tbl_name: string;
    readonly sql: string | null;
  }[];
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(`${row.type}\u0000${row.name}\u0000${row.tbl_name}\u0000${row.sql ?? ""}\n`);
  }
  return hash.digest("hex");
}

/** 读取 Drizzle 迁移记录的最后一个稳定标识。 */
export function lastMigrationId(client: Database.Database): string {
  const table = client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get() as { readonly name: string } | undefined;
  if (!table) {
    return "none";
  }
  const row = client.prepare("SELECT MAX(hash) AS hash FROM __drizzle_migrations").get() as
    | { readonly hash: string | null }
    | undefined;
  return row?.hash ?? "none";
}

/** 创建真实一致性数据库快照。 */
export async function createDatabaseSnapshot(
  client: Database.Database,
  destination: string,
): Promise<DatabaseBackupMetadata> {
  mkdirSync(dirname(destination), { recursive: true });
  await client.backup(destination);
  return {
    databaseSchemaHash: databaseSchemaFingerprint(client),
    lastMigrationId: lastMigrationId(client),
  };
}

/**
 * 在服务运行时登记数据库恢复请求。
 *
 * 活动 SQLite 连接不能被直接替换，因此快照先复制为待恢复文件，下一次启动在打开
 * 数据库前执行恢复。
 */
export function queueDatabaseRestore(snapshotPath: string, databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
  copyFileSync(snapshotPath, `${databasePath}.pending-restore`);
}

/** 在打开数据库前应用待恢复快照，返回是否实际恢复。 */
export function applyPendingDatabaseRestore(databasePath: string): boolean {
  const pendingPath = `${databasePath}.pending-restore`;
  if (!existsSync(pendingPath)) {
    return false;
  }
  copyFileSync(pendingPath, databasePath);
  rmSync(pendingPath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  return true;
}
