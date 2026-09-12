/**
 * 官方 TypeScript 对战工具客户端。
 *
 * 作者：JucieOvo
 *
 * DirectToolClient 供内嵌 Pi 复用统一工具网关；HttpToolClient 供自定义客户端
 * 和外部进程使用。两条路径使用相同工具名与参数结构。
 */

import { randomUUID } from "node:crypto";
import type { ToolBackend, ToolContext, ToolGateway } from "@modelmayhem/game-tools";

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly matchId: string;
  readonly seatToken: string;
  readonly fetchImplementation?: typeof fetch;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown;
  if (text.length > 0) {
    payload = JSON.parse(text);
  }
  if (!response.ok) {
    throw new Error(`对战服务请求失败：HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

/** 通过 REST 调用真实对局服务，适用于独立 Agent 进程。 */
export class HttpBattleToolClient implements ToolBackend {
  private readonly baseUrl: string;
  private readonly matchId: string;
  private readonly seatToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.matchId = options.matchId;
    this.seatToken = options.seatToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.seatToken}`,
        ...init.headers,
      },
    });
    return parseResponse(response);
  }

  async getMatchState(_context: ToolContext): Promise<unknown> {
    return this.request(`/api/matches/${this.matchId}`);
  }

  async getPrivateState(_context: ToolContext): Promise<unknown> {
    return this.request(`/api/matches/${this.matchId}/private`);
  }

  async getLegalActions(_context: ToolContext): Promise<unknown> {
    const actions = (await this.request(`/api/matches/${this.matchId}/legal-actions`)) as readonly {
      readonly id: string;
      readonly label: string;
      readonly preview?: unknown;
      readonly [key: string]: unknown;
    }[];
    return actions.map(({ id: _id, label, preview, ...action }) => ({
      label,
      action,
      ...(preview ? { preview } : {}),
    }));
  }

  async getTurnContext(_context: ToolContext): Promise<unknown> {
    return this.request(`/api/matches/${this.matchId}/turn-context`);
  }

  async inspectCard(cardId: string): Promise<unknown> {
    return this.request(`/api/cards/${encodeURIComponent(cardId)}`);
  }

  async inspectRules(version?: string): Promise<unknown> {
    const query = version ? `?version=${encodeURIComponent(version)}` : "";
    return this.request(`/api/rules${query}`);
  }

  async simulateAction(_context: ToolContext, action: unknown): Promise<unknown> {
    return this.request(`/api/matches/${this.matchId}/simulate`, {
      method: "POST",
      body: JSON.stringify({ command: action }),
    });
  }

  async submitAction(_context: ToolContext, action: unknown): Promise<unknown> {
    return this.request(`/api/matches/${this.matchId}/commands`, {
      method: "POST",
      body: JSON.stringify({ commandId: randomUUID(), command: action }),
    });
  }

  async endTurn(_context: ToolContext): Promise<unknown> {
    return this.submitAction(_context, { kind: "end_turn" });
  }

  async waitForTurn(_context: ToolContext, timeoutMs: number): Promise<unknown> {
    return this.request(
      `/api/matches/${this.matchId}/wait?timeoutMs=${encodeURIComponent(timeoutMs)}`,
    );
  }

  async getResearchMap(_context: ToolContext): Promise<unknown> {
    return this.request("/api/research");
  }

  async updateDeck(_context: ToolContext, deck: unknown): Promise<unknown> {
    return this.request("/api/decks", {
      method: "POST",
      body: JSON.stringify(deck),
    });
  }

  async getReplay(_context: ToolContext): Promise<unknown> {
    return this.request(`/api/matches/${this.matchId}/replay`);
  }
}

/** 内嵌 Pi 直连统一工具网关，不经过 HTTP 和 MCP。 */
export class DirectBattleToolClient {
  constructor(
    private readonly gateway: ToolGateway,
    private readonly context: ToolContext,
  ) {}

  getMatchState(): Promise<unknown> {
    return this.gateway.execute("get_match_state", {}, this.context);
  }

  getPrivateState(): Promise<unknown> {
    return this.gateway.execute("get_private_state", {}, this.context);
  }

  async getLegalActions(): Promise<unknown> {
    const context = (await this.getTurnContext()) as {
      readonly availableActions?: unknown;
    };
    if (context.availableActions === undefined) {
      throw new Error("完整回合上下文缺少 availableActions");
    }
    return context.availableActions;
  }

  getTurnContext(): Promise<unknown> {
    return this.gateway.execute("get_turn_context", {}, this.context);
  }

  inspectCard(cardId: string): Promise<unknown> {
    return this.gateway.execute("inspect_card", { cardId }, this.context);
  }

  inspectRules(version?: string): Promise<unknown> {
    return this.gateway.execute("inspect_rules", version ? { version } : {}, this.context);
  }

  simulateAction(action: unknown): Promise<unknown> {
    return this.gateway.execute("simulate_action", action, this.context);
  }

  performAction(action: unknown): Promise<unknown> {
    return this.gateway.execute("perform_action", action, this.context);
  }

  endTurn(): Promise<unknown> {
    return this.performAction({ kind: "end_turn" });
  }

  waitForTurn(timeoutMs: number): Promise<unknown> {
    return this.gateway.execute("wait_for_turn", { timeoutMs }, this.context);
  }

  getResearchMap(): Promise<unknown> {
    return this.gateway.execute("get_research_map", {}, this.context);
  }

  updateDeck(deck: unknown): Promise<unknown> {
    return this.gateway.execute("update_deck", { deck }, this.context);
  }

  getReplay(): Promise<unknown> {
    return this.gateway.execute("get_replay", {}, this.context);
  }

  /** 暴露同一固定座位上下文的标准 ToolBackend，供 SDK Agent 适配器复用。 */
  asToolBackend(): ToolBackend {
    return {
      getMatchState: () => this.getMatchState(),
      getPrivateState: () => this.getPrivateState(),
      getLegalActions: () => this.getLegalActions(),
      getTurnContext: () => this.getTurnContext(),
      inspectCard: (cardId) => this.inspectCard(cardId),
      inspectRules: (version) => this.inspectRules(version),
      simulateAction: (_context, action) => this.simulateAction(action),
      submitAction: (_context, action) => this.performAction(action),
      waitForTurn: (_context, timeoutMs) => this.waitForTurn(timeoutMs),
      getResearchMap: () => this.getResearchMap(),
      updateDeck: (_context, deck) => this.updateDeck(deck),
      getReplay: () => this.getReplay(),
    };
  }
}
