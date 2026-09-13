/**
 * 牌组编辑与赛前锁定页面。
 *
 * 作者：JucieOvo
 */

import type { ConsortiumFaction, MatchDifficulty } from "@modelmayhem/contracts";
import { Coins, Minus, Play, Plus, Save, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { ContentResponse, DecksResponse, ProfileResponse } from "../api";
import { api } from "../api";
import { DifficultySelect } from "../components/DifficultySelect";
import { Pagination } from "../components/Pagination";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";
import { useDeckDraftStore, useSessionStore } from "../store";

export function DeckPage() {
  const navigate = useNavigate();
  const session = useSessionStore();
  const draft = useDeckDraftStore();
  const initializeDraft = useDeckDraftStore((state) => state.initialize);
  const initialized = useRef(false);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [decks, setDecks] = useState<DecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [difficulty, setDifficulty] = useState<MatchDifficulty>("standard");
  const [page, setPage] = useState(1);
  const pageSize = useAdaptivePageSize();

  useEffect(() => {
    Promise.all([api.getContent(), api.getProfile(), api.getDecks()])
      .then(([contentValue, profileValue, decksValue]) => {
        setContent(contentValue);
        setProfile(profileValue);
        setDecks(decksValue);
        if (!initialized.current) {
          const first =
            decksValue.savedDecks.find((deck) => deck.faction === profileValue.profile.faction) ??
            decksValue.presetDecks.find((deck) => deck.faction === profileValue.profile.faction);
          if (first) {
            initializeDraft(first);
            initialized.current = true;
          }
        }
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [initializeDraft]);

  if (error && (!content || !profile || !decks)) {
    return <ErrorMessage message={error} />;
  }
  if (!content || !profile || !decks) {
    return <LoadingMessage label="读取牌组与收藏" />;
  }

  if (profile.profile.faction === null) {
    return (
      <div className="page-screen deck-page">
        <ErrorMessage message="请先在首页选择中国财团或西方财团，再编辑牌组。" />
        <button type="button" className="action-button primary" onClick={() => navigate("/")}>
          返回首页选择财团
        </button>
      </div>
    );
  }
  const profileFaction = profile.profile.faction;
  const matchingPresets = decks.presetDecks.filter((deck) => deck.faction === profileFaction);
  if (matchingPresets.length === 0) {
    return <ErrorMessage message="当前内容包没有与档案财团匹配的初始预组。" />;
  }
  const unlocked = new Set(profile.collectionCardIds);
  const availableCards = content.cards.filter(
    (card) =>
      unlocked.has(card.id) &&
      isCardAllowedForDeck(card, profileFaction) &&
      (card.type === "organization" ||
        (card.type === "asset" && card.assetKind === "model") ||
        (card.type === "asset" && card.assetKind === "technology")),
  );
  const signatureActions = content.cards.filter(
    (card) => card.type === "action" && card.signature && unlocked.has(card.id),
  );
  const modelCount = draft.blueprintCardIds.filter(
    (cardId) => content.cards.find((card) => card.id === cardId)?.subtype === "model",
  ).length;
  const technologyCount = draft.blueprintCardIds.filter(
    (cardId) => content.cards.find((card) => card.id === cardId)?.assetKind === "technology",
  ).length;
  const factionCompanyCount = draft.blueprintCardIds.filter((cardId) => {
    const card = content.cards.find((candidate) => candidate.id === cardId);
    return (
      card?.type === "organization" && card.subtype === "company" && card.faction === profileFaction
    );
  }).length;
  const factionIssue = draft.blueprintCardIds.some((cardId) => {
    const card = content.cards.find((candidate) => candidate.id === cardId);
    return card === undefined || !isCardAllowedForDeck(card, profileFaction);
  });
  const deckValid =
    draft.blueprintCardIds.length === content.balance.blueprintsPerDeck &&
    modelCount >= content.balance.minimumModelsPerDeck &&
    technologyCount >= content.balance.minimumTechnologiesPerDeck &&
    draft.signatureActionIds.length === content.balance.signatureSlots &&
    draft.faction === profileFaction &&
    factionCompanyCount > 0 &&
    !factionIssue;
  const pageCount = Math.max(1, Math.ceil(availableCards.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleCards = availableCards.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  async function saveDeck(): Promise<string | null> {
    setSaving(true);
    setError(null);
    try {
      const saved = (await api.saveDeck({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        faction: draft.faction,
        doctrineId: draft.doctrineId,
        blueprintCardIds: draft.blueprintCardIds,
        signatureActionIds: draft.signatureActionIds,
      })) as { readonly id: string };
      draft.setId(saved.id);
      return saved.id;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function startWithDeck(): Promise<void> {
    const deckId = await saveDeck();
    if (!deckId) {
      return;
    }
    try {
      const created = await api.createMatch({
        deckId,
        difficulty,
      });
      session.setMatch(created.matchId, created.seatToken);
      navigate(`/match/${created.matchId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="page-screen deck-page">
      <section className="panel deck-command-panel">
        <div className="panel-header">
          <div>
            <strong>赛前牌组</strong>
            <span className="ml-3 text-xs text-[var(--muted)]">
              {draft.blueprintCardIds.length} / {content.balance.blueprintsPerDeck} 蓝图，{" "}
              {draft.signatureActionIds.length} / {content.balance.signatureSlots} 招牌
            </span>
          </div>
          <span className={deckValid ? "deck-valid" : "deck-invalid"}>
            {deckValid ? "构筑合法" : "尚未满足规则"}
          </span>
        </div>
        <div className="panel-body deck-toolbar">
          <select
            className="field"
            value={draft.id ?? ""}
            onChange={(event) => {
              if (event.target.value === "") {
                return;
              }
              const saved = decks.savedDecks.find((deck) => deck.id === event.target.value);
              if (saved) {
                draft.initialize(saved);
                setPage(1);
              }
            }}
          >
            <option value="">选择已保存牌组</option>
            {decks.savedDecks
              .filter((deck) => deck.faction === profileFaction)
              .map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
          </select>
          <select
            className="field"
            value={draft.doctrineId}
            onChange={(event) => {
              const preset = matchingPresets.find((deck) => deck.doctrineId === event.target.value);
              if (preset) {
                draft.initialize(preset);
                setPage(1);
              }
            }}
          >
            {matchingPresets.map((deck) => (
              <option key={deck.id} value={deck.doctrineId}>
                {deck.name}
              </option>
            ))}
          </select>
          <input
            className="field"
            value={draft.name}
            onChange={(event) => draft.rename(event.target.value)}
            aria-label="牌组名称"
          />
          <DifficultySelect value={difficulty} onChange={setDifficulty} disabled={saving} />
          <button
            type="button"
            className="action-button"
            disabled={saving || !deckValid}
            onClick={() => void saveDeck()}
          >
            <Save size={17} />
            保存
          </button>
          <button
            type="button"
            className="action-button primary"
            disabled={saving || !deckValid}
            onClick={() => void startWithDeck()}
          >
            <Play size={17} />
            开始对战
          </button>
        </div>
        <div className="deck-summary-grid">
          <Summary
            label="模型"
            value={`${modelCount} / 至少 ${content.balance.minimumModelsPerDeck}`}
          />
          <Summary
            label="技术 / 论文"
            value={`${technologyCount} / 至少 ${content.balance.minimumTechnologiesPerDeck}`}
          />
          <Summary
            label="财团"
            value={`${profileFaction === "china" ? "中国财团" : "西方财团"} · 本公司 ${factionCompanyCount} 张`}
            tone={factionCompanyCount > 0 ? "text-[var(--accent-strong)]" : "text-[var(--warning)]"}
          />
          <Summary label="同名牌上限" value={`每种最多 ${content.balance.maxCopiesPerCard} 张`} />
          <Summary
            label="校验"
            value={deckValid ? "可以锁定" : "尚未满足构筑规则"}
            tone={deckValid ? "text-[var(--accent-strong)]" : "text-[var(--warning)]"}
          />
        </div>
      </section>

      <ErrorMessage message={error} />

      <div className="deck-workspace">
        <section className="panel deck-library-panel">
          <div className="panel-header">
            <strong>可用内容</strong>
            <span className="text-xs text-[var(--muted)]">
              收藏 {profile.collectionCardIds.length} 张
            </span>
          </div>
          <div className="deck-library-body">
            <div className="deck-card-grid">
              {visibleCards.map((card) => {
                const copies = draft.blueprintCardIds.filter((id) => id === card.id).length;
                return (
                  <DeckCatalogCard
                    key={card.id}
                    card={card}
                    copies={copies}
                    canAdd={
                      draft.blueprintCardIds.length < content.balance.blueprintsPerDeck &&
                      copies < content.balance.maxCopiesPerCard
                    }
                    onAdd={() =>
                      draft.addBlueprint(
                        card.id,
                        content.balance.blueprintsPerDeck,
                        content.balance.maxCopiesPerCard,
                      )
                    }
                    onRemove={() => draft.removeBlueprint(card.id)}
                  />
                );
              })}
            </div>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              total={availableCards.length}
              onPageChange={setPage}
            />
          </div>
        </section>

        <div className="deck-sidebar">
          <section className="panel">
            <div className="panel-header">
              <strong>招牌行动</strong>
              <span className="text-xs text-[var(--muted)]">
                选择 {content.balance.signatureSlots} 张
              </span>
            </div>
            <div className="panel-body deck-signature-list">
              {signatureActions.map((card) => {
                const selected = draft.signatureActionIds.includes(card.id);
                return (
                  <button
                    type="button"
                    key={card.id}
                    className={[
                      "w-full rounded-[7px] border p-3 text-left",
                      selected
                        ? "border-[var(--accent)] bg-[var(--surface-3)]"
                        : "border-[var(--line)] bg-[var(--surface-2)]",
                    ].join(" ")}
                    onClick={() => draft.toggleSignature(card.id, content.balance.signatureSlots)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm">{card.name}</strong>
                      <ShieldCheck size={16} color={selected ? "var(--accent)" : "var(--muted)"} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{card.flavor}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <strong>蓝图清单</strong>
            </div>
            <div className="panel-body deck-blueprint-list">
              {groupDeckCards(content, draft.blueprintCardIds).map((group) => (
                <div key={group.label} className="mb-4 last:mb-0">
                  <div className="mb-2 text-xs text-[var(--muted)]">
                    {group.label} {group.items.reduce((sum, item) => sum + item.count, 0)}
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <div
                        key={item.card.id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span title={item.card.name}>{item.card.name}</span>
                        <span className="muted">x{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}) {
  return (
    <div className="rounded-[7px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`mt-1 font-medium ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function DeckCatalogCard({
  card,
  copies,
  canAdd,
  onAdd,
  onRemove,
}: {
  readonly card: ContentResponse["cards"][number];
  readonly copies: number;
  readonly canAdd: boolean;
  readonly onAdd: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <article className={`deck-catalog-card ${copies > 0 ? "selected" : ""}`}>
      <div className="deck-catalog-heading">
        <div>
          <span>
            {card.assetKind === "model" ? "模型" : card.type === "organization" ? "组织" : "技术"}
          </span>
          <strong title={card.name}>{card.name}</strong>
        </div>
        <div className="deck-catalog-cost">
          {card.cost.compute > 0 ? (
            <span className="resource-compute">
              <Zap size={13} /> {card.cost.compute}
            </span>
          ) : null}
          {card.cost.capital > 0 ? (
            <span className="resource-capital">
              <Coins size={13} /> {card.cost.capital}
            </span>
          ) : null}
        </div>
      </div>
      <div className="deck-catalog-tags">
        {card.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="deck-catalog-actions">
        <button
          type="button"
          className="icon-button"
          title={`加入 ${card.name}`}
          onClick={onAdd}
          disabled={!canAdd}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={`移除 ${card.name}`}
          onClick={onRemove}
          disabled={copies === 0}
        >
          <Minus size={16} />
        </button>
        <span>牌堆 {copies} 张</span>
      </div>
    </article>
  );
}

function groupDeckCards(content: ContentResponse, cardIds: readonly string[]) {
  const grouped = new Map<
    string,
    { readonly card: ContentResponse["cards"][number]; count: number }[]
  >();
  for (const cardId of cardIds) {
    const card = content.cards.find((candidate) => candidate.id === cardId);
    if (!card) {
      continue;
    }
    const label =
      card.type === "organization" ? "组织" : card.subtype === "model" ? "模型" : "技术 / 论文";
    const values = grouped.get(label) ?? [];
    const existing = values.find((item) => item.card.id === cardId);
    if (existing) {
      existing.count += 1;
    } else {
      values.push({ card, count: 1 });
    }
    grouped.set(label, values);
  }
  return [...grouped.entries()].map(([label, items]) => ({ label, items }));
}

function isCardAllowedForDeck(
  card: ContentResponse["cards"][number],
  faction: ConsortiumFaction,
): boolean {
  if (card.type === "organization" && card.subtype === "company") {
    return card.faction === faction;
  }
  if (
    card.type === "asset" &&
    card.assetKind === "model" &&
    card.openness === "closed" &&
    card.faction !== "global"
  ) {
    return card.faction === faction;
  }
  return true;
}
