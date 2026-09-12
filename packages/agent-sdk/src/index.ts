/**
 * 外部 Agent TypeScript SDK。
 *
 * 作者：JucieOvo
 *
 * SDK 只封装创建客户端、读取合法行动和提交结构化命令，不复制规则，也不提供
 * 读取对手隐藏信息的接口。
 */

import { DirectBattleToolClient, HttpBattleToolClient } from "@modelmayhem/game-client";
import type { ToolBackend, ToolContext } from "@modelmayhem/game-tools";
import type { ModelMayhemCommand } from "@modelmayhem/model-mayhem-rules";

export interface AgentBattleClientOptions {
  readonly baseUrl: string;
  readonly matchId: string;
  readonly seatToken: string;
}

export interface AgentTurnDecision {
  readonly action: ModelMayhemCommand;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  decideTurn(client: ToolBackend, context: ToolContext): Promise<AgentTurnDecision>;
}

/** 创建标准 HTTP 对战客户端。 */
export function createAgentBattleClient(options: AgentBattleClientOptions): HttpBattleToolClient {
  return new HttpBattleToolClient(options);
}

/** 让适配器读取状态并提交一个真实命令。 */
export async function runAgentDecision(
  adapter: AgentAdapter,
  client: ToolBackend,
  context: ToolContext,
): Promise<unknown> {
  const decision = await adapter.decideTurn(client, context);
  return client.submitAction(context, decision.action);
}

export { DirectBattleToolClient, HttpBattleToolClient };
