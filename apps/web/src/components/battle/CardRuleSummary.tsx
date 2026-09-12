/**
 * 战斗卡牌规则摘要。
 *
 * 作者：JucieOvo
 *
 * 该组件只把服务端返回的结构化卡牌定义转为可读文本，不推断隐藏信息，也不修改
 * 任何规则状态。
 */

import type { CardSelector, Effect, TriggeredEffect } from "@modelmayhem/model-mayhem-content";
import type { ContentResponse } from "../../api";
import { labelAbility, labelStatus } from "./labels";

type BattleCardInfo = ContentResponse["cards"][number];
type CardLookup = ReadonlyMap<string, BattleCardInfo>;

const attackTypeLabels: Readonly<Record<string, string>> = {
  compute_pressure: "算力压制",
  capital_pressure: "资本挤压",
  score_pressure: "评分压制",
  status_pressure: "状态攻击",
  cost_pressure: "费用污染",
  influence_pressure: "影响力夺取",
};

const deckLabels: Readonly<Record<string, string>> = {
  blueprint: "蓝图",
  action: "行动",
};

const targetLabels: Readonly<Record<string, string>> = {
  self: "自己",
  opponent: "对手",
  self_anchor: "自己的据点",
  opponent_active_anchor: "对手的活动据点",
  opponent_anchor: "对手的据点",
  self_model: "自己的模型",
  opponent_active_model: "对手的活动模型",
  opponent_model: "对手的模型",
};

const turnUnitLabels: Readonly<Record<string, string>> = {
  one_shot: "一次性",
  permanent: "永久",
  rounds: "轮次",
  target_turns: "目标回合",
  consume: "消耗后移除",
};

function targetLabel(target: string): string {
  return targetLabels[target] ?? target;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function selectorText(selector: CardSelector | undefined): string {
  if (!selector) {
    return "";
  }
  const parts: string[] = [];
  if (selector.cardTypes?.length) {
    parts.push(`类型 ${selector.cardTypes.join("、")}`);
  }
  if (selector.subtypes?.length) {
    parts.push(`子类 ${selector.subtypes.join("、")}`);
  }
  if (selector.tagsAll?.length) {
    parts.push(`同时具有 ${selector.tagsAll.join("、")}`);
  }
  if (selector.tagsAny?.length) {
    parts.push(`任一标签 ${selector.tagsAny.join("、")}`);
  }
  if (selector.openness?.length) {
    parts.push(`开放度 ${selector.openness.join("、")}`);
  }
  if (selector.factions?.length) {
    parts.push(`阵营 ${selector.factions.join("、")}`);
  }
  if (selector.abilities?.length) {
    parts.push(`能力 ${selector.abilities.map(labelAbility).join("、")}`);
  }
  return parts.length > 0 ? `（${parts.join("，")}）` : "";
}

function effectText(effect: Effect): string {
  switch (effect.kind) {
    case "effect_attack":
      return `${attackTypeLabels[effect.attackType] ?? effect.attackType}：对${targetLabel(effect.target)}造成 ${effect.amount} 点压力${effect.status ? `，施加${labelStatus(effect.status)}` : ""}，持续 ${effect.durationTurns} 回合${selectorText(effect.selector)}`;
    case "modify_resource":
      return `${targetLabel(effect.target)}${effect.resource === "compute" ? "算力" : "资本"} ${signed(effect.amount)}`;
    case "gain_influence":
      return `${targetLabel(effect.target)}获得 ${effect.amount} 点影响力${effect.frequency === "once_per_round" ? "，每轮一次" : ""}`;
    case "steal_influence":
      return `夺取对手 1 点影响力`;
    case "draw":
      return `${targetLabel(effect.target)}抽 ${effect.amount} 张${deckLabels[effect.deck] ?? effect.deck}`;
    case "grant_status":
      return `对${targetLabel(effect.target)}施加${labelStatus(effect.status)}，持续 ${effect.durationTurns} 回合`;
    case "remove_status":
      return `从${targetLabel(effect.target)}移除最多 ${effect.maxCount} 层${labelStatus(effect.status)}`;
    case "modify_cost":
      return `使${targetLabel(effect.target)}的${effect.resource === "compute" ? "算力" : "资本"}费用 ${signed(effect.amount)}，持续 ${effect.durationRounds} 轮${selectorText(effect.selector)}`;
    case "modify_income":
      return `使${targetLabel(effect.target)}的资本收入 ${signed(effect.amount)}，持续 ${effect.durationRounds} 轮`;
    case "modify_capacity":
      return `使${targetLabel(effect.target)}容量 ${signed(effect.amount)}，持续 ${effect.durationRounds} 轮`;
    case "modify_model_score":
      return `使${targetLabel(effect.target)}模型得分 ${signed(effect.amount)}${effect.ability ? `，作用于${labelAbility(effect.ability)}` : ""}，持续 ${effect.durationRounds} 轮${selectorText(effect.selector)}`;
    case "modify_compute_ceiling":
      return `使${targetLabel(effect.target)}算力上限 ${signed(effect.amount)}，持续 ${effect.durationRounds} 轮`;
    case "benchmark":
      return `发起${effect.benchmarkType === "standard" ? "标准" : effect.benchmarkType === "competitive" ? "竞技" : "头条"} Benchmark，比较${labelAbility(effect.ability)}，${effect.selection === "selected" ? "主动选择参赛模型" : "自动选择最高分模型"}`;
    case "allow_cross_faction_closed":
      return `允许${targetLabel(effect.target)}使用跨财团闭源资产，持续 ${effect.durationRounds} 轮`;
  }
}

function effectList(effects: readonly Effect[]): readonly string[] {
  return effects.map(effectText);
}

function triggeredEffectText(triggered: TriggeredEffect): string {
  const triggerLabels: Readonly<Record<string, string>> = {
    organization_deployed: "部署组织后",
    asset_deployed: "部署资产后",
    model_deployed: "部署模型后",
    technology_installed: "安装技术后",
    turn_started: "回合开始时",
    benchmark_won: "赢得 Benchmark 后",
  };
  return `${triggerLabels[triggered.trigger] ?? triggered.trigger}${selectorText(triggered.selector)}：${effectList(triggered.effects).join("；")}`;
}

function EffectLines({
  effects,
  title,
}: {
  readonly effects: readonly Effect[];
  readonly title: string;
}) {
  if (effects.length === 0) {
    return null;
  }
  return (
    <section className="card-rule-section">
      <strong>{title}</strong>
      <ul>
        {effectList(effects).map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

export function CardRuleSummary({
  card,
  cardLookup,
  compact = false,
}: {
  readonly card: BattleCardInfo;
  readonly cardLookup: CardLookup;
  readonly compact?: boolean;
}) {
  const className = compact ? "card-rule-summary compact" : "card-rule-summary";
  if (card.type === "organization") {
    return (
      <div className={className}>
        {card.description ? <p className="card-rule-description">{card.description}</p> : null}
        <div className="card-rule-facts">
          <span>资本收入 +{card.capitalIncome ?? 0}</span>
          <span>资产容量 {card.capacity ?? 0}</span>
          <span>阵营 {card.faction}</span>
        </div>
        <EffectLines effects={card.passiveEffects ?? []} title="持续效果" />
        {(card.triggeredEffects ?? []).length > 0 ? (
          <section className="card-rule-section">
            <strong>触发效果</strong>
            <ul>
              {(card.triggeredEffects ?? []).map((triggered) => (
                <li key={`${triggered.trigger}-${triggered.effects.length}`}>
                  {triggeredEffectText(triggered)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="card-rule-section">
          <strong>行动组</strong>
          <p>{(card.actionSet ?? []).map((id) => cardLookup.get(id)?.name ?? id).join("、")}</p>
        </section>
      </div>
    );
  }

  if (card.type === "asset" && card.assetKind === "model") {
    return (
      <div className={className}>
        {card.description ? <p className="card-rule-description">{card.description}</p> : null}
        <div className="card-rule-facts">
          <span>开放度 {card.openness}</span>
          <span>阵营 {card.faction ?? "未知"}</span>
          <span>相容标签 {(card.compatibleOrganizationTags ?? []).join("、") || "无"}</span>
        </div>
        <EffectLines effects={card.deployEffects ?? []} title="入场效果" />
        <EffectLines effects={card.passiveEffects ?? []} title="持续效果" />
      </div>
    );
  }

  if (card.type === "asset") {
    return (
      <div className={className}>
        {card.description ? <p className="card-rule-description">{card.description}</p> : null}
        <div className="card-rule-facts">
          <span>
            附件目标{" "}
            {card.attachment === "model"
              ? "模型"
              : card.attachment === "anchor"
                ? "据点"
                : "未指定"}
          </span>
          <span>类型 {card.subtype}</span>
        </div>
        <EffectLines effects={card.deployEffects ?? []} title="安装效果" />
        <EffectLines effects={card.passiveEffects ?? []} title="持续效果" />
      </div>
    );
  }

  if (card.type === "action") {
    return (
      <div className={className}>
        {card.description ? <p className="card-rule-description">{card.description}</p> : null}
        <div className="card-rule-facts">
          <span>目标规则 {card.targeting ?? "无"}</span>
          <span>
            持续时间 {card.duration ? (turnUnitLabels[card.duration] ?? card.duration) : "未知"}
          </span>
        </div>
        <EffectLines effects={card.effects ?? []} title="行动效果" />
        {card.techCheck ? (
          <>
            <EffectLines effects={card.techCheck.baseEffects} title="基础效果" />
            <EffectLines effects={card.techCheck.enhancedEffects} title="强化效果" />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      {card.description ? <p className="card-rule-description">{card.description}</p> : null}
      <div className="card-rule-facts">
        <span>持续时间 {card.durationRounds ?? 0} 轮</span>
      </div>
      <EffectLines effects={card.effects ?? []} title="世界事件效果" />
    </div>
  );
}
