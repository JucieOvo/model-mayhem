/**
 * 合法行动生成器。
 *
 * 作者：JucieOvo
 *
 * 人类界面、Pi 直连工具和 MCP 都只能从该模块生成的行动集合中选择。生成器
 * 调用同一命令校验，因此不会向 Agent 暴露规则不允许的“候选捷径”。
 */

import type { CommandActor, RuleViolation } from "@modelmayhem/game-kernel";
import type { ActionCard, Card, Effect } from "@modelmayhem/model-mayhem-content";
import { isModelEligible } from "./benchmark";
import { validateModelMayhemCommand } from "./commands";
import { getFinalCost } from "./modifiers";
import { requireAction, requireAsset, requireCard, requireOrganization } from "./selectors";
import type {
  ActionPreview,
  LegalAction,
  MatchState,
  ModelMayhemCommand,
  ModelMayhemDefinitionOptions,
} from "./types";

function legalActionId(command: ModelMayhemCommand): string {
  const value = JSON.stringify(command);
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `action-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function previewForCard(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
  card: Card,
  placement: {
    readonly isAction?: boolean;
    readonly deploymentAnchorId?: string;
  } = {},
): ActionPreview {
  const action = card.type === "action" ? card : undefined;
  const effects =
    card.type === "organization"
      ? card.passiveEffects
      : card.type === "asset"
        ? [...card.deployEffects, ...card.passiveEffects]
        : (action?.effects ?? []);
  return {
    cardId: card.id,
    cardName: card.name,
    cost: getFinalCost(options.content, state, actor.seatId, card, {
      ...(placement.isAction === undefined ? {} : { isAction: placement.isAction }),
      ...(placement.deploymentAnchorId ? { deploymentAnchorId: placement.deploymentAnchorId } : {}),
    }),
    effects,
    ...(action?.techCheck
      ? {
          baseEffects: action.techCheck.baseEffects,
          enhancedEffects: action.techCheck.enhancedEffects,
          questionId: action.techCheck.questionId,
        }
      : {}),
  };
}

function enrichAction(
  command: ModelMayhemCommand,
  label: string,
  preview?: ActionPreview,
): LegalAction {
  return {
    ...command,
    id: legalActionId(command),
    label,
    ...(preview ? { preview } : {}),
  } as LegalAction;
}

function accepted(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
  command: ModelMayhemCommand,
): RuleViolation | undefined {
  return validateModelMayhemCommand(options, state, command, actor);
}

function benchmarkEffect(action: ActionCard): Extract<Effect, { kind: "benchmark" }> | undefined {
  return action.effects.find(
    (effect): effect is Extract<Effect, { kind: "benchmark" }> => effect.kind === "benchmark",
  );
}

function mulliganActions(state: MatchState, actor: CommandActor): readonly LegalAction[] {
  const player = state.players[actor.seatId];
  if (!player) {
    return [];
  }
  const hand = player.blueprintHand;
  const count = 2 ** hand.length;
  const actions: LegalAction[] = [];
  for (let mask = 0; mask < count; mask += 1) {
    const cardInstanceIds = hand.filter((_, index) => (mask & (1 << index)) !== 0);
    actions.push(
      enrichAction(
        {
          kind: "mulligan",
          cardInstanceIds,
        },
        cardInstanceIds.length === 0
          ? "保留全部起始手牌"
          : `调度 ${cardInstanceIds.length} 张起始手牌`,
      ),
    );
  }
  return actions;
}

function deploymentActions(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): readonly LegalAction[] {
  const player = state.players[actor.seatId];
  if (!player) {
    return [];
  }
  const actions: LegalAction[] = [];
  for (const cardInstanceId of player.blueprintHand) {
    const instance = state.cardInstances[cardInstanceId];
    if (!instance) {
      continue;
    }
    const card = requireCard(options.content, instance.cardId);
    if (card.type === "organization") {
      for (let slotIndex = 0; slotIndex < options.content.balance.anchorSlots; slotIndex += 1) {
        const command: ModelMayhemCommand = {
          kind: "deploy_organization",
          cardInstanceId,
          slotIndex,
        };
        if (accepted(options, state, actor, command)) {
          continue;
        }
        actions.push(
          enrichAction(
            command,
            `部署 ${card.name} 到据点槽位 ${slotIndex + 1}`,
            previewForCard(options, state, actor, card),
          ),
        );
      }
      continue;
    }
    if (card.type !== "asset") {
      continue;
    }
    for (const anchor of Object.values(state.anchors)) {
      if (anchor.ownerSeatId !== actor.seatId) {
        continue;
      }
      const command: ModelMayhemCommand = {
        kind: "deploy_asset",
        cardInstanceId,
        anchorId: anchor.id,
      };
      if (!accepted(options, state, actor, command)) {
        const anchorName =
          anchor.organizationCardId === null
            ? "主实验室"
            : requireOrganization(options.content, anchor.organizationCardId).name;
        actions.push(
          enrichAction(
            command,
            `安装 ${card.name} 到 ${anchorName}`,
            previewForCard(options, state, actor, card, { deploymentAnchorId: anchor.id }),
          ),
        );
      }
      if (card.assetKind === "technology" && card.attachment === "model") {
        for (const modelInstanceId of anchor.assetInstanceIds) {
          const modelAsset = state.assets[modelInstanceId];
          if (!modelAsset) {
            continue;
          }
          const modelCard = requireAsset(options.content, modelAsset.cardId);
          if (modelCard.assetKind !== "model") {
            continue;
          }
          const attachmentCommand: ModelMayhemCommand = {
            kind: "deploy_asset",
            cardInstanceId,
            anchorId: anchor.id,
            attachedModelInstanceId: modelInstanceId,
          };
          if (!accepted(options, state, actor, attachmentCommand)) {
            actions.push(
              enrichAction(
                attachmentCommand,
                `把 ${card.name} 安装到 ${modelCard.name}`,
                previewForCard(options, state, actor, card, { deploymentAnchorId: anchor.id }),
              ),
            );
          }
        }
      }
    }
  }
  return actions;
}

function actionTargetVariants(
  state: MatchState,
  actor: CommandActor,
  actionInstanceId: string,
  action: ActionCard,
): readonly Extract<ModelMayhemCommand, { kind: "play_action" }>[] {
  const base: Extract<ModelMayhemCommand, { kind: "play_action" }> = {
    kind: "play_action",
    actionInstanceId,
  };
  switch (action.targeting) {
    case "none":
      return [base];
    case "self_anchor":
      return Object.values(state.anchors)
        .filter((anchor) => anchor.ownerSeatId === actor.seatId)
        .map((anchor) => ({ ...base, targetAnchorId: anchor.id }));
    case "opponent_anchor":
      return Object.values(state.anchors)
        .filter((anchor) => anchor.ownerSeatId !== actor.seatId)
        .map((anchor) => ({ ...base, targetAnchorId: anchor.id }));
    case "self_model":
      return Object.values(state.assets)
        .filter((asset) => asset.ownerSeatId === actor.seatId)
        .map((asset) => ({ ...base, targetModelInstanceId: asset.instanceId }));
    case "opponent_model":
      return Object.values(state.assets)
        .filter((asset) => asset.ownerSeatId !== actor.seatId)
        .map((asset) => ({ ...base, targetModelInstanceId: asset.instanceId }));
  }
}

function actionActions(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): readonly LegalAction[] {
  const player = state.players[actor.seatId];
  if (!player) {
    return [];
  }
  const actions: LegalAction[] = [];
  for (const instance of player.actionHand) {
    const action = requireAction(options.content, instance.cardId);
    const targetVariants = actionTargetVariants(state, actor, instance.id, action);
    const benchmark = benchmarkEffect(action);
    for (const command of targetVariants) {
      if (benchmark) {
        for (const asset of Object.values(state.assets)) {
          if (
            asset.ownerSeatId !== actor.seatId ||
            !isModelEligible(options.content, state, asset.instanceId, benchmark.ability)
          ) {
            continue;
          }
          const benchmarkCommand: Extract<ModelMayhemCommand, { kind: "play_action" }> = {
            ...command,
            benchmarkModelInstanceId: asset.instanceId,
          };
          if (accepted(options, state, actor, benchmarkCommand)) {
            continue;
          }
          const modelName = requireAsset(options.content, asset.cardId).name;
          actions.push(
            enrichAction(
              benchmarkCommand,
              `使用 ${action.name}，派出 ${modelName}`,
              previewForCard(options, state, actor, action, { isAction: true }),
            ),
          );
        }
        continue;
      }
      if (accepted(options, state, actor, command)) {
        continue;
      }
      actions.push(
        enrichAction(
          command,
          `使用行动 ${action.name}`,
          previewForCard(options, state, actor, action, { isAction: true }),
        ),
      );
    }
  }
  return actions;
}

function discardActions(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): readonly LegalAction[] {
  const player = state.players[actor.seatId];
  if (!player) {
    return [];
  }
  return player.actionHand.map((instance) =>
    enrichAction(
      {
        kind: "discard_action",
        actionInstanceId: instance.id,
      },
      `弃置 ${requireAction(options.content, instance.cardId).name}`,
    ),
  );
}

function discardBlueprintActions(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): readonly LegalAction[] {
  const player = state.players[actor.seatId];
  if (!player) {
    return [];
  }
  return player.blueprintHand.map((cardInstanceId) => {
    const instance = state.cardInstances[cardInstanceId];
    if (!instance) {
      throw new Error(`蓝图手牌缺少卡牌实例：${cardInstanceId}`);
    }
    return enrichAction(
      {
        kind: "discard_blueprint",
        cardInstanceId,
      },
      `弃置 ${requireCard(options.content, instance.cardId).name}`,
    );
  });
}

function benchmarkDefenderActions(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): readonly LegalAction[] {
  const player = state.players[actor.seatId];
  if (!player) {
    return [];
  }
  const actions: LegalAction[] = [];
  const assignedDefenderModelInstanceId = player.benchmarkDefenderModelInstanceId ?? null;
  if (assignedDefenderModelInstanceId !== null) {
    actions.push(
      enrichAction(
        {
          kind: "set_benchmark_defender",
          modelInstanceId: null,
        },
        "取消守擂模型",
      ),
    );
  }
  for (const asset of Object.values(state.assets)) {
    if (asset.ownerSeatId !== actor.seatId) {
      continue;
    }
    const card = requireAsset(options.content, asset.cardId);
    if (card.assetKind !== "model" || assignedDefenderModelInstanceId === asset.instanceId) {
      continue;
    }
    actions.push(
      enrichAction(
        {
          kind: "set_benchmark_defender",
          modelInstanceId: asset.instanceId,
        },
        `设置 ${card.name} 为守擂模型`,
      ),
    );
  }
  return actions;
}

/** 生成指定座位当前所有合法命令。 */
export function generateLegalActions(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): readonly LegalAction[] {
  if (state.phase === "finished") {
    return [];
  }
  if (state.pendingTechCheck) {
    if (state.pendingTechCheck.casterSeatId !== actor.seatId) {
      return [
        enrichAction(
          {
            kind: "surrender",
          },
          "投降",
        ),
      ];
    }
    const action = requireAction(options.content, state.pendingTechCheck.actionCardId);
    if (!action.techCheck) {
      throw new Error(`待结算行动缺少技术检定：${action.id}`);
    }
    const question = options.content.questions.get(action.techCheck.questionId);
    if (!question) {
      throw new Error(`技术检定题目不存在：${action.techCheck.questionId}`);
    }
    return question.options.map((option) =>
      enrichAction(
        {
          kind: "resolve_tech_check",
          optionId: option.id,
        },
        option.text,
      ),
    );
  }
  if (state.phase === "mulligan") {
    return mulliganActions(state, actor);
  }
  if (state.activeSeatId !== actor.seatId) {
    return [];
  }
  const player = state.players[actor.seatId];
  const canEndTurn =
    player !== undefined &&
    player.actionHand.length <= options.content.balance.actionHandLimit &&
    player.blueprintHand.length <= options.content.balance.blueprintHandLimit;
  return [
    ...(player && player.actionHand.length > options.content.balance.actionHandLimit
      ? discardActions(options, state, actor)
      : []),
    ...(player && player.blueprintHand.length > options.content.balance.blueprintHandLimit
      ? discardBlueprintActions(options, state, actor)
      : []),
    ...deploymentActions(options, state, actor),
    ...actionActions(options, state, actor),
    ...benchmarkDefenderActions(options, state, actor),
    ...(canEndTurn
      ? [
          enrichAction(
            {
              kind: "end_turn",
            },
            "结束回合",
          ),
        ]
      : []),
    enrichAction(
      {
        kind: "surrender",
      },
      "投降",
    ),
  ];
}
