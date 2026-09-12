/**
 * 标准 MCP 接口绑定。
 *
 * 作者：JucieOvo
 *
 * MCP 是同一个对局服务上的协议入口，不是第二套游戏服务。绑定层只负责把统一工具
 * 网关注册到标准 MCP 工具与资源，所有权限和规则执行仍由网关与后端完成。
 */

import {
  createMcpHandler,
  type McpHttpHandler,
  type McpRequestContext,
  McpServer,
} from "@modelcontextprotocol/server";
import type { ToolContext, ToolGateway } from "@modelmayhem/game-tools";
import { loadOfficialSkillReference } from "@modelmayhem/skills";

export type { McpHttpHandler } from "@modelcontextprotocol/server";

export interface McpBindingOptions {
  readonly gateway: ToolGateway;
  readonly contextFactory: (context: McpRequestContext) => ToolContext | Promise<ToolContext>;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

function textResult(value: unknown): {
  readonly resultType: "complete";
  readonly content: { readonly type: "text"; readonly text: string }[];
} {
  return {
    resultType: "complete",
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** 为每个 MCP 请求或连接创建独立服务实例。 */
export function createModelMayhemMcpServer(
  options: McpBindingOptions,
  requestContext: McpRequestContext,
): McpServer {
  const server = new McpServer({
    name: options.serverName ?? "model-mayhem",
    version: options.serverVersion ?? "0.1.0",
  });

  for (const tool of options.gateway.listDefinitions()) {
    server.registerTool(
      tool.name,
      {
        title: tool.label,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (input) => {
        const context = await options.contextFactory(requestContext);
        const output = await options.gateway.execute(tool.name, input, context);
        return textResult(output);
      },
    );
  }

  server.registerResource(
    "rules-current",
    "modelmayhem://rules/current",
    {
      title: "当前规则与内容版本",
      description: "返回当前固定规则版本、内容版本和系统参数摘要。",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await options.contextFactory(requestContext);
      const rules = await options.gateway.execute("inspect_rules", {}, context);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(rules, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "combat-rules",
    "modelmayhem://rules/combat",
    {
      title: "Model Mayhem 对战规则",
      description: "读取与官方 Pi 系统提示词相同的标准对战规则文档。",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: loadOfficialSkillReference("modelmayhem-play", "combat-rules.md"),
        },
      ],
    }),
  );

  server.registerResource(
    "battle-guide",
    "modelmayhem://guides/battle",
    {
      title: "Model Mayhem 战斗说明",
      description: "读取面向人类和 Agent 的局面判断、决策顺序与检查表。",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: loadOfficialSkillReference("modelmayhem-play", "battle-guide.md"),
        },
      ],
    }),
  );

  server.registerPrompt(
    "learn_rules",
    {
      title: "读取对战规则",
      description: "加载与官方 Pi 相同的对战规则和战斗说明。",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              loadOfficialSkillReference("modelmayhem-play", "combat-rules.md"),
              "",
              loadOfficialSkillReference("modelmayhem-play", "battle-guide.md"),
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "take_turn",
    {
      title: "执行一个对局回合",
      description: "指导 Agent 读取状态、检查合法行动、模拟候选路线、提交行动并结束回合。",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "先读取 learn_rules 或 modelmayhem://rules/combat，再调用 get_turn_context 读取当前状态、规则、卡牌摘要和带费用的合法行动。",
              "需要比较路线时，从 availableActions 中选择语义 action 对象调用 simulate_action。",
              "只能把 availableActions 中完整的 action 对象传给 perform_action，每次提交后重新读取完整上下文。",
              "完成本回合操作后执行 availableActions 中的 end_turn。",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

/** 创建可挂载到 Hono、Node HTTP 或其他 Fetch 运行时的 MCP 处理器。 */
export function createModelMayhemMcpHandler(options: McpBindingOptions): McpHttpHandler {
  return createMcpHandler((requestContext) => createModelMayhemMcpServer(options, requestContext), {
    legacy: "stateless",
    responseMode: "auto",
  });
}
