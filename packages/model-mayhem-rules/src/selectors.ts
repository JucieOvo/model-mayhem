/**
 * 内容选择器和标签匹配工具。
 *
 * 作者：JucieOvo
 *
 * 规则引擎统一使用标签和结构化选择器判断目标，不允许在业务分支中比较具体卡名。
 */

import type {
  Ability,
  ActionCard,
  AssetCard,
  Card,
  CardSelector,
  ContentPack,
  ModelCard,
  OrganizationCard,
  TechnologyCard,
} from "@modelmayhem/model-mayhem-content";
import type { SelectorCardContext } from "./types";

/** 从内容包读取卡牌，不存在时直接抛出数据错误。 */
export function requireCard(content: ContentPack, cardId: string): Card {
  const card = content.cards.get(cardId);
  if (!card) {
    throw new Error(`内容包缺少卡牌：${cardId}`);
  }
  return card;
}

/** 从内容包读取组织卡。 */
export function requireOrganization(content: ContentPack, cardId: string): OrganizationCard {
  const card = content.organizations.get(cardId);
  if (!card) {
    throw new Error(`内容包缺少组织卡：${cardId}`);
  }
  return card;
}

/** 从内容包读取模型或技术卡。 */
export function requireAsset(content: ContentPack, cardId: string): AssetCard {
  const card = content.assets.get(cardId);
  if (!card) {
    throw new Error(`内容包缺少资产卡：${cardId}`);
  }
  return card;
}

/** 从内容包读取行动卡。 */
export function requireAction(content: ContentPack, cardId: string): ActionCard {
  const card = content.actions.get(cardId);
  if (!card) {
    throw new Error(`内容包缺少行动卡：${cardId}`);
  }
  return card;
}

/** 判断模型是否为模型卡。 */
export function isModelCard(card: AssetCard): card is ModelCard {
  return card.assetKind === "model";
}

/** 判断资产是否为技术卡。 */
export function isTechnologyCard(card: AssetCard): card is TechnologyCard {
  return card.assetKind === "technology";
}

/** 返回模型四维中大于零的能力。 */
export function positiveAbilities(model: ModelCard): readonly Ability[] {
  return (Object.entries(model.abilities) as [Ability, number][])
    .filter(([, value]) => value > 0)
    .map(([ability]) => ability);
}

/** 把任意卡牌转换为选择器需要的公开字段。 */
export function cardToSelectorContext(card: Card): SelectorCardContext {
  if (card.type === "asset") {
    if (card.assetKind !== "model") {
      return {
        cardId: card.id,
        type: card.type,
        subtype: card.subtype,
        tags: card.tags,
      };
    }
    return {
      cardId: card.id,
      type: card.type,
      subtype: card.subtype,
      tags: card.tags,
      openness: card.openness,
      faction: card.faction,
      abilities: positiveAbilities(card),
    };
  }
  if (card.type === "organization") {
    return {
      cardId: card.id,
      type: card.type,
      subtype: card.subtype,
      tags: card.tags,
      openness: card.openness,
      faction: card.faction,
    };
  }
  return {
    cardId: card.id,
    type: card.type,
    subtype: card.subtype,
    tags: card.tags,
  };
}

/** 判断卡牌是否满足结构化选择器。 */
export function matchesSelector(selector: CardSelector, card: SelectorCardContext): boolean {
  if (selector.cardTypes !== undefined && !selector.cardTypes.includes(card.type)) {
    return false;
  }
  if (selector.subtypes !== undefined && !selector.subtypes.includes(card.subtype)) {
    return false;
  }
  if (selector.tagsAll !== undefined && !selector.tagsAll.every((tag) => card.tags.includes(tag))) {
    return false;
  }
  if (
    selector.tagsAny !== undefined &&
    selector.tagsAny.length > 0 &&
    !selector.tagsAny.some((tag) => card.tags.includes(tag))
  ) {
    return false;
  }
  if (selector.openness !== undefined) {
    if (card.openness === undefined || !selector.openness.includes(card.openness)) {
      return false;
    }
  }
  if (selector.factions !== undefined) {
    if (card.faction === undefined || !selector.factions.includes(card.faction)) {
      return false;
    }
  }
  if (selector.abilities !== undefined && selector.abilities.length > 0) {
    if (
      card.abilities === undefined ||
      !selector.abilities.some((ability) => card.abilities?.includes(ability))
    ) {
      return false;
    }
  }
  return true;
}

/** 判断组织是否带有所有指定标签。 */
export function organizationHasTags(
  organization: OrganizationCard,
  tags: readonly string[],
): boolean {
  if (tags.length === 0) {
    return true;
  }
  return tags.some((tag) => organization.tags.includes(tag));
}
