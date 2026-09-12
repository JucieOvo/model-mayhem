/**
 * 通用确定性对局运行时。
 *
 * 作者：JucieOvo
 *
 * 运行时负责会话序号、随机状态、命令身份、事件落号、状态快照和回放恢复。
 * 业务规则通过 GameDefinition 注入，内核本身不包含具体卡牌或资源概念。
 */

import { GameKernelError } from "./errors";
import { GameRandom } from "./random";
import type {
  CommandActor,
  CommandEnvelope,
  CommandResult,
  DomainEvent,
  GameCreationInput,
  GameDefinition,
  GameEvent,
  GameSessionSnapshot,
  RandomSnapshot,
} from "./types";

/** 运行时内部可变的会话结构。 */
interface MutableSession<TState> {
  gameId: string;
  rulesetId: string;
  rulesetVersion: string;
  contentVersion: string;
  sequence: number;
  random: RandomSnapshot;
  game: TState;
}

/** 驱动规则定义执行命令并维护稳定事件序列。 */
export class GameRuntime<
  TState,
  TCommand,
  TEventType extends string = string,
  TEventPayload = unknown,
  TView = TState,
> {
  private readonly listeners = new Set<(event: GameEvent<TEventType, TEventPayload>) => void>();

  private constructor(
    private readonly definition: GameDefinition<TState, TCommand, TEventType, TEventPayload, TView>,
    private session: MutableSession<TState>,
  ) {}

  /** 使用规则定义和真实种子创建新对局。 */
  static create<
    TState,
    TCommand,
    TEventType extends string = string,
    TEventPayload = unknown,
    TView = TState,
  >(
    definition: GameDefinition<TState, TCommand, TEventType, TEventPayload, TView>,
    input: GameCreationInput,
  ): GameRuntime<TState, TCommand, TEventType, TEventPayload, TView> {
    const random = GameRandom.create(input.seed);
    const domainEvents: DomainEvent<TEventType, TEventPayload>[] = [];
    const game = definition.createInitialState(input, {
      random,
      emit: (event) => domainEvents.push(event),
    });
    if (domainEvents.length > 0) {
      throw new GameKernelError("创建初始状态时不应产生领域事件", "INITIAL_EVENTS_NOT_ALLOWED");
    }
    return new GameRuntime(definition, {
      gameId: input.gameId,
      rulesetId: definition.id,
      rulesetVersion: definition.version,
      contentVersion: definition.contentVersion,
      sequence: 0,
      random: random.snapshot(),
      game,
    });
  }

  /** 从持久化快照恢复对局。 */
  static restore<
    TState,
    TCommand,
    TEventType extends string = string,
    TEventPayload = unknown,
    TView = TState,
  >(
    definition: GameDefinition<TState, TCommand, TEventType, TEventPayload, TView>,
    snapshot: GameSessionSnapshot<TState>,
  ): GameRuntime<TState, TCommand, TEventType, TEventPayload, TView> {
    if (snapshot.rulesetId !== definition.id) {
      throw new GameKernelError(
        `快照规则包 ${snapshot.rulesetId} 与当前规则包 ${definition.id} 不一致`,
        "RULESET_MISMATCH",
      );
    }
    if (snapshot.rulesetVersion !== definition.version) {
      throw new GameKernelError(
        `快照规则版本 ${snapshot.rulesetVersion} 与当前规则版本 ${definition.version} 不一致`,
        "RULESET_VERSION_MISMATCH",
      );
    }
    if (snapshot.contentVersion !== definition.contentVersion) {
      throw new GameKernelError(
        `快照内容版本 ${snapshot.contentVersion} 与当前内容版本 ${definition.contentVersion} 不一致`,
        "CONTENT_VERSION_MISMATCH",
      );
    }
    return new GameRuntime(definition, {
      ...snapshot,
      game: definition.cloneState(snapshot.game),
      random: {
        ...snapshot.random,
        state: [...snapshot.random.state],
      },
    });
  }

  /** 返回指定座位可见的状态投影。 */
  view(actor: CommandActor): TView {
    return this.definition.projectView(this.session.game, actor);
  }

  /** 返回当前完整状态快照，调用方不得直接修改。 */
  snapshot(): GameSessionSnapshot<TState> {
    return {
      gameId: this.session.gameId,
      rulesetId: this.session.rulesetId,
      rulesetVersion: this.session.rulesetVersion,
      contentVersion: this.session.contentVersion,
      sequence: this.session.sequence,
      random: {
        ...this.session.random,
        state: [...this.session.random.state],
      },
      game: this.definition.cloneState(this.session.game),
    };
  }

  /** 订阅已接受命令产生的事件。 */
  subscribe(listener: (event: GameEvent<TEventType, TEventPayload>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 校验并原子执行一个命令。 */
  dispatch(envelope: CommandEnvelope<TCommand>): CommandResult<TState, TEventType, TEventPayload> {
    const violation = this.definition.validateCommand(
      this.session.game,
      envelope.command,
      envelope.actor,
    );
    if (violation) {
      return {
        accepted: false,
        violation,
      };
    }

    const random = GameRandom.fromSnapshot(this.session.random);
    const domainEvents: DomainEvent<TEventType, TEventPayload>[] = [];
    const nextGame = this.definition.cloneState(this.session.game);
    const transition = this.definition.executeCommand(nextGame, envelope.command, envelope.actor, {
      random,
      emit: (event) => domainEvents.push(event),
    });

    const events: GameEvent<TEventType, TEventPayload>[] = domainEvents.map((event, index) => ({
      ...event,
      id: `${envelope.commandId}:${index + 1}`,
      sequence: this.session.sequence + index + 1,
      commandId: envelope.commandId,
      actor: envelope.actor,
    }));

    this.session = {
      ...this.session,
      sequence: this.session.sequence + events.length,
      random: random.snapshot(),
      game: transition.state,
    };

    for (const event of events) {
      for (const listener of this.listeners) {
        listener(event);
      }
    }

    return {
      accepted: true,
      state: transition.state,
      events,
      snapshot: this.snapshot(),
    };
  }
}
