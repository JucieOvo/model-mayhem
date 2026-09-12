/**
 * Model Mayhem 规则定义入口。
 *
 * 作者：JucieOvo
 *
 * 本模块把具体规则、内容包和通用 GameDefinition 契约连接起来。克隆、随机数、
 * 事件序号和快照由通用内核负责，本文件不重复实现这些机制。
 */

import type {
  CommandActor,
  GameCreationInput,
  GameDefinition,
  RuleViolation,
  TransitionContext,
  TransitionResult,
} from "@modelmayhem/game-kernel";
import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import { executeModelMayhemCommand, validateModelMayhemCommand } from "./commands";
import { createInitialMatchState } from "./state";
import type {
  MatchState,
  ModelMayhemCommand,
  ModelMayhemDefinitionOptions,
  ModelMayhemEventPayload,
  ModelMayhemEventType,
  ModelMayhemView,
} from "./types";
import { projectModelMayhemView } from "./view";

/** 创建 Model Mayhem 固定规则版本。 */
export function createModelMayhemDefinition(
  options: ModelMayhemDefinitionOptions,
): GameDefinition<
  MatchState,
  ModelMayhemCommand,
  ModelMayhemEventType,
  ModelMayhemEventPayload,
  ModelMayhemView
> {
  const contentVersion = options.content.manifest.version;
  return {
    id: "model-mayhem",
    version: options.content.balance.version,
    contentVersion,
    createInitialState(
      input: GameCreationInput,
      context: TransitionContext<ModelMayhemEventType, ModelMayhemEventPayload>,
    ): MatchState {
      return createInitialMatchState(options, input, (values) => context.random.shuffle(values));
    },
    validateCommand(
      state: MatchState,
      command: ModelMayhemCommand,
      actor: CommandActor,
    ): RuleViolation | undefined {
      return validateModelMayhemCommand(options, state, command, actor);
    },
    executeCommand(
      state: MatchState,
      command: ModelMayhemCommand,
      actor: CommandActor,
      context: TransitionContext<ModelMayhemEventType, ModelMayhemEventPayload>,
    ): TransitionResult<MatchState, ModelMayhemEventType, ModelMayhemEventPayload> {
      executeModelMayhemCommand(
        options,
        state,
        command,
        actor,
        (min, max) => context.random.nextInt(min, max),
        (values) => context.random.shuffle(values),
        context.emit,
      );
      return {
        state,
        domainEvents: [],
      };
    },
    cloneState(state: MatchState): MatchState {
      return structuredClone(state);
    },
    projectView(state: MatchState, viewer: CommandActor): ModelMayhemView {
      return projectModelMayhemView(options.content, state, viewer);
    },
  };
}

/** 以内容包和座位配置直接创建规则定义。 */
export function createModelMayhemDefinitionFromContent(
  content: ContentPack,
  seats: ModelMayhemDefinitionOptions["seats"],
): ReturnType<typeof createModelMayhemDefinition> {
  return createModelMayhemDefinition({ content, seats });
}
