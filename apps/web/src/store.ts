/**
 * 浏览器会话和临时编辑状态。
 *
 * 作者：JucieOvo
 *
 * Zustand 只保存界面会话、座位令牌和牌组草稿。规则状态仍由服务端持有。
 */

import type { ConsortiumFaction } from "@modelmayhem/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionState {
  matchId: string | null;
  seatToken: string | null;
  setMatch(matchId: string, seatToken: string): void;
  clearMatch(): void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      matchId: null,
      seatToken: null,
      setMatch(matchId, seatToken) {
        set({ matchId, seatToken });
      },
      clearMatch() {
        set({ matchId: null, seatToken: null });
      },
    }),
    {
      name: "modelmayhem-session",
    },
  ),
);

interface DeckDraftState {
  id: string | null;
  name: string;
  faction: ConsortiumFaction;
  doctrineId: string;
  blueprintCardIds: string[];
  signatureActionIds: string[];
  initialize(input: {
    readonly id?: string;
    readonly name: string;
    readonly faction: ConsortiumFaction;
    readonly doctrineId: string;
    readonly blueprintCardIds: readonly string[];
    readonly signatureActionIds: readonly string[];
  }): void;
  setId(id: string): void;
  addBlueprint(cardId: string, maxCards: number, maxCopies: number): void;
  removeBlueprint(cardId: string): void;
  toggleSignature(actionId: string, maxSignatures: number): void;
  rename(name: string): void;
}

export const useDeckDraftStore = create<DeckDraftState>((set) => ({
  id: null,
  name: "自定义牌组",
  faction: "china",
  doctrineId: "open_diffusion",
  blueprintCardIds: [],
  signatureActionIds: [],
  initialize(input) {
    set({
      id: input.id ?? null,
      name: input.name,
      faction: input.faction,
      doctrineId: input.doctrineId,
      blueprintCardIds: [...input.blueprintCardIds],
      signatureActionIds: [...input.signatureActionIds],
    });
  },
  setId(id) {
    set({ id });
  },
  addBlueprint(cardId, maxCards, maxCopies) {
    set((state) => {
      if (state.blueprintCardIds.length >= maxCards) {
        return state;
      }
      const copies = state.blueprintCardIds.filter((id) => id === cardId).length;
      if (copies >= maxCopies) {
        return state;
      }
      return {
        blueprintCardIds: [...state.blueprintCardIds, cardId],
      };
    });
  },
  removeBlueprint(cardId) {
    set((state) => {
      const index = state.blueprintCardIds.lastIndexOf(cardId);
      if (index < 0) {
        return state;
      }
      const next = [...state.blueprintCardIds];
      next.splice(index, 1);
      return { blueprintCardIds: next };
    });
  },
  toggleSignature(actionId, maxSignatures) {
    set((state) => {
      if (state.signatureActionIds.includes(actionId)) {
        return {
          signatureActionIds: state.signatureActionIds.filter((id) => id !== actionId),
        };
      }
      if (state.signatureActionIds.length >= maxSignatures) {
        return state;
      }
      return {
        signatureActionIds: [...state.signatureActionIds, actionId],
      };
    });
  },
  rename(name) {
    set({ name });
  },
}));
