/**
 * SQLite 连接和迁移入口。
 *
 * 作者：JucieOvo
 *
 * 数据库使用 better-sqlite3 同步驱动和 Drizzle ORM。启动时启用外键和 WAL，
 * 并执行 Drizzle Kit 生成的迁移。
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIRECTORY = join(moduleDirectory, "..", "drizzle");

export type PersistenceDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface PersistenceConnection {
  readonly client: Database.Database;
  readonly db: PersistenceDatabase;
  close(): void;
}

/** 打开真实 SQLite 文件并执行迁移。 */
export function openPersistence(
  filename: string,
  migrationsDirectory: string = DEFAULT_MIGRATIONS_DIRECTORY,
): PersistenceConnection {
  mkdirSync(dirname(filename), { recursive: true });
  const client = new Database(filename);
  client.pragma("foreign_keys = ON");
  client.pragma("journal_mode = WAL");
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: migrationsDirectory });
  return {
    client,
    db,
    close: () => client.close(),
  };
}
