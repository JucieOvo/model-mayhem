/**
 * Agent 工具注册表与执行器。
 *
 * 作者：JucieOvo
 *
 * 注册表负责工具名唯一性、输入结构校验、座位权限和真实后端调用。Pi 直连工具、
 * Agent SDK、REST 与 MCP 不得复制业务实现。
 */

import { SaveDeckRequestSchema } from "@modelmayhem/contracts";
import { z } from "zod";
import type {
  ToolBackend,
  ToolContext,
  ToolDefinition,
  ToolDescriptor,
  ToolExecutionMode,
  ToolPermission,
} from "./types";
import { ToolGatewayError } from "./types";

const EmptyInputSchema = z.object({}).strict();
const CardIdInputSchema = z
  .object({
    cardId: z.string().min(1),
  })
  .strict();
const RulesInputSchema = z
  .object({
    version: z.string().min(1).optional(),
  })
  .strict();
const WaitInputSchema = z
  .object({
    timeoutMs: z.number().int().min(0).max(300_000).default(30_000),
  })
  .strict();
const UpdateDeckInputSchema = z
  .object({
    deck: SaveDeckRequestSchema,
  })
  .strict();
function defineTool<TSchema extends z.ZodType>(
  descriptor: ToolDescriptor,
  inputSchema: TSchema,
  execute: ToolDefinition<TSchema>["execute"],
): ToolDefinition<TSchema> {
  return {
    ...descriptor,
    inputSchema,
    execute,
  };
}

function assertPermission(context: ToolContext, permission: ToolPermission): void {
  if (!context.permissions.includes(permission)) {
    throw new ToolGatewayError(
      "TOOL_PERMISSION_DENIED",
      `座位 ${context.seatId} 没有 ${permission} 权限`,
    );
  }
}

/** 创建 Model Mayhem 官方工具集合。 */
export function createGameTools(
  backend: ToolBackend,
  semanticActionSchema: z.ZodType,
): readonly ToolDefinition[] {
  return [
    defineTool(
      {
        name: "get_turn_context",
        label: "读取完整回合上下文",
        description:
          "一次返回当前回合的资源、次数、影响力上限、持续效果、世界事件、卡牌摘要和带费用的合法行动。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      EmptyInputSchema,
      (_input, context) => backend.getTurnContext(context),
    ),
    defineTool(
      {
        name: "get_match_state",
        label: "读取公开对局状态",
        description: "获取当前座位可见的公开状态，不包含任何对手隐藏手牌。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      EmptyInputSchema,
      (_input, context) => backend.getMatchState(context),
    ),
    defineTool(
      {
        name: "get_private_state",
        label: "读取自身私有状态",
        description: "获取当前座位自己的手牌、资源和可公开审计的私有状态。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      EmptyInputSchema,
      (_input, context) => backend.getPrivateState(context),
    ),
    defineTool(
      {
        name: "inspect_card",
        label: "查询卡牌",
        description: "查询卡牌公开结构、费用、标签和效果，不返回隐藏技术检定答案。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      CardIdInputSchema,
      (input) => backend.inspectCard(input.cardId),
    ),
    defineTool(
      {
        name: "inspect_rules",
        label: "查询规则",
        description: "读取固定规则版本及其系统参数和公开边界。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      RulesInputSchema,
      (input) => backend.inspectRules(input.version),
    ),
    defineTool(
      {
        name: "simulate_action",
        label: "模拟候选行动",
        description:
          "使用 availableActions 中的语义 action 对象在快照副本上模拟，不接收内部 actionId。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      semanticActionSchema,
      (input, context) => backend.simulateAction(context, input),
    ),
    defineTool(
      {
        name: "perform_action",
        label: "执行语义行动",
        description:
          "执行 availableActions 中的语义 action 对象。内部 actionId 和 commandId 均由服务端解析生成。",
        executionMode: "sequential",
        requiredPermission: "play",
      },
      semanticActionSchema,
      (input, context) => backend.submitAction(context, input),
    ),
    defineTool(
      {
        name: "wait_for_turn",
        label: "等待回合",
        description: "等待当前座位成为主动玩家，超时后返回真实等待结果。",
        executionMode: "parallel",
        requiredPermission: "read",
      },
      WaitInputSchema,
      (input, context) => backend.waitForTurn(context, input.timeoutMs),
    ),
    defineTool(
      {
        name: "get_research_map",
        label: "读取研究地图",
        description: "读取当前档案的研究数据、节点状态和固定卡牌奖励。",
        executionMode: "parallel",
        requiredPermission: "progress",
      },
      EmptyInputSchema,
      (_input, context) => backend.getResearchMap(context),
    ),
    defineTool(
      {
        name: "update_deck",
        label: "更新牌组",
        description: "在对局外保存一套通过收藏、数量和招牌行动校验的牌组。",
        executionMode: "sequential",
        requiredPermission: "progress",
      },
      UpdateDeckInputSchema,
      (input, context) => backend.updateDeck(context, input.deck),
    ),
    defineTool(
      {
        name: "get_replay",
        label: "读取回放",
        description: "读取当前授权对局的事件序列和可公开审计信息。",
        executionMode: "parallel",
        requiredPermission: "replay",
      },
      EmptyInputSchema,
      (_input, context) => backend.getReplay(context),
    ),
  ];
}

/** 可查询、可调用并共享给任何协议适配器的工具网关。 */
export class ToolGateway {
  private readonly tools: ReadonlyMap<string, ToolDefinition>;

  constructor(tools: readonly ToolDefinition[]) {
    const indexed = new Map<string, ToolDefinition>();
    for (const tool of tools) {
      if (indexed.has(tool.name)) {
        throw new ToolGatewayError("DUPLICATE_TOOL", `工具名称重复：${tool.name}`);
      }
      indexed.set(tool.name, tool);
    }
    this.tools = indexed;
  }

  /** 返回稳定的公开工具描述。 */
  list(): readonly ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      executionMode: tool.executionMode,
      requiredPermission: tool.requiredPermission,
    }));
  }

  /** 返回全部工具定义，供 MCP 等协议适配器读取真实输入结构。 */
  listDefinitions(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** 解析并执行一个工具调用。 */
  async execute(toolName: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new ToolGatewayError("TOOL_NOT_FOUND", `工具不存在：${toolName}`);
    }
    assertPermission(context, tool.requiredPermission);
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ToolGatewayError(
        "INVALID_TOOL_INPUT",
        `工具 ${toolName} 输入无效：${JSON.stringify(parsed.error.issues)}`,
      );
    }
    return tool.execute(parsed.data, context);
  }

  /** 返回指定工具的执行模式，提交类工具必须为顺序执行。 */
  executionMode(toolName: string): ToolExecutionMode {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new ToolGatewayError("TOOL_NOT_FOUND", `工具不存在：${toolName}`);
    }
    return tool.executionMode;
  }
}

/** 使用真实后端创建完整网关。 */
export function createToolGateway(
  backend: ToolBackend,
  semanticActionSchema: z.ZodType,
): ToolGateway {
  return new ToolGateway(createGameTools(backend, semanticActionSchema));
}
