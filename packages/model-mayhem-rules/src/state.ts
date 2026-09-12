/**
 * Model Mayhem 初始状态创建。
 *
 * 作者：JucieOvo
 *
 * 创建流程严格使用内容包中的预组、平衡参数和真实随机数，不生成临时牌或默认
 * 隐藏资源。初始蓝图手牌处于调度阶段，双方确认后才进入第 1 轮。
 */

import type { GameCreationInput } from "@modelmayhem/game-kernel";
import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import type {
  AnchorState,
  MatchSeatSetup,
  MatchState,
  ModelMayhemDefinitionOptions,
  PlayerState,
} from "./types";

interface InitialStateOptions {
  readonly content: ContentPack;
  readonly seats: readonly [MatchSeatSetup, MatchSeatSetup];
}

function createPlayer(
  content: ContentPack,
  seat: MatchSeatSetup,
  seatIds: readonly [string, string],
  createEntityId: (prefix: string) => string,
  cardInstances: MatchState["cardInstances"],
): PlayerState {
  const deck = seat.deck ?? content.decks.get(seat.deckId);
  if (!deck) {
    throw new Error(`预组不存在：${seat.deckId}`);
  }
  const faction = seat.faction ?? deck.faction;
  if (seat.faction !== undefined && seat.faction !== deck.faction) {
    throw new Error(`座位 ${seat.seatId} 的财团与牌组 ${deck.id} 不一致`);
  }
  const cardInstanceIds = deck.blueprintCardIds.map((cardId) => {
    const instanceId = createEntityId("card");
    cardInstances[instanceId] = {
      id: instanceId,
      cardId,
      ownerSeatId: seat.seatId,
    };
    return instanceId;
  });
  return {
    seatId: seat.seatId,
    displayName: seat.displayName,
    faction,
    doctrineId: deck.doctrineId,
    signatureActionIds: deck.signatureActionIds,
    influence: 0,
    capital: seat.seatId === seatIds[0] ? 4 : 5,
    compute: 0,
    turnNumber: 0,
    influenceGainedThisRound: 0,
    influenceSourceIdsThisRound: [],
    blueprintDeck: cardInstanceIds,
    blueprintHand: [],
    blueprintArchive: [],
    blueprintPity: {
      organization: 0,
      model: 0,
      knowledge: 0,
    },
    actionHand: [],
    actionArchive: [],
    mulliganReady: false,
    factionLock: faction,
    organizationDeploysThisTurn: 0,
    assetDeploysThisTurn: 0,
    benchmarksThisTurn: 0,
    techChecksThisTurn: 0,
    benchmarkDefenderModelInstanceId: null,
    benchmarkWins: 0,
    highestBenchmarkScore: 0,
    statuses: [],
    timedModifiers: [],
    nextActionInstanceOrdinal: 0,
  };
}

function createHomeLab(seatId: string, createEntityId: (prefix: string) => string): AnchorState {
  return {
    id: createEntityId(`home-${seatId}`),
    ownerSeatId: seatId,
    organizationCardId: null,
    cardInstanceId: null,
    isHomeLab: true,
    slotIndex: null,
    assetInstanceIds: [],
    statuses: [],
  };
}

/** 使用真实种子创建初始对局状态。 */
export function createInitialMatchState(
  options: InitialStateOptions,
  input: GameCreationInput,
  shuffle: <T>(values: readonly T[]) => T[],
): MatchState {
  const seatIds = [options.seats[0].seatId, options.seats[1].seatId] as const;
  if (
    input.seats.length !== 2 ||
    input.seats[0]?.id !== seatIds[0] ||
    input.seats[1]?.id !== seatIds[1]
  ) {
    throw new Error("通用座位顺序必须与 Model Mayhem 对局配置一致");
  }

  let entityOrdinal = 0;
  const cardInstances: MatchState["cardInstances"] = {};
  const createEntityId = (prefix: string): string => {
    entityOrdinal += 1;
    return `${prefix}-${entityOrdinal}`;
  };

  const players = Object.fromEntries(
    options.seats.map((seat) => [
      seat.seatId,
      createPlayer(options.content, seat, seatIds, createEntityId, cardInstances),
    ]),
  );
  for (const player of Object.values(players)) {
    player.blueprintDeck = shuffle(player.blueprintDeck);
  }

  const anchors: MatchState["anchors"] = {};
  for (const seatId of seatIds) {
    const homeLab = createHomeLab(seatId, createEntityId);
    anchors[homeLab.id] = homeLab;
  }

  const worldEventQueue = shuffle([...options.content.worldEvents.keys()]);
  const state: MatchState = {
    gameId: input.gameId,
    seats: seatIds,
    firstSeatId: seatIds[0],
    activeSeatId: null,
    phase: "mulligan",
    round: 0,
    turnOrderIndex: 0,
    players,
    cardInstances,
    anchors,
    assets: {},
    worldEvent: null,
    worldEventQueue,
    pendingTechCheck: null,
    lastBenchmark: null,
    winnerSeatId: null,
    isDraw: false,
    finishReason: null,
    nextEntityOrdinal: entityOrdinal,
  };

  for (const seat of options.seats) {
    const player = state.players[seat.seatId];
    if (!player) {
      throw new Error(`初始化缺少玩家：${seat.seatId}`);
    }
    for (let count = 0; count < options.content.balance.openingBlueprintHand; count += 1) {
      const instanceId = player.blueprintDeck.shift();
      if (instanceId === undefined) {
        throw new Error(`预组 ${seat.deckId} 不足以创建初始蓝图手牌`);
      }
      player.blueprintHand.push(instanceId);
    }
  }

  return state;
}

/** 从对局状态读取定义选项对应的座位配置。 */
export function getSeatSetup(
  options: ModelMayhemDefinitionOptions,
  seatId: string,
): MatchSeatSetup {
  const seat = options.seats.find((candidate) => candidate.seatId === seatId);
  if (!seat) {
    throw new Error(`对局配置缺少座位：${seatId}`);
  }
  return seat;
}
