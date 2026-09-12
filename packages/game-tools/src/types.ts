/**
 * Agent 工具网关公共类型。
 *
 * 作者：JucieOvo
 *
 * 所有协议适配器共享同一工具定义。上下文由服务端鉴权后注入，工具输入不能指定
 * 任意座位或跳过权限检查。
 */

import type { z } from "zod";

export type ToolExecutionMode = "parallel" | "sequential";
export type ToolPermission = "read" | "play" | "progress" | "replay";
export type AgentDifficulty = "trainee" | "standard" | "adversarial";

export interface ToolContext {
  readonly matchId: string;
  readonly seatId: string;
  readonly actorKind: "human" | "agent" | "system";
  readonly profileId: string;
  readonly permissions: readonly ToolPermission[];
  readonly difficulty?: AgentDifficulty;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly executionMode: ToolExecutionMode;
  readonly requiredPermission: ToolPermission;
}

/** Agent 优先提交合法行动 ID；旧命令正文路径只保留给兼容客户端。 */
export interface ActionReference {
  readonly actionId?: string;
  readonly command?: unknown;
}

export interface ToolDefinition<TInput extends z.ZodType = z.ZodType, TOutput = unknown>
  extends ToolDescriptor {
  readonly inputSchema: TInput;
  execute(input: z.infer<TInput>, context: ToolContext): Promise<TOutput>;
}

export interface ToolBackend {
  getMatchState(context: ToolContext): Promise<unknown>;
  getPrivateState(context: ToolContext): Promise<unknown>;
  getLegalActions(context: ToolContext): Promise<unknown>;
  inspectCard(cardId: string): Promise<unknown>;
  inspectRules(version?: string): Promise<unknown>;
  getTurnContext(context: ToolContext): Promise<unknown>;
  simulateAction(context: ToolContext, action: unknown): Promise<unknown>;
  submitAction(context: ToolContext, action: unknown): Promise<unknown>;
  waitForTurn(context: ToolContext, timeoutMs: number): Promise<unknown>;
  getResearchMap(context: ToolContext): Promise<unknown>;
  updateDeck(context: ToolContext, deck: unknown): Promise<unknown>;
  getReplay(context: ToolContext): Promise<unknown>;
}

export class ToolGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolGatewayError";
  }
}
