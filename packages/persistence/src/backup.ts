/**
 * SQLite 一致性快照与结构指纹。
 *
 * 作者：JucieOvo
 *
 * 备份使用 better-sqlite3 的真实 backup API，避免在 WAL 模式下复制出不一致
 * 数据库。结构指纹只覆盖表和迁移元数据，不读取玩家可变记录。
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

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
  const row = client
    .prepare(
      `SELECT hash
       FROM __drizzle_migrations
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get() as { readonly hash: string | null } | undefined;
  return row?.hash ?? "none";
}

/**
 * 读取旧发行版曾使用的迁移标识。
 *
 * 早期版本按 hash 的最大值记录迁移，顺序并不代表真实迁移顺序。这里仅用于识别
 * 既有安装记录并平滑升级，新的数据库兼容性检查必须使用 lastMigrationId。
 */
export function legacyLastMigrationId(client: Database.Database): string {
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
  validateDatabaseSnapshot(destination);
  return {
    databaseSchemaHash: databaseSchemaFingerprint(client),
    lastMigrationId: lastMigrationId(client),
  };
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");

function assertSqliteHeader(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
      throw new Error(`数据库恢复快照不是有效的 SQLite 文件：${path}`);
    }
  } finally {
    closeSync(descriptor);
  }
}

/** 验证恢复文件既能被 SQLite 打开，也没有页级一致性错误。 */
export function validateDatabaseSnapshot(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`数据库恢复快照不存在：${path}`);
  }
  assertSqliteHeader(path);
  const client = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = client.pragma("quick_check", { simple: true }) as unknown;
    if (result !== "ok") {
      throw new Error(`数据库恢复快照未通过完整性检查：${String(result)}`);
    }
  } finally {
    client.close();
  }
}

function copyFileDurably(source: string, destination: string): void {
  copyFileSync(source, destination);
  const descriptor = openSync(destination, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replaceCompletedFile(temporaryPath: string, destination: string): void {
  rmSync(destination, { force: true });
  renameSync(temporaryPath, destination);
}

/** 删除 SQLite 主文件及其同目录 WAL/SHM 文件。 */
function removeSqliteFiles(basePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${basePath}${suffix}`, { force: true });
  }
}

/** 把一组 SQLite 文件移动到同目录的新基名，并返回真实移动记录。 */
function moveSqliteFiles(
  sourceBasePath: string,
  destinationBasePath: string,
  moved: { source: string; destination: string }[],
): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${sourceBasePath}${suffix}`;
    if (!existsSync(source)) {
      continue;
    }
    const destination = `${destinationBasePath}${suffix}`;
    renameSync(source, destination);
    moved.push({ source, destination });
  }
}

/** 在替换失败时逆序恢复已经移动的 SQLite 文件。 */
function restoreMovedSqliteFiles(
  moved: readonly { readonly source: string; readonly destination: string }[],
): void {
  for (const entry of [...moved].reverse()) {
    if (existsSync(entry.destination) && !existsSync(entry.source)) {
      renameSync(entry.destination, entry.source);
    }
  }
}

/**
 * 在服务运行时登记数据库恢复请求。
 *
 * 活动 SQLite 连接不能被直接替换，因此快照先复制为待恢复文件，下一次启动在打开
 * 数据库前执行恢复。
 */
export function queueDatabaseRestore(snapshotPath: string, databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
  validateDatabaseSnapshot(snapshotPath);
  const pendingPath = `${databasePath}.pending-restore`;
  const temporaryPath = `${pendingPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    copyFileDurably(snapshotPath, temporaryPath);
    replaceCompletedFile(temporaryPath, pendingPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** 在打开数据库前应用待恢复快照，返回是否实际恢复。 */
export function applyPendingDatabaseRestore(databasePath: string): boolean {
  const pendingPath = `${databasePath}.pending-restore`;
  if (!existsSync(pendingPath)) {
    return false;
  }
  validateDatabaseSnapshot(pendingPath);
  mkdirSync(dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.restore.${process.pid}.${Date.now()}.tmp`;
  const previousPath = `${databasePath}.restore-previous`;
  copyFileDurably(pendingPath, temporaryPath);
  const hasCurrentDatabase = existsSync(databasePath);
  const moved: { source: string; destination: string }[] = [];
  let installed = false;
  try {
    if (hasCurrentDatabase) {
      removeSqliteFiles(previousPath);
      moveSqliteFiles(databasePath, previousPath, moved);
    } else {
      removeSqliteFiles(databasePath);
    }
    try {
      renameSync(temporaryPath, databasePath);
      installed = true;
    } catch (error) {
      restoreMovedSqliteFiles(moved);
      throw error;
    }
    removeSqliteFiles(previousPath);
    rmSync(pendingPath, { force: true });
    return true;
  } catch (error) {
    if (!installed) {
      restoreMovedSqliteFiles(moved);
    }
    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
