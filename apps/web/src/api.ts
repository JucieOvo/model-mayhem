/**
 * 浏览器 API 客户端。
 *
 * 作者：JucieOvo
 *
 * 客户端只调用服务端公开接口，不读取内容目录、数据库或环境变量。
 */

import type {
  ConsortiumFaction,
  CreateMatchResponse,
  DiagnosticSummary,
  ResearchMapResponse,
  SandboxCommand,
  SandboxCommandResult,
  SandboxStatus,
  SaveDeckRequest,
  TutorialProgress,
  TutorialStepId,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateRollbackResult,
  UpdateStatus,
} from "@modelmayhem/contracts";
import type { CardSelector, Effect, TriggeredEffect } from "@modelmayhem/model-mayhem-content";
import type { LegalAction, ModelMayhemView } from "@modelmayhem/model-mayhem-rules";

export interface ContentResponse {
  readonly manifest: {
    readonly version: string;
    readonly rulesetVersion: string;
  };
  readonly balance: {
    readonly blueprintsPerDeck: number;
    readonly minimumModelsPerDeck: number;
    readonly minimumTechnologiesPerDeck: number;
    readonly maxCopiesPerCard: number;
    readonly signatureSlots: number;
    readonly influenceTarget: number;
    readonly roundLimit: number;
    readonly anchorSlots: number;
    readonly homeLabCapacity: number;
    readonly blueprintHandLimit: number;
    readonly actionHandLimit: number;
    readonly organizationDeploysPerTurn: number;
    readonly assetDeploysPerTurn: number;
    readonly benchmarksPerTurn: number;
    readonly techChecksPerTurn: number;
    readonly techCheckSeconds: number;
  };
  readonly doctrines: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly tags: readonly string[];
    readonly startingUnlock: boolean;
  }[];
  readonly decks: readonly {
    readonly id: string;
    readonly name: string;
    readonly faction: ConsortiumFaction;
    readonly doctrineId: string;
    readonly blueprintCardIds: readonly string[];
    readonly signatureActionIds: readonly string[];
    readonly description: string;
  }[];
  readonly cards: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly subtype: string;
    readonly tags: readonly string[];
    readonly cost: { readonly compute: number; readonly capital: number };
    readonly flavor: string;
    readonly description?: string;
    readonly signature?: boolean;
    readonly assetKind?: string;
    readonly faction?: ConsortiumFaction | "global";
    readonly openness?: string;
    readonly abilities?: Readonly<Record<string, number>>;
    readonly attachment?: "anchor" | "model";
    readonly capitalIncome?: number;
    readonly capacity?: number;
    readonly compatibleOrganizationTags?: readonly string[];
    readonly passiveEffects?: readonly Effect[];
    readonly deployEffects?: readonly Effect[];
    readonly triggeredEffects?: readonly TriggeredEffect[];
    readonly actionSet?: readonly string[];
    readonly effects?: readonly Effect[];
    readonly targeting?: string;
    readonly duration?: string;
    readonly durationRounds?: number;
    readonly selector?: CardSelector;
    readonly techCheck?: {
      readonly questionId: string;
      readonly baseEffects: readonly Effect[];
      readonly enhancedEffects: readonly Effect[];
    };
  }[];
}

export interface ProfileResponse {
  readonly profile: {
    readonly id: string;
    readonly displayName: string;
    readonly faction: ConsortiumFaction | null;
    readonly researchData: number;
    readonly completedMatches: number;
  };
  readonly collectionCardIds: readonly string[];
  readonly deckIds: readonly string[];
}

export interface DecksResponse {
  readonly presetDecks: ContentResponse["decks"];
  readonly savedDecks: readonly {
    readonly id: string;
    readonly name: string;
    readonly faction: ConsortiumFaction;
    readonly doctrineId: string;
    readonly blueprintCardIds: readonly string[];
    readonly signatureActionIds: readonly string[];
  }[];
}

export interface MatchResponse {
  readonly view: ModelMayhemView;
  readonly agent: {
    readonly available: boolean;
    readonly running: boolean;
    readonly error: string | null;
  };
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : `请求失败：HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

function matchHeaders(seatToken: string): HeadersInit {
  return {
    authorization: `Bearer ${seatToken}`,
  };
}

export const api = {
  getContent(): Promise<ContentResponse> {
    return request("/api/content");
  },
  getProfile(): Promise<ProfileResponse> {
    return request("/api/profile");
  },
  setProfileFaction(faction: ConsortiumFaction) {
    return request<ProfileResponse["profile"]>("/api/profile/faction", {
      method: "POST",
      body: JSON.stringify({ faction }),
    });
  },
  getResearch(): Promise<ResearchMapResponse> {
    return request("/api/research");
  },
  unlockResearch(nodeId: string): Promise<ResearchMapResponse> {
    return request("/api/research/unlock", {
      method: "POST",
      body: JSON.stringify({ nodeId }),
    });
  },
  advanceEra(): Promise<ResearchMapResponse> {
    return request("/api/research/advance", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  getDecks(): Promise<DecksResponse> {
    return request("/api/decks");
  },
  saveDeck(deck: SaveDeckRequest) {
    return request("/api/decks", {
      method: "POST",
      body: JSON.stringify(deck),
    });
  },
  createMatch(input: {
    readonly deckId: string;
    readonly difficulty: "trainee" | "standard" | "adversarial";
  }): Promise<CreateMatchResponse> {
    return request("/api/matches", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  resumeMatch(matchId: string): Promise<{
    readonly matchId: string;
    readonly seatToken: string;
    readonly view: ModelMayhemView;
    readonly agent: MatchResponse["agent"];
  }> {
    return request(`/api/matches/${matchId}/resume`, {
      method: "POST",
    });
  },
  getMatch(matchId: string, seatToken: string): Promise<MatchResponse> {
    return request(`/api/matches/${matchId}`, {
      headers: matchHeaders(seatToken),
    });
  },
  getLegalActions(matchId: string, seatToken: string): Promise<readonly LegalAction[]> {
    return request(`/api/matches/${matchId}/legal-actions`, {
      headers: matchHeaders(seatToken),
    });
  },
  submitCommand(
    matchId: string,
    seatToken: string,
    commandId: string,
    command: unknown,
  ): Promise<unknown> {
    return request(`/api/matches/${matchId}/commands`, {
      method: "POST",
      headers: matchHeaders(seatToken),
      body: JSON.stringify({ commandId, command }),
    });
  },
  getReplay(matchId: string, seatToken: string): Promise<unknown> {
    return request(`/api/matches/${matchId}/replay`, {
      headers: matchHeaders(seatToken),
    });
  },
  getQuestion(questionId: string): Promise<{
    readonly id: string;
    readonly prompt: string;
    readonly options: readonly {
      readonly id: string;
      readonly text: string;
    }[];
  }> {
    return request(`/api/questions/${questionId}`);
  },
  getUpdateStatus(): Promise<UpdateStatus> {
    return request("/api/update/status");
  },
  checkUpdate(): Promise<UpdateCheckResult> {
    return request("/api/update/check", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  installUpdate(): Promise<UpdateInstallResult> {
    return request("/api/update/install", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  rollbackUpdate(): Promise<UpdateRollbackResult> {
    return request("/api/update/rollback", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  getDiagnostics(): Promise<DiagnosticSummary> {
    return request("/api/diagnostics");
  },
  getSandboxStatus(): Promise<SandboxStatus> {
    return request("/api/sandbox/status");
  },
  runSandboxCommand(command: SandboxCommand): Promise<SandboxCommandResult> {
    return request("/api/sandbox/command", {
      method: "POST",
      body: JSON.stringify(command),
    });
  },
  createSandboxMatch(input: {
    readonly deckId: string;
    readonly difficulty: "trainee" | "standard" | "adversarial";
  }): Promise<CreateMatchResponse> {
    return request("/api/sandbox/matches", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getTutorial(): Promise<TutorialProgress> {
    return request("/api/tutorial");
  },
  completeTutorialStep(stepId: TutorialStepId): Promise<TutorialProgress> {
    return request("/api/tutorial/progress", {
      method: "POST",
      body: JSON.stringify({ stepId }),
    });
  },
  setTutorialDismissed(dismissed: boolean): Promise<TutorialProgress> {
    return request("/api/tutorial/dismiss", {
      method: "POST",
      body: JSON.stringify({ dismissed }),
    });
  },
};
