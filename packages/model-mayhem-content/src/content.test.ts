/**
 * 内容包完整性与引用测试。
 *
 * 作者：JucieOvo
 *
 * 测试直接读取仓库 YAML，验证当前唯一卡目标、研究节点和两套可玩预组。
 */

import { describe, expect, it } from "vitest";
import { loadContentPack } from "./loader";

describe("Model Mayhem 内容包", () => {
  const content = loadContentPack();

  it("加载参考内容规模", () => {
    expect(content.cards.size).toBe(content.balance.uniqueCardTarget);
    expect(content.cards.size).toBe(196);
    expect(content.organizations.size).toBe(28);
    expect(content.assets.size).toBe(136);
    expect(content.actions.size).toBe(20);
    expect(content.worldEvents.size).toBe(12);
    expect(content.eras.size).toBe(8);
    expect(content.researchNodes.size).toBe(48);
    expect(content.decks.size).toBe(2);
    expect(content.questions.size).toBe(2);
  });

  it("每个研究分支包含十二个连续节点", () => {
    for (const branch of ["architecture", "training", "systems", "product"] as const) {
      const nodes = [...content.researchNodes.values()]
        .filter((node) => node.branch === branch)
        .sort((left, right) => left.depth - right.depth);
      expect(nodes.map((node) => node.depth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(nodes.map((node) => node.cost)).toEqual([
        20, 30, 45, 65, 85, 110, 150, 200, 260, 330, 410, 500,
      ]);
    }
  });

  it("每套预组均为合法的 24 张蓝图和两张招牌行动", () => {
    for (const deck of content.decks.values()) {
      expect(["china", "west"]).toContain(deck.faction);
      expect(deck.blueprintCardIds).toHaveLength(24);
      expect(deck.signatureActionIds).toHaveLength(2);
      for (const actionId of deck.signatureActionIds) {
        expect(content.actions.get(actionId)?.signature).toBe(true);
      }
    }
  });

  it("reality-v0.2 的每张生成卡都有固定研究奖励入口", () => {
    const rewarded = new Set(
      [...content.researchNodes.values()].flatMap((node) => node.rewardCardIds),
    );
    const generated = [...content.cards.values()].filter(
      (card) => card.balanceVersion === "reality-v0.2" && card.type !== "action",
    );
    expect(generated).toHaveLength(139);
    expect(generated.every((card) => rewarded.has(card.id))).toBe(true);
  });
});
