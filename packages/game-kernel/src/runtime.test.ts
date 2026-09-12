/**
 * 通用运行时确定性测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用最小技术游戏验证命令、事件、随机数和快照恢复，不包含 Model Mayhem 规则。
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GameRandom, GameRuntime } from "./index";
import type {
  CommandActor,
  GameCreationInput,
  GameDefinition,
  RuleViolation,
  TransitionContext,
  TransitionResult,
} from "./types";

interface CounterState {
  readonly value: number;
}

type CounterCommand = { readonly kind: "increment"; readonly amount: number };
type CounterEvent = "incremented";
type CounterEventPayload = { readonly previous: number; readonly next: number };

const seats = [
  { id: "seat-a", displayName: "甲" },
  { id: "seat-b", displayName: "乙" },
] as const;

const definition: GameDefinition<CounterState, CounterCommand, CounterEvent, CounterEventPayload> =
  {
    id: "counter",
    version: "1.0.0",
    contentVersion: "1.0.0",
    createInitialState(_input: GameCreationInput): CounterState {
      return { value: 0 };
    },
    validateCommand(
      state: CounterState,
      command: CounterCommand,
      actor: CommandActor,
    ): RuleViolation | undefined {
      if (actor.seatId !== "seat-a") {
        return { code: "NOT_ACTIVE_SEAT", message: "只有甲可以增加计数" };
      }
      if (command.amount <= 0) {
        return { code: "INVALID_AMOUNT", message: "增加量必须为正数" };
      }
      if (state.value + command.amount > 100) {
        return { code: "LIMIT_EXCEEDED", message: "计数不能超过 100" };
      }
      return undefined;
    },
    executeCommand(
      state: CounterState,
      command: CounterCommand,
      _actor: CommandActor,
      context: TransitionContext<CounterEvent, CounterEventPayload>,
    ): TransitionResult<CounterState, CounterEvent, CounterEventPayload> {
      const next = state.value + command.amount;
      context.emit({
        type: "incremented",
        payload: { previous: state.value, next },
      });
      return {
        state: { value: next },
        domainEvents: [],
      };
    },
    cloneState(state: CounterState): CounterState {
      return { ...state };
    },
    projectView(state: CounterState): CounterState {
      return { ...state };
    },
  };

describe("GameRuntime", () => {
  it("按绑定参与者执行命令并产生稳定事件序列", () => {
    const runtime = GameRuntime.create(definition, {
      gameId: "match-1",
      seed: 42,
      seats,
    });

    const result = runtime.dispatch({
      commandId: "command-1",
      actor: { seatId: "seat-a", kind: "human" },
      command: { kind: "increment", amount: 3 },
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) {
      throw new Error("测试命令应被接受");
    }
    expect(result.state).toEqual({ value: 3 });
    expect(result.events).toEqual([
      {
        id: "command-1:1",
        sequence: 1,
        commandId: "command-1",
        actor: { seatId: "seat-a", kind: "human" },
        type: "incremented",
        payload: { previous: 0, next: 3 },
      },
    ]);
  });

  it("拒绝非法命令且不改变公开状态", () => {
    const runtime = GameRuntime.create(definition, {
      gameId: "match-2",
      seed: 42,
      seats,
    });
    const result = runtime.dispatch({
      commandId: "command-2",
      actor: { seatId: "seat-b", kind: "agent" },
      command: { kind: "increment", amount: 3 },
    });

    expect(result).toEqual({
      accepted: false,
      violation: { code: "NOT_ACTIVE_SEAT", message: "只有甲可以增加计数" },
    });
    expect(runtime.snapshot().game).toEqual({ value: 0 });
    expect(runtime.snapshot().sequence).toBe(0);
  });

  it("相同种子产生相同随机序列", () => {
    const left = GameRandom.create(20260911);
    const right = GameRandom.create(20260911);

    expect(Array.from({ length: 10 }, () => left.nextInt(0, 999))).toEqual(
      Array.from({ length: 10 }, () => right.nextInt(0, 999)),
    );
  });

  it("任意安全整数种子都产生可重复序列", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_147_483_647 }), (seed) => {
        const left = GameRandom.create(seed);
        const right = GameRandom.create(seed);
        const leftValues = Array.from({ length: 8 }, () => left.nextInt(-1_000_000, 1_000_000));
        const rightValues = Array.from({ length: 8 }, () => right.nextInt(-1_000_000, 1_000_000));
        expect(leftValues).toEqual(rightValues);
      }),
      { numRuns: 100 },
    );
  });
});
