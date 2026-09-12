/**
 * 通用游戏内核的公共类型。
 *
 * 作者：JucieOvo
 *
 * 本模块只描述状态机、命令、事件、参与者与视图契约。它不定义资源、回合、
 * 胜负条件或任何具体题材规则，具体游戏必须通过 GameDefinition 注入。
 */

import type { GameRandom } from "./random";

/** 参与者来源，用于审计人类、Agent 与系统的命令。 */
export type ActorKind = "human" | "agent" | "system";

/** 命令发起者。seatId 由服务端生成，不能由命令正文自行指定。 */
export interface CommandActor {
  readonly seatId: string;
  readonly kind: ActorKind;
}

/** 内核能够识别的座位快照，具体座位定义由游戏规则解释。 */
export interface SeatDefinition {
  readonly id: string;
  readonly displayName: string;
}

/** 创建一局游戏所需的通用输入。 */
export interface GameCreationInput {
  readonly gameId: string;
  readonly seed: number;
  readonly seats: readonly SeatDefinition[];
}

/** 每个命令使用独立稳定标识，便于事件追踪和幂等处理。 */
export interface CommandEnvelope<TCommand> {
  readonly commandId: string;
  readonly actor: CommandActor;
  readonly command: TCommand;
}

/** 规则拒绝命令时返回的结构化错误。 */
export interface RuleViolation {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** 尚未分配全局序列号的领域事件。 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly type: TType;
  readonly payload: TPayload;
}

/** 已写入对局日志的事件信封。 */
export interface GameEvent<TType extends string = string, TPayload = unknown>
  extends DomainEvent<TType, TPayload> {
  readonly id: string;
  readonly sequence: number;
  readonly commandId: string;
  readonly actor: CommandActor;
}

/** 规则解释器向领域效果开放的受控上下文。 */
export interface TransitionContext<TType extends string = string, TPayload = unknown> {
  readonly random: GameRandom;
  readonly emit: (event: DomainEvent<TType, TPayload>) => void;
}

/** 规则解释器产生的纯结果。 */
export interface TransitionResult<TState, TType extends string = string, TPayload = unknown> {
  readonly state: TState;
  readonly domainEvents: readonly DomainEvent<TType, TPayload>[];
}

/** 游戏规则包必须实现的完整契约。 */
export interface GameDefinition<
  TState,
  TCommand,
  TEventType extends string = string,
  TEventPayload = unknown,
  TView = TState,
> {
  /** 稳定规则包标识。 */
  readonly id: string;
  /** 规则实现版本，回放必须记录并固定该版本。 */
  readonly version: string;
  /** 当前内容包版本，用于区分同规则下的不同内容快照。 */
  readonly contentVersion: string;
  /** 创建初始领域状态，可使用注入的确定性随机数洗牌。 */
  createInitialState(
    input: GameCreationInput,
    context: TransitionContext<TEventType, TEventPayload>,
  ): TState;
  /** 只读校验命令是否合法，不允许修改状态。 */
  validateCommand(state: TState, command: TCommand, actor: CommandActor): RuleViolation | undefined;
  /** 执行已经通过校验的命令，必须返回新状态和真实领域事件。 */
  executeCommand(
    state: TState,
    command: TCommand,
    actor: CommandActor,
    context: TransitionContext<TEventType, TEventPayload>,
  ): TransitionResult<TState, TEventType, TEventPayload>;
  /** 深复制领域状态，供模拟器和原子提交使用。 */
  cloneState(state: TState): TState;
  /** 生成指定参与者可见的视图，默认实现由具体规则提供。 */
  projectView(state: TState, viewer: CommandActor): TView;
}

/** 可持久化和恢复的完整对局会话。 */
export interface GameSessionSnapshot<TState> {
  readonly gameId: string;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly contentVersion: string;
  readonly sequence: number;
  readonly random: RandomSnapshot;
  readonly game: TState;
}

/** pure-rand 生成器的序列化状态。 */
export interface RandomSnapshot {
  readonly algorithm: "xoroshiro128plus";
  readonly state: readonly number[];
  readonly draws: number;
}

/** 命令成功提交后的返回值。 */
export interface CommandAccepted<
  TState,
  TEventType extends string = string,
  TEventPayload = unknown,
> {
  readonly accepted: true;
  readonly state: TState;
  readonly events: readonly GameEvent<TEventType, TEventPayload>[];
  readonly snapshot: GameSessionSnapshot<TState>;
}

/** 命令被规则拒绝时的返回值。 */
export interface CommandRejected {
  readonly accepted: false;
  readonly violation: RuleViolation;
}

/** 所有命令提交的统一结果。 */
export type CommandResult<TState, TEventType extends string = string, TEventPayload = unknown> =
  | CommandAccepted<TState, TEventType, TEventPayload>
  | CommandRejected;
