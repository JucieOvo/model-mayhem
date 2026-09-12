/**
 * 战斗界面的中文语义与短标签。
 *
 * 作者：JucieOvo
 *
 * 这里只负责展示层翻译，不改变规则数据。未知标识保留原文，方便后续内容扩展和
 * 排查问题。
 */

import type { LegalAction } from "@modelmayhem/model-mayhem-rules";

export type BattleCardTheme = "model" | "technology" | "organization" | "action" | "world";

const abilityLabels: Readonly<Record<string, string>> = {
  reasoning: "推理",
  coding: "编程",
  agent: "代理",
  multimodal: "多模态",
};

const statusLabels: Readonly<Record<string, string>> = {
  heat: "热度",
  controversy: "争议",
  outage: "宕机",
  overload: "过载",
  regulation: "监管",
  training: "训练",
  fortify: "加固",
  momentum: "势头",
  pressure: "承压",
};

const actionSubtypeLabels: Readonly<Record<string, string>> = {
  benchmark: "Benchmark",
  community: "社区",
  market: "市场",
  openness: "开放",
  product: "产品",
  response: "回应",
};

const finishReasonLabels: Readonly<Record<string, string>> = {
  influence_target: "影响力达到目标",
  round_limit: "达到回合上限",
  surrender: "主动投降",
  simultaneous_target: "双方同时达到目标",
};

export function labelAbility(ability: string): string {
  return abilityLabels[ability] ?? ability;
}

export function labelStatus(status: string): string {
  return statusLabels[status] ?? status;
}

export function labelActionSubtype(subtype: string): string {
  return actionSubtypeLabels[subtype] ?? subtype;
}

export function labelFinishReason(reason: string): string {
  return finishReasonLabels[reason] ?? reason;
}

export function shortActionLabel(action: LegalAction): string {
  switch (action.kind) {
    case "deploy_organization":
      return `部署到槽位 ${action.slotIndex + 1}`;
    case "deploy_asset":
      return action.attachedModelInstanceId ? "附加到模型" : "安装到据点";
    case "play_action":
      return "使用行动";
    case "discard_action":
      return "弃置行动";
    case "discard_blueprint":
      return "弃置蓝图";
    case "set_benchmark_defender":
      return action.modelInstanceId === null ? "取消守擂" : "设为守擂";
    case "resolve_tech_check":
      return "提交答案";
    case "mulligan":
      return action.cardInstanceIds.length === 0 ? "保留全部" : "调度手牌";
    case "end_turn":
      return "结束回合";
    case "surrender":
      return "投降";
  }
}

export function formatSignedValue(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function battleCardTheme(card: {
  readonly type: string;
  readonly assetKind?: string;
}): BattleCardTheme {
  if (card.type === "organization") {
    return "organization";
  }
  if (card.type === "asset") {
    return card.assetKind === "model" ? "model" : "technology";
  }
  return card.type === "action" ? "action" : "world";
}
