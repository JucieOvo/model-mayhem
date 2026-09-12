/**
 * Agent 随机牌组测试。
 *
 * 作者：JucieOvo
 */

import { loadContentPack, validateDeckComposition } from "@modelmayhem/model-mayhem-content";
import { describe, expect, it } from "vitest";
import { buildRandomAgentDeck } from "./agent-deck";

const content = loadContentPack();

function sorted(cardIds: readonly string[]): string[] {
  return [...cardIds].sort((left, right) => left.localeCompare(right));
}

function cardById(cardId: string) {
  const card = content.cards.get(cardId);
  if (!card) {
    throw new Error(`测试卡牌不存在：${cardId}`);
  }
  return card;
}

describe("buildRandomAgentDeck", () => {
  it("按公开构筑规则生成合法牌组，并且固定种子结果稳定", () => {
    const left = buildRandomAgentDeck(content, 20260911, "west");
    const right = buildRandomAgentDeck(content, 20260911, "west");
    expect(left).toEqual(right);
    expect(left.faction).toBe("west");
    expect(left.blueprintCardIds).toHaveLength(content.balance.blueprintsPerDeck);
    expect(left.signatureActionIds).toHaveLength(content.balance.signatureSlots);
    expect(content.doctrines.has(left.doctrineId)).toBe(true);
    expect(
      validateDeckComposition(content.cards, content.doctrines, content.balance, left),
    ).toEqual([]);

    const copies = new Map<string, number>();
    let modelCount = 0;
    let technologyCount = 0;
    for (const cardId of left.blueprintCardIds) {
      const card = cardById(cardId);
      expect(card.type === "organization" || card.type === "asset").toBe(true);
      copies.set(cardId, (copies.get(cardId) ?? 0) + 1);
      if (card.subtype === "model") {
        modelCount += 1;
      } else if (card.type === "asset") {
        technologyCount += 1;
      }
    }
    expect(Math.max(...copies.values())).toBeLessThanOrEqual(content.balance.maxCopiesPerCard);
    expect(modelCount).toBeGreaterThanOrEqual(content.balance.minimumModelsPerDeck);
    expect(technologyCount).toBeGreaterThanOrEqual(content.balance.minimumTechnologiesPerDeck);
    for (const actionId of left.signatureActionIds) {
      expect(content.actions.get(actionId)?.signature).toBe(true);
    }
  });

  it("不同种子产生不同的随机分配结果", () => {
    const left = buildRandomAgentDeck(content, 1, "china");
    const right = buildRandomAgentDeck(content, 2, "china");
    expect(sorted(left.blueprintCardIds)).not.toEqual(sorted(right.blueprintCardIds));
  });

  it("中国和西方 Agent 牌组都包含本财团公司，并允许跨财团开放资产", () => {
    const china = buildRandomAgentDeck(content, 20260912, "china");
    const west = buildRandomAgentDeck(content, 20260912, "west");
    for (const deck of [china, west]) {
      expect(
        deck.blueprintCardIds.some((cardId) => {
          const card = cardById(cardId);
          return (
            card.type === "organization" &&
            card.subtype === "company" &&
            card.faction === deck.faction
          );
        }),
      ).toBe(true);
    }
  });
});
