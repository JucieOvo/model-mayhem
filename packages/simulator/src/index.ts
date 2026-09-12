/**
 * Model Mayhem 无界面模拟器。
 *
 * 作者：JucieOvo
 *
 * 模拟器从持久化快照恢复独立运行时并调用同一规则定义，不复制规则。候选行动
 * 模拟不会修改真实对局状态，结果可带独立根种子用于重复验证。
 */

import type { CommandActor, GameSessionSnapshot } from "@modelmayhem/game-kernel";
import { GameRuntime } from "@modelmayhem/game-kernel";
import type {
  MatchState,
  ModelMayhemCommand,
  ModelMayhemDefinitionOptions,
  ModelMayhemEventPayload,
  ModelMayhemEventType,
} from "@modelmayhem/model-mayhem-rules";
import { createModelMayhemDefinition } from "@modelmayhem/model-mayhem-rules";

export interface SimulationResult {
  readonly accepted: boolean;
  readonly state: MatchState;
  readonly events: readonly {
    readonly sequence: number;
    readonly type: ModelMayhemEventType;
    readonly payload: ModelMayhemEventPayload;
  }[];
  readonly violation?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface SimulationOptions {
  readonly commandIdPrefix?: string;
}

/**
 * 从真实快照模拟一个命令。
 *
 * `snapshot` 不会被修改。模拟使用快照中的随机状态和规则版本，因此结果可以与
 * 正式对局在同一确定性边界上比较。
 */
export function simulateModelMayhemCommand(
  definitionOptions: ModelMayhemDefinitionOptions,
  snapshot: GameSessionSnapshot<MatchState>,
  actor: CommandActor,
  command: ModelMayhemCommand,
  options: SimulationOptions = {},
): SimulationResult {
  const runtime = GameRuntime.restore(createModelMayhemDefinition(definitionOptions), snapshot);
  const result = runtime.dispatch({
    commandId: `${options.commandIdPrefix ?? "simulation"}-${snapshot.sequence + 1}`,
    actor,
    command,
  });
  if (!result.accepted) {
    return {
      accepted: false,
      state: runtime.snapshot().game,
      events: [],
      violation: result.violation,
    };
  }
  return {
    accepted: true,
    state: result.state,
    events: result.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      payload: event.payload,
    })),
  };
}

/** 一次模拟多个候选命令，真实状态保持不变。 */
export function simulateModelMayhemCommands(
  definitionOptions: ModelMayhemDefinitionOptions,
  snapshot: GameSessionSnapshot<MatchState>,
  actor: CommandActor,
  commands: readonly ModelMayhemCommand[],
): readonly SimulationResult[] {
  return commands.map((command, index) =>
    simulateModelMayhemCommand(definitionOptions, snapshot, actor, command, {
      commandIdPrefix: `branch-${index + 1}`,
    }),
  );
}
