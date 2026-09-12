/**
 * SQLite 仓储真实运行测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用临时 SQLite 文件真实执行迁移、事务、研究解锁和事件保存，不模拟数据库。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
