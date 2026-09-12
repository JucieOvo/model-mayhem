/**
 * Pi 单体对战 Agent 适配器。
 *
 * 作者：JucieOvo
 *
 * 适配器使用固定的 Pi Agent Core 与 Pi AI 版本，只注册 Model Mayhem 对战工具和
 * 官方 Skills。它不注册文件、Shell、浏览器工具，也不复用用户自己的 Pi 会话。
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { DirectBattleToolClient } from "@modelmayhem/game-client";
import type { AgentDifficulty, ToolContext, ToolGateway } from "@modelmayhem/game-tools";
import { ModelMayhemCommandInputSchema } from "@modelmayhem/model-mayhem-rules";
import { loadOfficialSkill, loadOfficialSkillReference } from "@modelmayhem/skills";
import { type TSchema, Type } from "typebox";
import { z } from "zod";
import { createPiBattleRuntime, type PiBattleRuntime } from "./runtime";

export interface PiBattleAgentAuditRecord {
  readonly eventType: "run_started" | "tool_started" | "tool_finished" | "run_finished";
  readonly toolName?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errorMessage?: string;
  readonly latencyMs?: number;
}

export interface PiBattleAgentRunInput {
  readonly matchId: string;
  readonly context: ToolContext;
  readonly gateway: ToolGateway;
  readonly difficulty?: AgentDifficulty;
  readonly onAudit?: (record: PiBattleAgentAuditRecord) => void;
}

export interface PiBattleAgentRunnerOptions {
  readonly runtimeDirectory: string;
  readonly allowedRuntimeRoot: string;
  readonly modelId?: string;
  readonly maxToolCalls?: number;
  readonly maxTurnCorrections?: number;
  readonly promptTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
}

const EmptyParameters = Type.Object({});
const SemanticActionSchema = Type.Unsafe<unknown>(
  z.toJSONSchema(ModelMayhemCommandInputSchema, { target: "draft-7" }) as TSchema,
);
const SemanticActionParameters = Type.Object({
  action: SemanticActionSchema,
});
interface AgentSession {
  readonly agent: Agent;
  readonly client: DirectBattleToolClient;
  readonly workspaceDirectory: string;
  readonly sessionDirectory: string;
  readonly difficulty: AgentDifficulty;
  readonly maxToolCalls: number;
  readonly planningDepth: number;
  phase: "mulligan" | "playing" | "finished";
  turnFinished: boolean;
  turnToolCalls: number;
  readonly toolStartTimes: Map<string, number>;
  readonly repeatedCalls: Map<string, number>;
  readonly attemptedActionSignatures: Set<string>;
}

const difficultyBudgets: Readonly<
  Record<AgentDifficulty, { readonly maxToolCalls: number; readonly planningDepth: number }>
> = {
  trainee: { maxToolCalls: 8, planningDepth: 1 },
  standard: { maxToolCalls: 14, planningDepth: 2 },
  adversarial: { maxToolCalls: 20, planningDepth: 3 },
};

/** 返回指定难度真实使用的规划与工具预算。 */
export function getAgentDifficultyBudget(difficulty: AgentDifficulty): {
  readonly maxToolCalls: number;
  readonly planningDepth: number;
} {
  return difficultyBudgets[difficulty];
}

function textResult(value: unknown, details: unknown = value): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    details,
  };
}

function actionViolation(
  value: unknown,
): { readonly code: string; readonly message: string } | undefined {
  if (typeof value !== "object" || value === null || !("accepted" in value) || value.accepted) {
    return undefined;
  }
  if (
    "violation" in value &&
    typeof value.violation === "object" &&
    value.violation !== null &&
    "code" in value.violation &&
    "message" in value.violation
  ) {
    return {
      code: String(value.violation.code),
      message: String(value.violation.message),
    };
  }
  return { code: "ACTION_REJECTED", message: "行动未通过规则校验" };
}

function thrownActionViolation(
  error: unknown,
): { readonly code: string; readonly message: string } | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return undefined;
  }
  return {
    code: error.code,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function readAvailableActions(
  client: DirectBattleToolClient,
): Promise<readonly unknown[] | null> {
  try {
    const context = (await client.getTurnContext()) as {
      readonly availableActions?: readonly unknown[];
    };
    return context.availableActions ?? null;
  } catch {
    return null;
  }
}

function actionRejectionError(
  violation: { readonly code: string; readonly message: string },
  action: unknown,
  availableActions: readonly unknown[] | null,
  cause?: unknown,
): Error {
  const message = JSON.stringify({
    code: violation.code,
    message: violation.message,
    attemptedAction: action,
    availableActions,
  });
  return cause === undefined ? new Error(message) : new Error(message, { cause });
}

function toolCallSignature(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args)}`;
}

async function executeWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`对战工具 ${toolName} 超过 ${timeoutMs} 毫秒未完成`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    void operation.catch(() => undefined);
  }
}

function toolFromGateway(
  name: string,
  label: string,
  description: string,
  parameters: ReturnType<typeof Type.Object>,
  client: DirectBattleToolClient,
  executionMode: "parallel" | "sequential",
  timeoutMs: number,
): AgentTool {
  return {
    name,
    label,
    description,
    parameters,
    executionMode,
    async execute(_toolCallId, params) {
      const input = params as Readonly<Record<string, unknown>>;
      const operation = async (): Promise<AgentToolResult<unknown>> => {
        switch (name) {
          case "get_turn_context":
            return textResult(await client.getTurnContext());
          case "simulate_action":
            return textResult(await client.simulateAction(input.action));
          case "perform_action": {
            let result: unknown;
            try {
              result = await client.performAction(input.action);
            } catch (error) {
              const violation = thrownActionViolation(error);
              if (!violation) {
                throw error;
              }
              throw actionRejectionError(
                violation,
                input.action,
                await readAvailableActions(client),
                error,
              );
            }
            const violation = actionViolation(result);
            if (!violation) {
              return textResult(result);
            }
            throw actionRejectionError(violation, input.action, await readAvailableActions(client));
          }
          default:
            throw new Error(`未注册的对战工具：${name}`);
        }
      };
      return executeWithTimeout(operation(), timeoutMs, name);
    },
  };
}

/**
 * 在有限时间内等待 Pi 完成一次提示。
 *
 * 超时后调用 Pi 自身的 abort 并等待活动运行释放，避免下一回合复用仍在运行的
 * Agent 会话。该函数不伪造行动，超时错误会沿调用链上抛并写入审计日志。
 */
async function promptWithTimeout(agent: Agent, prompt: string, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const promptPromise = agent.prompt(prompt);
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      agent.abort();
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([promptPromise, timeoutPromise]);
    if (timedOut) {
      await promptPromise.catch(() => undefined);
      throw new Error(`Pi 对战 Agent 超过 ${timeoutMs} 毫秒未完成响应，已中止本轮`);
    }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** 创建只包含官方对战能力的 Pi 工具集合。 */
export function createPiBattleTools(
  client: DirectBattleToolClient,
  options: { readonly toolTimeoutMs?: number } = {},
): readonly AgentTool[] {
  const toolTimeoutMs = options.toolTimeoutMs ?? 15_000;
  return [
    toolFromGateway(
      "get_turn_context",
      "读取完整回合上下文",
      "一次读取当前状态、资源、剩余次数、影响力空间、规则摘要和带最终费用的可用语义行动。",
      EmptyParameters,
      client,
      "parallel",
      toolTimeoutMs,
    ),
    toolFromGateway(
      "simulate_action",
      "模拟候选行动",
      "使用 availableActions 中的语义 action 对象在快照副本上模拟。",
      SemanticActionParameters,
      client,
      "parallel",
      toolTimeoutMs,
    ),
    toolFromGateway(
      "perform_action",
      "执行语义行动",
      "提交 availableActions 中一个完整的语义 action 对象。",
      SemanticActionParameters,
      client,
      "sequential",
      toolTimeoutMs,
    ),
  ];
}

/** 构建包含规则文档和战斗说明的官方 Pi 系统提示词。 */
export function buildPiBattleSystemPrompt(difficulty: AgentDifficulty): string {
  const playSkill = loadOfficialSkill("modelmayhem-play");
  const combatRules = loadOfficialSkillReference("modelmayhem-play", "combat-rules.md");
  const battleGuide = loadOfficialSkillReference("modelmayhem-play", "battle-guide.md");
  const planningDepth = difficultyBudgets[difficulty].planningDepth;
  return [
    "你是《模型大战魔型》的官方对战 Agent。",
    "规则结算、随机数和状态修改全部由服务端确定性引擎负责。",
    "你只能使用已注册的对战工具，不得假设存在文件、Shell、浏览器或用户 Pi 工具。",
    "标准对局中双方属于相反财团。你的财团和对手财团以每轮注入的 factionContext 为准。",
    "财团只限制公司据点部署和部分闭源模型，不会阻断技术、论文、开放权重、开源或开放科学资产。",
    "每回合会直接注入一份完整回合上下文。优先使用其中的 availableActions 和 rules，不要重复查询同一信息。",
    "ownCards 提供你当前手牌和己方牌组中卡牌的完整公开定义；ownBlueprintDeck 提供己方蓝图组成但不包含牌堆顺序。",
    "提交和模拟只使用 availableActions 中系统提供的完整语义 action 对象，不要构造 actionId、commandId 或额外字段。",
    `你的规划深度为 ${planningDepth} 个完整回合；不要读取或推断超出稳定公开信息的更远未来。`,
    "模拟只比较最值得考虑的 1 至 3 条候选行动，不要穷举。卡牌费用和效果已在 availableActions.preview 中提供，不要依赖额外查卡。",
    "提交行动后必须重新读取完整回合上下文。",
    "完成主要阶段操作后必须执行 availableActions 中的 end_turn 语义行动。",
    "调度阶段只会在 availableActions 中看到保留全部、处理重复牌、处理高费牌和全部调度等少量策略；直接选择并提交，不查询卡牌、不模拟，也不结束回合。",
    "你不参与牌组编辑、研究地图推进、卡牌解锁或回放分析。你的牌组已由服务端按对立财团和合法构筑规则预生成。",
    "不读取或推断对手隐藏手牌，不读取技术检定正确答案。",
    "你运行在独立沙箱目录中，不得访问、创建、修改或删除系统目录、用户主目录、项目源码或沙箱外路径。",
    "调用 perform_action 时原样传入一个 availableActions.action，不读取也不生成本地内部标识。",
    "工具错误必须如实说明并重新规划，不得伪造成功。",
    "",
    "官方 Skill：modelmayhem-play",
    playSkill,
    "",
    "权威规则文档：model-mayhem-combat-rules",
    combatRules,
    "",
    "权威战斗说明：model-mayhem-battle-guide",
    battleGuide,
  ].join("\n");
}

/**
 * 使用真实 DeepSeek Pi 提供者完成 Agent 回合。
 *
 * Pi 模型目录中的基础条目是 deepseek-v4-flash；DeepSeek Responses 接口使用
 * deepseek-flash 作为请求模型名。这里保留 Pi 实例标识 pi-deepseek-flash，
 * 只在发送请求时覆盖模型标识，避免目录版本名和接口别名被误认为两个能力等级。
 */
export class PiBattleAgentRunner {
  readonly id = "pi-deepseek-flash";
  private readonly modelId: string;
  private readonly maxToolCallsOverride: number | undefined;
  private readonly maxTurnCorrections: number;
  private readonly promptTimeoutMs: number;
  private readonly toolTimeoutMs: number;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly runtime: PiBattleRuntime;

  constructor(options: PiBattleAgentRunnerOptions) {
    this.runtime = createPiBattleRuntime({
      rootDirectory: options.runtimeDirectory,
      allowedRootDirectory: options.allowedRuntimeRoot,
    });
    this.modelId = options.modelId ?? "deepseek-flash";
    this.maxToolCallsOverride = options.maxToolCalls;
    this.maxTurnCorrections = options.maxTurnCorrections ?? 2;
    this.promptTimeoutMs = options.promptTimeoutMs ?? 180_000;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 15_000;
  }

  async run(input: PiBattleAgentRunInput): Promise<void> {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY 未配置，无法启动 Pi 对战 Agent");
    }
    input.onAudit?.({ eventType: "run_started" });
    const catalogModel = deepseekProvider()
      .getModels()
      .find((candidate) => candidate.id === "deepseek-v4-flash");
    if (!catalogModel) {
      throw new Error("Pi AI 模型不存在：deepseek/deepseek-v4-flash");
    }
    const model = {
      ...catalogModel,
      id: this.modelId,
      name: "DeepSeek V4.1 Flash",
      api: "openai-responses" as const,
      compat: {
        supportsDeveloperRole: false,
      },
    };
    const models = createModels({
      authContext: {
        env: async (name) => this.runtime.environment[name],
        fileExists: async () => false,
      },
    });
    models.setProvider(
      createProvider({
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: model.baseUrl,
        auth: { apiKey: envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"]) },
        models: [model],
        api: openAIResponsesApi(),
      }),
    );
    const difficulty = input.difficulty ?? "standard";
    const difficultyBudget = getAgentDifficultyBudget(difficulty);
    const sessionKey = `${input.matchId}:${input.context.seatId}`;
    let session = this.sessions.get(sessionKey);
    if (!session) {
      const sessionDirectory = join(
        this.runtime.sessionsDirectory,
        input.matchId,
        input.context.seatId,
      );
      const workspaceDirectory = join(
        this.runtime.workspaceDirectory,
        input.matchId,
        input.context.seatId,
      );
      mkdirSync(sessionDirectory, { recursive: true });
      mkdirSync(workspaceDirectory, { recursive: true });
      const client = new DirectBattleToolClient(input.gateway, input.context);
      const tools = createPiBattleTools(client, { toolTimeoutMs: this.toolTimeoutMs });
      const mutableSession = {
        client,
        workspaceDirectory,
        sessionDirectory,
        difficulty,
        maxToolCalls: this.maxToolCallsOverride ?? difficultyBudget.maxToolCalls,
        planningDepth: difficultyBudget.planningDepth,
        phase: "mulligan" as const,
        turnFinished: false,
        turnToolCalls: 0,
        toolStartTimes: new Map<string, number>(),
        repeatedCalls: new Map<string, number>(),
        attemptedActionSignatures: new Set<string>(),
      } as Omit<AgentSession, "agent"> & { agent?: Agent };
      const agent = new Agent({
        initialState: {
          systemPrompt: buildPiBattleSystemPrompt(difficulty),
          model,
          thinkingLevel: "high",
          tools: [...tools],
        },
        streamFn: (model, context, options) =>
          models.streamSimple(model, context, {
            ...options,
            env: {
              ...this.runtime.environment,
              ...(options?.env ?? {}),
            },
          }),
        toolExecution: "parallel",
        sessionId: `modelmayhem:${input.matchId}:${input.context.seatId}`,
        transformContext: async (messages) => {
          if (messages.length <= 80) {
            return messages;
          }
          const cutoff = messages.length - 80;
          const userBoundary = messages.findIndex(
            (message, index) => index >= cutoff && message.role === "user",
          );
          return messages.slice(userBoundary >= 0 ? userBoundary : cutoff);
        },
        beforeToolCall: async ({ toolCall, args }) => {
          if (mutableSession.turnFinished) {
            return {
              block: true,
              reason: "本回合已经结束，停止调用工具并等待下一次回合通知。",
            };
          }
          const mulliganTools = ["get_turn_context", "perform_action"];
          if (mutableSession.phase === "mulligan" && !mulliganTools.includes(toolCall.name)) {
            return {
              block: true,
              reason: "调度阶段不需要查卡或模拟，请直接从 availableActions 中执行调度策略。",
            };
          }
          const budgetedTool = !["get_turn_context", "perform_action"].includes(toolCall.name);
          const signature = toolCallSignature(toolCall.name, args);
          if (
            toolCall.name === "perform_action" &&
            mutableSession.attemptedActionSignatures.has(signature)
          ) {
            return {
              block: true,
              reason: "该语义行动本回合已经执行过，不能原样重复；请选择其他行动。",
            };
          }
          const repeatedCount = mutableSession.repeatedCalls.get(signature) ?? 0;
          if (repeatedCount > 0 && toolCall.name !== "perform_action") {
            return {
              block: true,
              reason: "相同工具参数已经调用过，请使用已有结果；状态变化后再重新查询。",
            };
          }
          mutableSession.repeatedCalls.set(signature, repeatedCount + 1);
          if (budgetedTool) {
            mutableSession.turnToolCalls += 1;
          }
          if (budgetedTool && mutableSession.turnToolCalls > mutableSession.maxToolCalls) {
            return {
              block: true,
              reason: `查询与模拟工具预算已用完，上限为 ${mutableSession.maxToolCalls}。现在必须根据已有信息提交行动并结束回合。`,
            };
          }
          mutableSession.toolStartTimes.set(toolCall.id, Date.now());
          input.onAudit?.({
            eventType: "tool_started",
            toolName: toolCall.name,
            input: args,
          });
          return undefined;
        },
        afterToolCall: async ({ toolCall, args, result, isError }) => {
          const startedAt = mutableSession.toolStartTimes.get(toolCall.id) ?? Date.now();
          input.onAudit?.({
            eventType: "tool_finished",
            toolName: toolCall.name,
            input: args,
            output: result.details,
            ...(isError ? { errorMessage: JSON.stringify(result.content) } : {}),
            latencyMs: Date.now() - startedAt,
          });
          const actionKind =
            typeof args === "object" &&
            args !== null &&
            "action" in args &&
            typeof args.action === "object" &&
            args.action !== null &&
            "kind" in args.action &&
            typeof args.action.kind === "string"
              ? args.action.kind
              : undefined;
          if (!isError && toolCall.name === "perform_action") {
            mutableSession.repeatedCalls.clear();
          }
          if (toolCall.name === "perform_action") {
            mutableSession.attemptedActionSignatures.add(toolCallSignature(toolCall.name, args));
          }
          if (!isError && toolCall.name === "perform_action" && actionKind === "end_turn") {
            mutableSession.turnFinished = true;
          }
          return undefined;
        },
      });
      mutableSession.agent = agent;
      session = mutableSession as AgentSession;
      this.sessions.set(sessionKey, session);
    }
    session.turnToolCalls = 0;
    session.repeatedCalls.clear();
    session.attemptedActionSignatures.clear();
    session.turnFinished = false;
    const context = (await session.client.getTurnContext()) as {
      readonly phase: "mulligan" | "playing" | "finished";
      readonly factionContext: {
        readonly me: "china" | "west";
        readonly opponent: "china" | "west";
      };
      readonly availableActions: readonly {
        readonly label: string;
        readonly action: unknown;
      }[];
    };
    session.phase = context.phase;
    const factionName = context.factionContext.me === "china" ? "中国财团" : "西方财团";
    const opponentFactionName =
      context.factionContext.opponent === "china" ? "中国财团" : "西方财团";
    const statePrompt =
      context.phase === "mulligan"
        ? `你属于${factionName}，对手属于${opponentFactionName}。现在处于起手调度阶段。必须从 availableActions 中选择一个 mulligan，使用 perform_action 原样传入对应 action，确认 mulliganReady 为 true。`
        : `你属于${factionName}，对手属于${opponentFactionName}。现在轮到你的座位。根据已注入的 availableActions 完成决策，使用 perform_action 提交语义 action，并以 end_turn 行动结束回合。`;
    const prompt = `${statePrompt}\n\n当前回合上下文：\n${JSON.stringify(context)}`;
    await promptWithTimeout(session.agent, prompt, this.promptTimeoutMs);
    if (session.agent.state.errorMessage) {
      throw new Error(`Pi 对战 Agent 运行失败：${session.agent.state.errorMessage}`);
    }
    for (let correction = 0; correction <= this.maxTurnCorrections; correction += 1) {
      const view = (await session.client.getMatchState()) as {
        readonly phase: "mulligan" | "playing" | "finished";
        readonly activeSeatId: string | null;
        readonly me: { readonly mulliganReady: boolean };
      };
      const requiresMulligan = view.phase === "mulligan" && !view.me.mulliganReady;
      const requiresEndTurn =
        view.phase === "playing" && view.activeSeatId === input.context.seatId;
      if (!requiresMulligan && !requiresEndTurn) {
        input.onAudit?.({ eventType: "run_finished" });
        return;
      }
      if (correction === this.maxTurnCorrections) {
        break;
      }
      await promptWithTimeout(
        session.agent,
        requiresMulligan
          ? "你的调度尚未提交。现在必须直接从 availableActions 中选择一个 mulligan，调用 perform_action，然后确认 mulliganReady 为 true。"
          : "你还没有结束回合。继续读取当前状态和 availableActions，完成必要操作，最后必须执行 end_turn 语义行动。",
        this.promptTimeoutMs,
      );
      if (session.agent.state.errorMessage) {
        throw new Error(`Pi 对战 Agent 纠偏失败：${session.agent.state.errorMessage}`);
      }
    }
    throw new Error("Pi 对战 Agent 多次纠偏后仍未完成当前回合，对局保持暂停");
  }

  /** 对局结束后释放会话，避免长期保留完整 Agent 上下文。 */
  disposeMatch(matchId: string): void {
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${matchId}:`)) {
        const session = this.sessions.get(key);
        if (session) {
          rmSync(session.workspaceDirectory, { recursive: true, force: true });
          rmSync(session.sessionDirectory, { recursive: true, force: true });
        }
        this.sessions.delete(key);
      }
    }
  }
}

/** 创建默认 Pi 对战 Agent Runner。 */
export function createPiBattleAgentRunner(
  options: PiBattleAgentRunnerOptions,
): PiBattleAgentRunner {
  return new PiBattleAgentRunner(options);
}
