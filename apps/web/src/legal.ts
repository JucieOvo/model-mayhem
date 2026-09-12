/**
 * 合法行动到命令正文的转换。
 *
 * 作者：JucieOvo
 *
 * 转换只选择服务端已经返回的字段，不补造目标或资源。
 */

import type { LegalAction } from "@modelmayhem/model-mayhem-rules";

export function legalActionToCommand(action: LegalAction): unknown {
  switch (action.kind) {
    case "mulligan":
      return {
        kind: "mulligan",
        cardInstanceIds: action.cardInstanceIds,
      };
    case "deploy_organization":
      return {
        kind: "deploy_organization",
        cardInstanceId: action.cardInstanceId,
        slotIndex: action.slotIndex,
      };
    case "deploy_asset":
      return {
        kind: "deploy_asset",
        cardInstanceId: action.cardInstanceId,
        anchorId: action.anchorId,
        ...(action.attachedModelInstanceId
          ? { attachedModelInstanceId: action.attachedModelInstanceId }
          : {}),
      };
    case "play_action":
      return {
        kind: "play_action",
        actionInstanceId: action.actionInstanceId,
        ...(action.targetAnchorId ? { targetAnchorId: action.targetAnchorId } : {}),
        ...(action.targetModelInstanceId
          ? { targetModelInstanceId: action.targetModelInstanceId }
          : {}),
        ...(action.benchmarkModelInstanceId
          ? { benchmarkModelInstanceId: action.benchmarkModelInstanceId }
          : {}),
        ...(action.statusReplacementId ? { statusReplacementId: action.statusReplacementId } : {}),
      };
    case "discard_action":
      return {
        kind: "discard_action",
        actionInstanceId: action.actionInstanceId,
      };
    case "discard_blueprint":
      return {
        kind: "discard_blueprint",
        cardInstanceId: action.cardInstanceId,
      };
    case "set_benchmark_defender":
      return {
        kind: "set_benchmark_defender",
        modelInstanceId: action.modelInstanceId,
      };
    case "resolve_tech_check":
      return {
        kind: "resolve_tech_check",
        optionId: action.optionId,
      };
    case "end_turn":
      return { kind: "end_turn" };
    case "surrender":
      return { kind: "surrender" };
  }
}
