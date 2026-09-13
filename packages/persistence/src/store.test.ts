/**
 * SQLite 仓储真实运行测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用临时 SQLite 文件真实执行迁移、事务、研究解锁和事件保存，不模拟数据库。
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPendingDatabaseRestore,
  createDatabaseSnapshot,
  lastMigrationId,
  legacyLastMigrationId,
  queueDatabaseRestore,
} from "./backup";
import type { PersistenceConnection } from "./database";
import { openPersistence } from "./database";
import { PersistenceStore } from "./store";

const connections: PersistenceConnection[] = [];
const directories: string[] = [];

function createStore(): PersistenceStore {
  const directory = mkdtempSync(join(tmpdir(), "model-mayhem-"));
  directories.push(directory);
  const connection = openPersistence(join(directory, "test.sqlite"));
  connections.push(connection);
  return new PersistenceStore(connection.db, () => "2026-09-11T00:00:00.000Z");
}

afterEach(() => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PersistenceStore", () => {
  it("研究节点在事务中扣除数据并解锁固定奖励", () => {
    const store = createStore();
    store.ensureProfile("local");
    store.recordMatchCompletion({ profileId: "local", researchData: 35 });
    const remaining = store.unlockResearchNode({
      profileId: "local",
      nodeId: "systems_quantization",
      cost: 20,
      rewardCardIds: ["quantization", "small_efficient"],
    });
    expect(remaining).toBe(15);
    expect(store.listResearchNodes("local")).toEqual(["systems_quantization"]);
    expect([...store.listCollection("local")].sort()).toEqual(["quantization", "small_efficient"]);
  });

  it("前置节点未解锁时拒绝后续节点", () => {
    const store = createStore();
    store.ensureProfile("local");
    store.recordMatchCompletion({ profileId: "local", researchData: 100 });
    expect(() =>
      store.unlockResearchNode({
        profileId: "local",
        nodeId: "systems_distillation",
        cost: 35,
        prerequisiteId: "systems_quantization",
        rewardCardIds: ["distillation"],
      }),
    ).toThrow("研究前置节点尚未解锁");
    expect(store.getProfile("local")?.researchData).toBe(100);
  });

  it("拒绝使用相同牌组 ID 覆盖其他档案的牌组", () => {
    const store = createStore();
    store.ensureProfile("left");
    store.ensureProfile("right");
    const deck = store.saveDeck({
      id: "shared-deck-id",
      profileId: "left",
      name: "左档案牌组",
      faction: "china",
      doctrineId: "open_diffusion",
      blueprintCardIds: ["org_deepseek"],
      signatureActionIds: [],
    });
    expect(deck.profileId).toBe("left");
    expect(() =>
      store.saveDeck({
        id: "shared-deck-id",
        profileId: "right",
        name: "越权覆盖",
        faction: "west",
        doctrineId: "frontier_scaling",
        blueprintCardIds: ["org_openai"],
        signatureActionIds: [],
      }),
    ).toThrow("不属于档案 right");
    expect(store.getDeck("shared-deck-id")?.profileId).toBe("left");
    expect(store.getDeck("shared-deck-id")?.name).toBe("左档案牌组");
  });

  it("真实快照可以原子替换被修改的数据库", async () => {
    const directory = mkdtempSync(join(tmpdir(), "model-mayhem-restore-"));
    directories.push(directory);
    const databasePath = join(directory, "restore.sqlite");
    const snapshotPath = join(directory, "snapshot.sqlite");
    const connection = openPersistence(databasePath);
    const store = new PersistenceStore(connection.db, () => "2026-09-13T00:00:00.000Z");
    store.ensureProfile("local");
    store.recordMatchCompletion({ profileId: "local", researchData: 35 });
    await createDatabaseSnapshot(connection.client, snapshotPath);
    connection.close();

    const modified = openPersistence(databasePath);
    const modifiedStore = new PersistenceStore(modified.db, () => "2026-09-13T00:00:00.000Z");
    modifiedStore.recordMatchCompletion({ profileId: "local", researchData: 35 });
    expect(modifiedStore.getProfile("local")?.researchData).toBe(70);
    modified.close();

    queueDatabaseRestore(snapshotPath, databasePath);
    expect(applyPendingDatabaseRestore(databasePath)).toBe(true);
    expect(existsSync(`${databasePath}.pending-restore`)).toBe(false);

    const restored = openPersistence(databasePath);
    const restoredStore = new PersistenceStore(restored.db, () => "2026-09-13T00:00:00.000Z");
    expect(restoredStore.getProfile("local")?.researchData).toBe(35);
    restored.close();
  });

  it("损坏的待恢复快照不会覆盖正式数据库", () => {
    const directory = mkdtempSync(join(tmpdir(), "model-mayhem-corrupt-restore-"));
    directories.push(directory);
    const databasePath = join(directory, "restore.sqlite");
    const pendingPath = `${databasePath}.pending-restore`;
    const connection = openPersistence(databasePath);
    connection.close();
    writeFileSync(pendingPath, "not a sqlite database", "utf8");

    expect(() => applyPendingDatabaseRestore(databasePath)).toThrow("不是有效的 SQLite 文件");
    expect(existsSync(databasePath)).toBe(true);
    expect(existsSync(pendingPath)).toBe(true);
  });

  it("迁移标识按真实写入顺序读取最后一条", () => {
    const directory = mkdtempSync(join(tmpdir(), "model-mayhem-migration-order-"));
    directories.push(directory);
    const connection = openPersistence(join(directory, "migrations.sqlite"));
    connections.push(connection);
    connection.client
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", 9_999_999_999_997);
    connection.client
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("0000000000000000000000000000000000000000000000000000000000000000", 9_999_999_999_999);
    expect(lastMigrationId(connection.client)).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(legacyLastMigrationId(connection.client)).toBe(
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    );
  });
});
