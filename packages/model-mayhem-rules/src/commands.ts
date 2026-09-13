/**
 * Model Mayhem 命令校验与执行。
 *
 * 作者：JucieOvo
 *
 * 所有玩家和 Agent 命令都经过同一校验入口。执行阶段只修改通过校验的状态，
 * 并通过事件记录真实结果，不允许调用方直接替换资源或场面。
 */

import type { CommandActor, RuleViolation } from "@modelmayhem/game-kernel";
import type {
  ActionCard,
  AssetCard,
  Card,
  ContentPack,
  Effect,
  ModelCard,
  OrganizationCard,
  StatusId,
} from "@modelmayhem/model-mayhem-content";
import { isModelEligible } from "./benchmark";
import { applyEffects, createEffectTargets } from "./effects";
import {
  canAfford,
  getAnchorCapacity,
  getFinalCost,
  hasCrossFactionClosedAccess,
} from "./modifiers";
import type { EmitEvent } from "./mutations";
import { consumeStatus, finishMatch } from "./mutations";
import { requireAction, requireAsset, requireCard, requireOrganization } from "./selectors";
import { applyDeploymentEffects, endTurn, startPlaying } from "./turn";
import type {
  ActionInstance,
  AnchorState,
  MatchState,
  ModelMayhemCommand,
  ModelMayhemDefinitionOptions,
  PlayerState,
} from "./types";

interface CommandContext {
  readonly options: ModelMayhemDefinitionOptions;
  readonly content: ContentPack;
  readonly emit: EmitEvent;
  readonly shuffle: <T>(values: readonly T[]) => T[];
  readonly randomInt: (min: number, max: number) => number;
}

interface CommandPayment {
  readonly compute: number;
  readonly capital: number;
}

function playerFor(state: MatchState, seatId: string): PlayerState {
  const player = state.players[seatId];
  if (!player) {
    throw new Error(`玩家不存在：${seatId}`);
  }
  return player;
}

function opponentSeatFor(state: MatchState, seatId: string): string {
  const opponent = state.seats.find((candidate) => candidate !== seatId);
  if (!opponent) {
    throw new Error(`对局缺少 ${seatId} 的对手`);
  }
  return opponent;
}

function isActive(state: MatchState, seatId: string): boolean {
  return state.phase === "playing" && state.activeSeatId === seatId;
}

function findHandCard(
  content: ContentPack,
  state: MatchState,
  player: PlayerState,
  cardInstanceId: string,
): Card | undefined {
  if (!player.blueprintHand.includes(cardInstanceId)) {
    return undefined;
  }
  const instance = state.cardInstances[cardInstanceId];
  return instance ? requireCard(content, instance.cardId) : undefined;
}

function getHandCard(context: CommandContext, state: MatchState, cardInstanceId: string): Card {
  const player = playerFor(state, state.activeSeatId ?? "");
  const cardInstance = state.cardInstances[cardInstanceId];
  if (!player.blueprintHand.includes(cardInstanceId) || !cardInstance) {
    throw new Error(`手牌中不存在蓝图实例：${cardInstanceId}`);
  }
  return requireCard(context.content, cardInstance.cardId);
}

function findActionInHand(
  player: PlayerState,
  actionInstanceId: string,
): ActionInstance | undefined {
  return player.actionHand.find((action) => action.id === actionInstanceId);
}

function emptyOrganizationSlot(state: MatchState, seatId: string, slotIndex: number): boolean {
  return !Object.values(state.anchors).some(
    (anchor) =>
      anchor.ownerSeatId === seatId && !anchor.isHomeLab && anchor.slotIndex === slotIndex,
  );
}

function organizationForDeployment(
  content: ContentPack,
  state: MatchState,
  card: Card,
): OrganizationCard | undefined {
  if (card.type !== "organization") {
    return undefined;
  }
  const organization = content.organizations.get(card.id);
  if (!organization) {
    throw new Error(`内容包缺少组织：${card.id}`);
  }
  if (
    organization.subtype === "company" &&
    state.players[state.activeSeatId ?? ""]?.factionLock !== null &&
    state.players[state.activeSeatId ?? ""]?.factionLock !== organization.faction &&
    organization.faction !== "global"
  ) {
    return undefined;
  }
  return organization;
}

function assetForDeployment(content: ContentPack, card: Card): AssetCard | undefined {
  if (card.type !== "asset") {
    return undefined;
  }
  return content.assets.get(card.id);
}

function modelCanUseAnchor(
  content: ContentPack,
  state: MatchState,
  player: PlayerState,
  model: ModelCard,
  anchor: AnchorState,
): boolean {
  if (anchor.isHomeLab) {
    return true;
  }
  if (anchor.organizationCardId === null) {
    return false;
  }
  const organization = requireOrganization(content, anchor.organizationCardId);
  if (
    model.compatibleOrganizationTags.length > 0 &&
    !model.compatibleOrganizationTags.some((tag) => organization.tags.includes(tag))
  ) {
    return false;
  }
  if (
    model.faction !== "global" &&
    player.factionLock !== null &&
    model.faction !== player.factionLock &&
    model.openness === "closed" &&
    !hasCrossFactionClosedAccess(content, state, player.seatId)
  ) {
    return false;
  }
  return true;
}

function validateMulligan(
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "mulligan" }>,
): RuleViolation | undefined {
  if (state.phase !== "mulligan") {
    return { code: "WRONG_PHASE", message: "当前不在起手调度阶段" };
  }
  if (player.mulliganReady) {
    return { code: "ALREADY_READY", message: "该座位已经完成调度" };
  }
  const unique = new Set(command.cardInstanceIds);
  if (unique.size !== command.cardInstanceIds.length) {
    return { code: "DUPLICATE_CARD", message: "调度列表包含重复卡牌实例" };
  }
  for (const cardInstanceId of command.cardInstanceIds) {
    if (!player.blueprintHand.includes(cardInstanceId)) {
      return { code: "CARD_NOT_IN_HAND", message: `调度牌不在手牌中：${cardInstanceId}` };
    }
  }
  return undefined;
}

function validateDeployOrganization(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "deploy_organization" }>,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "当前不是该玩家的主要阶段" };
  }
  if (player.organizationDeploysThisTurn >= context.content.balance.organizationDeploysPerTurn) {
    return { code: "DEPLOY_LIMIT", message: "本回合已经部署过组织" };
  }
  if (command.slotIndex < 0 || command.slotIndex >= context.content.balance.anchorSlots) {
    return { code: "INVALID_SLOT", message: "据点槽位不存在" };
  }
  if (!emptyOrganizationSlot(state, player.seatId, command.slotIndex)) {
    return { code: "SLOT_OCCUPIED", message: "目标据点槽位已经占用" };
  }
  const card = findHandCard(context.content, state, player, command.cardInstanceId);
  if (!card) {
    return { code: "CARD_NOT_IN_HAND", message: "组织卡不在蓝图手牌中" };
  }
  const organization = organizationForDeployment(context.content, state, card);
  if (!organization) {
    return { code: "INVALID_ORGANIZATION", message: "该牌不能作为组织部署，或违反阵营锁" };
  }
  const cost = getFinalCost(context.content, state, player.seatId, card);
  if (!canAfford(player, cost)) {
    return { code: "INSUFFICIENT_RESOURCES", message: "部署组织所需资源不足" };
  }
  return undefined;
}

function validateDeployAsset(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "deploy_asset" }>,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "当前不是该玩家的主要阶段" };
  }
  if (player.assetDeploysThisTurn >= context.content.balance.assetDeploysPerTurn) {
    return { code: "DEPLOY_LIMIT", message: "本回合资产部署次数已用完" };
  }
  const card = findHandCard(context.content, state, player, command.cardInstanceId);
  if (!card) {
    return { code: "CARD_NOT_IN_HAND", message: "资产卡不在蓝图手牌中" };
  }
  const asset = assetForDeployment(context.content, card);
  if (!asset) {
    return { code: "NOT_ASSET", message: "指定卡牌不是资产" };
  }
  const anchor = state.anchors[command.anchorId];
  if (!anchor || anchor.ownerSeatId !== player.seatId) {
    return { code: "INVALID_ANCHOR", message: "资产目标据点无效" };
  }
  const capacity = getAnchorCapacity(context.content, state, anchor.id);
  if (anchor.assetInstanceIds.length >= capacity.final) {
    return { code: "ANCHOR_FULL", message: "目标据点资产容量已满" };
  }
  if (
    asset.assetKind === "model" &&
    !modelCanUseAnchor(context.content, state, player, asset, anchor)
  ) {
    return { code: "INCOMPATIBLE_MODEL", message: "模型标签或阵营条件不满足" };
  }
  if (command.attachedModelInstanceId !== undefined) {
    const targetModel = state.assets[command.attachedModelInstanceId];
    if (
      asset.assetKind !== "technology" ||
      asset.attachment !== "model" ||
      !targetModel ||
      targetModel.ownerSeatId !== player.seatId ||
      targetModel.anchorId !== anchor.id
    ) {
      return { code: "INVALID_ATTACHMENT", message: "技术附件目标无效" };
    }
  }
  const cost = getFinalCost(context.content, state, player.seatId, card, {
    deploymentAnchorId: anchor.id,
  });
  if (!canAfford(player, cost)) {
    return { code: "INSUFFICIENT_RESOURCES", message: "部署资产所需资源不足" };
  }
  return undefined;
}

function actionTargetViolation(
  state: MatchState,
  player: PlayerState,
  action: ActionCard,
  command: Extract<ModelMayhemCommand, { kind: "play_action" }>,
): RuleViolation | undefined {
  const opponent = opponentSeatFor(state, player.seatId);
  switch (action.targeting) {
    case "none":
      return undefined;
    case "self_anchor":
      if (
        !command.targetAnchorId ||
        state.anchors[command.targetAnchorId]?.ownerSeatId !== player.seatId
      ) {
        return { code: "TARGET_REQUIRED", message: "行动需要自己的据点目标" };
      }
      return undefined;
    case "opponent_anchor":
      if (
        !command.targetAnchorId ||
        state.anchors[command.targetAnchorId]?.ownerSeatId !== opponent
      ) {
        return { code: "TARGET_REQUIRED", message: "行动需要对手据点目标" };
      }
      return undefined;
    case "self_model":
      if (
        !command.targetModelInstanceId ||
        state.assets[command.targetModelInstanceId]?.ownerSeatId !== player.seatId
      ) {
        return { code: "TARGET_REQUIRED", message: "行动需要自己的模型目标" };
      }
      return undefined;
    case "opponent_model":
      if (
        !command.targetModelInstanceId ||
        state.assets[command.targetModelInstanceId]?.ownerSeatId !== opponent
      ) {
        return { code: "TARGET_REQUIRED", message: "行动需要对手模型目标" };
      }
      return undefined;
  }
}

function benchmarkEffect(action: ActionCard): Extract<Effect, { kind: "benchmark" }> | undefined {
  return action.effects.find(
    (effect): effect is Extract<Effect, { kind: "benchmark" }> => effect.kind === "benchmark",
  );
}

function validatePlayAction(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "play_action" }>,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "当前不是该玩家的主要阶段" };
  }
  const instance = findActionInHand(player, command.actionInstanceId);
  if (!instance) {
    return { code: "ACTION_NOT_IN_HAND", message: "行动牌不在行动手牌中" };
  }
  const action = requireAction(context.content, instance.cardId);
  const targetViolation = actionTargetViolation(state, player, action, command);
  if (targetViolation) {
    return targetViolation;
  }
  const benchmark = benchmarkEffect(action);
  if (benchmark) {
    if (player.benchmarksThisTurn >= context.content.balance.benchmarksPerTurn) {
      return { code: "BENCHMARK_LIMIT", message: "本回合已经发起过 Benchmark" };
    }
    if (
      !command.benchmarkModelInstanceId ||
      !isModelEligible(
        context.content,
        state,
        command.benchmarkModelInstanceId,
        benchmark.ability,
      ) ||
      state.assets[command.benchmarkModelInstanceId]?.ownerSeatId !== player.seatId
    ) {
      return { code: "INVALID_BENCHMARK_MODEL", message: "参赛模型不合法" };
    }
  }
  if (action.techCheck) {
    if (player.techChecksThisTurn >= context.content.balance.techChecksPerTurn) {
      return { code: "TECH_CHECK_LIMIT", message: "本回合已经触发过技术检定" };
    }
  }
  const cost = getFinalCost(context.content, state, player.seatId, action, {
    isAction: true,
  });
  if (!canAfford(player, cost)) {
    return { code: "INSUFFICIENT_RESOURCES", message: "使用行动所需资源不足" };
  }
  return undefined;
}

function validateDiscardAction(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "discard_action" }>,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "只有当前玩家可以弃置行动牌" };
  }
  if (player.actionHand.length <= context.content.balance.actionHandLimit) {
    return { code: "HAND_LIMIT_NOT_EXCEEDED", message: "行动手牌没有超过上限" };
  }
  if (!findActionInHand(player, command.actionInstanceId)) {
    return { code: "ACTION_NOT_IN_HAND", message: "待弃置行动不在行动手牌中" };
  }
  return undefined;
}

function validateDiscardBlueprint(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "discard_blueprint" }>,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "只有当前玩家可以弃置蓝图牌" };
  }
  if (player.blueprintHand.length <= context.content.balance.blueprintHandLimit) {
    return { code: "HAND_LIMIT_NOT_EXCEEDED", message: "蓝图手牌没有超过上限" };
  }
  if (!player.blueprintHand.includes(command.cardInstanceId)) {
    return { code: "CARD_NOT_IN_HAND", message: "待弃置蓝图不在手牌中" };
  }
  return undefined;
}

function validateTechCheckResolution(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "resolve_tech_check" }>,
): RuleViolation | undefined {
  const pending = state.pendingTechCheck;
  if (!pending || pending.casterSeatId !== player.seatId) {
    return { code: "NO_PENDING_TECH_CHECK", message: "当前没有属于该玩家的技术检定" };
  }
  const deadline = Date.parse(pending.deadlineAt);
  if (!Number.isFinite(deadline)) {
    throw new Error(`技术检定截止时间无效：${pending.deadlineAt}`);
  }
  if ((context.options.now?.() ?? Date.now()) >= deadline) {
    return { code: "TECH_CHECK_EXPIRED", message: "技术检定已经超时，只能由服务端结算" };
  }
  const action = requireAction(context.content, pending.actionCardId);
  if (!action.techCheck) {
    return { code: "QUESTION_NOT_FOUND", message: "待结算行动没有技术检定" };
  }
  const question = context.content.questions.get(action.techCheck.questionId);
  if (!question) {
    return { code: "QUESTION_NOT_FOUND", message: "技术检定题目不存在" };
  }
  if (!question.options.some((option) => option.id === command.optionId)) {
    return { code: "INVALID_OPTION", message: "技术检定选项不存在" };
  }
  return undefined;
}

/**
 * 校验服务端技术检定超时结算。
 *
 * 该命令只能由系统在真实截止时间之后提交，人类和 Agent 都不能主动触发；
 * 超时按答错处理，仍然执行行动的基础效果。
 */
function validateTechCheckTimeout(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  actor: CommandActor,
): RuleViolation | undefined {
  const pending = state.pendingTechCheck;
  if (!pending) {
    return { code: "NO_PENDING_TECH_CHECK", message: "当前没有待结算技术检定" };
  }
  if (actor.kind !== "system") {
    return { code: "TECH_CHECK_TIMEOUT_SYSTEM_ONLY", message: "只有服务端可以结算技术检定超时" };
  }
  if (pending.casterSeatId !== actor.seatId) {
    return { code: "TECH_CHECK_CASTER_MISMATCH", message: "超时结算座位与待结算玩家不一致" };
  }
  const deadline = Date.parse(pending.deadlineAt);
  if (!Number.isFinite(deadline)) {
    throw new Error(`技术检定截止时间无效：${pending.deadlineAt}`);
  }
  const now = options.now?.() ?? Date.now();
  if (now < deadline) {
    return { code: "TECH_CHECK_NOT_EXPIRED", message: "技术检定尚未到达截止时间" };
  }
  return undefined;
}

function validateSetBenchmarkDefender(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "set_benchmark_defender" }>,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "只有当前玩家可以调整守擂模型" };
  }
  if (command.modelInstanceId === null) {
    return undefined;
  }
  const asset = state.assets[command.modelInstanceId];
  if (!asset || asset.ownerSeatId !== player.seatId) {
    return { code: "INVALID_DEFENDER", message: "守擂目标不是自己的场上资产" };
  }
  if (requireAsset(context.content, asset.cardId).assetKind !== "model") {
    return { code: "INVALID_DEFENDER", message: "只有模型可以成为守擂目标" };
  }
  return undefined;
}

function validateEndTurn(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
): RuleViolation | undefined {
  if (!isActive(state, player.seatId)) {
    return { code: "NOT_ACTIVE_SEAT", message: "只有当前玩家可以结束回合" };
  }
  if (player.actionHand.length > context.content.balance.actionHandLimit) {
    return {
      code: "HAND_LIMIT_EXCEEDED",
      message: "行动手牌超过上限，必须先弃置或使用行动牌",
    };
  }
  if (player.blueprintHand.length > context.content.balance.blueprintHandLimit) {
    return {
      code: "HAND_LIMIT_EXCEEDED",
      message: "蓝图手牌超过上限，必须先弃置",
    };
  }
  return undefined;
}

/** 校验一个命令是否可以由指定座位执行。 */
export function validateModelMayhemCommand(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  command: ModelMayhemCommand,
  actor: CommandActor,
): RuleViolation | undefined {
  if (state.phase === "finished") {
    return { code: "MATCH_FINISHED", message: "对局已经结束" };
  }
  const player = state.players[actor.seatId];
  if (!player) {
    return { code: "UNKNOWN_SEAT", message: "命令座位不属于本局" };
  }
  if (command.kind === "surrender") {
    return undefined;
  }
  if (state.pendingTechCheck !== null) {
    if (command.kind === "resolve_tech_check_timeout") {
      return validateTechCheckTimeout(options, state, actor);
    }
    if (command.kind !== "resolve_tech_check") {
      return { code: "PENDING_TECH_CHECK", message: "必须先完成技术检定" };
    }
    return validateTechCheckResolution(
      {
        options,
        content: options.content,
        emit: () => {},
        shuffle: (values) => [...values],
        randomInt: () => 0,
      },
      state,
      player,
      command,
    );
  }
  if (command.kind === "mulligan") {
    return validateMulligan(state, player, command);
  }
  const context: CommandContext = {
    options,
    content: options.content,
    emit: () => {},
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
  switch (command.kind) {
    case "deploy_organization":
      return validateDeployOrganization(context, state, player, command);
    case "deploy_asset":
      return validateDeployAsset(context, state, player, command);
    case "play_action":
      return validatePlayAction(context, state, player, command);
    case "discard_action":
      return validateDiscardAction(context, state, player, command);
    case "discard_blueprint":
      return validateDiscardBlueprint(context, state, player, command);
    case "set_benchmark_defender":
      return validateSetBenchmarkDefender(context, state, player, command);
    case "resolve_tech_check":
      return { code: "NO_PENDING_TECH_CHECK", message: "当前没有待结算技术检定" };
    case "resolve_tech_check_timeout":
      return { code: "NO_PENDING_TECH_CHECK", message: "当前没有待结算技术检定" };
    case "end_turn":
      return validateEndTurn(context, state, player);
  }
}

function payCost(player: PlayerState, cost: CommandPayment): void {
  player.compute -= cost.compute;
  player.capital -= cost.capital;
}

function nextEntityId(state: MatchState, prefix: string): string {
  state.nextEntityOrdinal += 1;
  return `${prefix}-${state.nextEntityOrdinal}`;
}

function deployOrganization(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "deploy_organization" }>,
): void {
  const card = getHandCard(context, state, command.cardInstanceId);
  const organization = requireOrganization(context.content, card.id);
  const finalCost = getFinalCost(context.content, state, player.seatId, card);
  payCost(player, finalCost);
  player.blueprintHand = player.blueprintHand.filter(
    (instanceId) => instanceId !== command.cardInstanceId,
  );
  const anchor: AnchorState = {
    id: nextEntityId(state, "anchor"),
    ownerSeatId: player.seatId,
    organizationCardId: organization.id,
    cardInstanceId: command.cardInstanceId,
    isHomeLab: false,
    slotIndex: command.slotIndex,
    assetInstanceIds: [],
    statuses: [],
  };
  state.anchors[anchor.id] = anchor;
  player.organizationDeploysThisTurn += 1;
  context.emit({
    type: "organization_deployed",
    payload: {
      seatId: player.seatId,
      cardId: organization.id,
      anchorId: anchor.id,
      slotIndex: command.slotIndex,
      finalCost: {
        compute: finalCost.compute,
        capital: finalCost.capital,
      },
    },
  });
  applyDeploymentEffects(
    {
      content: context.content,
      state,
      emit: context.emit,
      shuffle: context.shuffle,
      randomInt: context.randomInt,
    },
    player.seatId,
    "organization_deployed",
    organization.id,
  );
}

function deployAsset(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "deploy_asset" }>,
): void {
  const card = getHandCard(context, state, command.cardInstanceId);
  const assetCard = requireAsset(context.content, card.id);
  const anchor = state.anchors[command.anchorId];
  if (!anchor) {
    throw new Error(`部署目标据点不存在：${command.anchorId}`);
  }
  const finalCost = getFinalCost(context.content, state, player.seatId, card, {
    deploymentAnchorId: anchor.id,
  });
  payCost(player, finalCost);
  player.blueprintHand = player.blueprintHand.filter(
    (instanceId) => instanceId !== command.cardInstanceId,
  );
  state.assets[command.cardInstanceId] = {
    instanceId: command.cardInstanceId,
    cardId: assetCard.id,
    ownerSeatId: player.seatId,
    anchorId: anchor.id,
    ...(command.attachedModelInstanceId
      ? { attachedModelInstanceId: command.attachedModelInstanceId }
      : {}),
    statuses: [],
    lastParticipatedRound: null,
  };
  anchor.assetInstanceIds.push(command.cardInstanceId);
  player.assetDeploysThisTurn += 1;
  if (assetCard.assetKind === "model") {
    consumeStatus(anchor.statuses, anchor.id, "overload", context.emit);
  }
  context.emit({
    type: "asset_deployed",
    payload: {
      seatId: player.seatId,
      cardId: assetCard.id,
      assetInstanceId: command.cardInstanceId,
      anchorId: anchor.id,
      finalCost: {
        compute: finalCost.compute,
        capital: finalCost.capital,
      },
    },
  });
  applyEffects(
    {
      content: context.content,
      state,
      sourceSeatId: player.seatId,
      sourceCardId: assetCard.id,
      sourceInstanceId: command.cardInstanceId,
      sourceAnchorId: anchor.id,
      ...(assetCard.assetKind === "model" ? { sourceModelInstanceId: command.cardInstanceId } : {}),
      targets: createEffectTargets(state, player.seatId, {
        id: command.cardInstanceId,
        cardId: assetCard.id,
        sourceAnchorId: anchor.id,
      }),
      emit: context.emit,
      shuffle: context.shuffle,
      randomInt: context.randomInt,
    },
    assetCard.deployEffects,
  );
  const trigger = assetCard.assetKind === "model" ? "model_deployed" : "technology_installed";
  applyDeploymentEffects(
    {
      content: context.content,
      state,
      emit: context.emit,
      shuffle: context.shuffle,
      randomInt: context.randomInt,
    },
    player.seatId,
    "asset_deployed",
    assetCard.id,
  );
  applyDeploymentEffects(
    {
      content: context.content,
      state,
      emit: context.emit,
      shuffle: context.shuffle,
      randomInt: context.randomInt,
    },
    player.seatId,
    trigger,
    assetCard.id,
  );
}

function removeActionFromHand(player: PlayerState, actionInstanceId: string): ActionInstance {
  const index = player.actionHand.findIndex((action) => action.id === actionInstanceId);
  const action = player.actionHand[index];
  if (!action) {
    throw new Error(`行动手牌不存在：${actionInstanceId}`);
  }
  player.actionHand.splice(index, 1);
  player.actionArchive.push(action.cardId);
  return action;
}

function discardAction(
  context: CommandContext,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "discard_action" }>,
): void {
  const action = removeActionFromHand(player, command.actionInstanceId);
  context.emit({
    type: "action_discarded",
    payload: {
      seatId: player.seatId,
      actionInstanceId: action.id,
      cardId: action.cardId,
      remaining: Math.max(0, player.actionHand.length - context.content.balance.actionHandLimit),
    },
  });
}

function discardBlueprint(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "discard_blueprint" }>,
): void {
  const index = player.blueprintHand.indexOf(command.cardInstanceId);
  const [cardInstanceId] = player.blueprintHand.splice(index, 1);
  if (!cardInstanceId) {
    throw new Error(`蓝图手牌不存在：${command.cardInstanceId}`);
  }
  player.blueprintArchive.push(cardInstanceId);
  const cardId = state.cardInstances[cardInstanceId]?.cardId;
  if (!cardId) {
    throw new Error(`蓝图手牌缺少卡牌实例：${cardInstanceId}`);
  }
  context.emit({
    type: "blueprint_discarded",
    payload: {
      seatId: player.seatId,
      cardInstanceId,
      cardId,
      remaining: Math.max(
        0,
        player.blueprintHand.length - context.content.balance.blueprintHandLimit,
      ),
    },
  });
}

function applyActionEffects(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  action: ActionInstance,
  effects: readonly Effect[],
  targetAnchorId?: string,
  targetModelInstanceId?: string,
  benchmarkModelInstanceId?: string,
  statusReplacementId?: StatusId,
): void {
  applyEffects(
    {
      content: context.content,
      state,
      sourceSeatId: player.seatId,
      sourceCardId: action.cardId,
      sourceInstanceId: action.id,
      ...(action.sourceAnchorId ? { sourceAnchorId: action.sourceAnchorId } : {}),
      targets: createEffectTargets(
        state,
        player.seatId,
        action,
        targetAnchorId,
        targetModelInstanceId,
        benchmarkModelInstanceId,
        statusReplacementId,
      ),
      emit: context.emit,
      shuffle: context.shuffle,
      randomInt: context.randomInt,
    },
    effects,
  );
}

function playAction(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "play_action" }>,
): void {
  const actionInstance = findActionInHand(player, command.actionInstanceId);
  if (!actionInstance) {
    throw new Error(`行动实例不存在：${command.actionInstanceId}`);
  }
  const action = requireAction(context.content, actionInstance.cardId);
  const finalCost = getFinalCost(context.content, state, player.seatId, action, {
    isAction: true,
  });
  if (action.techCheck) {
    if (state.pendingTechCheck !== null) {
      throw new Error("已有待结算技术检定");
    }
    state.pendingTechCheck = {
      actionInstanceId: actionInstance.id,
      actionCardId: action.id,
      casterSeatId: player.seatId,
      deadlineAt: new Date(
        (context.options.now?.() ?? Date.now()) + context.content.balance.techCheckSeconds * 1000,
      ).toISOString(),
      ...(command.targetAnchorId ? { targetAnchorId: command.targetAnchorId } : {}),
      ...(command.targetModelInstanceId
        ? { targetModelInstanceId: command.targetModelInstanceId }
        : {}),
      ...(command.benchmarkModelInstanceId
        ? { benchmarkModelInstanceId: command.benchmarkModelInstanceId }
        : {}),
      ...(command.statusReplacementId ? { statusReplacementId: command.statusReplacementId } : {}),
      finalCost: {
        compute: finalCost.compute,
        capital: finalCost.capital,
      },
    };
    player.techChecksThisTurn += 1;
    context.emit({
      type: "tech_check_started",
      payload: {
        seatId: player.seatId,
        actionCardId: action.id,
        questionId: action.techCheck.questionId,
      },
    });
    return;
  }

  payCost(player, finalCost);
  removeActionFromHand(player, actionInstance.id);
  consumeStatus(player.statuses, player.seatId, "momentum", context.emit);
  context.emit({
    type: "action_played",
    payload: {
      seatId: player.seatId,
      cardId: action.id,
      actionInstanceId: actionInstance.id,
      finalCost: {
        compute: finalCost.compute,
        capital: finalCost.capital,
      },
    },
  });
  applyActionEffects(
    context,
    state,
    player,
    actionInstance,
    action.effects,
    command.targetAnchorId,
    command.targetModelInstanceId,
    command.benchmarkModelInstanceId,
    command.statusReplacementId,
  );
}

/**
 * 结算一个技术检定。
 *
 * 正常作答传入真实选项；超时结算传入空选项并按答错处理。两种情况都会支付费用、
 * 消耗行动并记录完整事件，调用方不能绕过这一入口直接改状态。
 */
function resolveTechCheck(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  optionId: string | null,
  timedOut: boolean,
): void {
  const pending = state.pendingTechCheck;
  if (!pending) {
    throw new Error("没有待结算技术检定");
  }
  const action = requireAction(context.content, pending.actionCardId);
  const techCheck = action.techCheck;
  if (!techCheck) {
    throw new Error(`行动缺少技术检定：${action.id}`);
  }
  const question = context.content.questions.get(techCheck.questionId);
  if (!question) {
    throw new Error(`技术检定题目不存在：${techCheck.questionId}`);
  }
  const actionInstance = findActionInHand(player, pending.actionInstanceId);
  if (!actionInstance) {
    throw new Error(`技术检定行动实例不存在：${pending.actionInstanceId}`);
  }
  const correct = optionId !== null && optionId === question.correctOptionId;
  payCost(player, pending.finalCost);
  removeActionFromHand(player, actionInstance.id);
  consumeStatus(player.statuses, player.seatId, "momentum", context.emit);
  state.pendingTechCheck = null;
  context.emit({
    type: "action_played",
    payload: {
      seatId: player.seatId,
      cardId: action.id,
      actionInstanceId: actionInstance.id,
      finalCost: pending.finalCost,
    },
  });
  context.emit({
    type: "tech_check_resolved",
    payload: {
      seatId: player.seatId,
      actionCardId: action.id,
      optionId,
      correct,
      timedOut,
    },
  });
  applyActionEffects(
    context,
    state,
    player,
    actionInstance,
    correct ? techCheck.enhancedEffects : techCheck.baseEffects,
    pending.targetAnchorId,
    pending.targetModelInstanceId,
    pending.benchmarkModelInstanceId,
    pending.statusReplacementId,
  );
}

function performMulligan(
  context: CommandContext,
  state: MatchState,
  player: PlayerState,
  command: Extract<ModelMayhemCommand, { kind: "mulligan" }>,
): void {
  const selected = new Set(command.cardInstanceIds);
  const returned = player.blueprintHand.filter((instanceId) => selected.has(instanceId));
  player.blueprintHand = player.blueprintHand.filter((instanceId) => !selected.has(instanceId));
  player.blueprintDeck = [...player.blueprintDeck, ...context.shuffle(returned)];
  for (let count = 0; count < command.cardInstanceIds.length; count += 1) {
    const instanceId = player.blueprintDeck.shift();
    if (instanceId === undefined) {
      throw new Error("调度后蓝图牌堆不足");
    }
    player.blueprintHand.push(instanceId);
  }
  player.mulliganReady = true;
  context.emit({
    type: "mulligan_confirmed",
    payload: {
      seatId: player.seatId,
      returnedCount: command.cardInstanceIds.length,
    },
  });
  if (Object.values(state.players).every((candidate) => candidate.mulliganReady)) {
    startPlaying({
      content: context.content,
      state,
      emit: context.emit,
      shuffle: context.shuffle,
      randomInt: context.randomInt,
    });
  }
}

/** 执行已经校验通过的 Model Mayhem 命令。 */
export function executeModelMayhemCommand(
  options: ModelMayhemDefinitionOptions,
  state: MatchState,
  command: ModelMayhemCommand,
  actor: CommandActor,
  randomInt: (min: number, max: number) => number,
  shuffle: <T>(values: readonly T[]) => T[],
  emit: EmitEvent,
): void {
  const context: CommandContext = {
    options,
    content: options.content,
    emit,
    shuffle,
    randomInt,
  };
  const player = playerFor(state, actor.seatId);
  switch (command.kind) {
    case "mulligan":
      performMulligan(context, state, player, command);
      return;
    case "deploy_organization":
      deployOrganization(context, state, player, command);
      return;
    case "deploy_asset":
      deployAsset(context, state, player, command);
      return;
    case "play_action":
      playAction(context, state, player, command);
      return;
    case "discard_action":
      discardAction(context, player, command);
      return;
    case "discard_blueprint":
      discardBlueprint(context, state, player, command);
      return;
    case "set_benchmark_defender":
      player.benchmarkDefenderModelInstanceId = command.modelInstanceId;
      context.emit({
        type: "benchmark_defender_set",
        payload: {
          seatId: player.seatId,
          modelInstanceId: command.modelInstanceId,
        },
      });
      return;
    case "resolve_tech_check":
      resolveTechCheck(context, state, player, command.optionId, false);
      return;
    case "resolve_tech_check_timeout":
      resolveTechCheck(context, state, player, null, true);
      return;
    case "end_turn":
      endTurn({
        content: context.content,
        state,
        emit: context.emit,
        shuffle: context.shuffle,
        randomInt: context.randomInt,
      });
      return;
    case "surrender": {
      const winnerSeatId = opponentSeatFor(state, player.seatId);
      finishMatch(state, winnerSeatId, false, "surrender", emit);
      return;
    }
  }
}
