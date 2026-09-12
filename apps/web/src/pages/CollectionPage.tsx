/**
 * 卡牌收藏与内容图鉴。
 *
 * 作者：JucieOvo
 */

import { useEffect, useState } from "react";
import type { ContentResponse, ProfileResponse } from "../api";
import { api } from "../api";
import { CardTile } from "../components/CardTile";
import { Pagination } from "../components/Pagination";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { useAdaptivePageSize } from "../hooks/useAdaptivePageSize";

const filters = [
  { id: "all", label: "全部" },
  { id: "organization", label: "组织" },
  { id: "model", label: "模型" },
  { id: "technology", label: "技术" },
  { id: "action", label: "行动" },
  { id: "world_event", label: "世界事件" },
] as const;

export function CollectionPage() {
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = useAdaptivePageSize();

  useEffect(() => {
    Promise.all([api.getContent(), api.getProfile()])
      .then(([contentValue, profileValue]) => {
        setContent(contentValue);
        setProfile(profileValue);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  if (!content || !profile) {
    return <LoadingMessage label="读取卡牌收藏" />;
  }
  const unlocked = new Set(profile.collectionCardIds);
  const cards = content.cards.filter((card) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "model") {
      return card.subtype === "model";
    }
    if (filter === "technology") {
      return card.assetKind === "technology";
    }
    return card.type === filter;
  });
  const pageCount = Math.max(1, Math.ceil(cards.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleCards = cards.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="page-screen collection-page">
      <section className="panel collection-toolbar">
        <div className="panel-header">
          <div className="collection-filters">
            {filters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={["collection-filter", filter === item.id ? "active" : ""].join(" ")}
                onClick={() => {
                  setFilter(item.id);
                  setPage(1);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-[var(--muted)]">
            已解锁 {unlocked.size} / {content.cards.length}
          </span>
        </div>
      </section>
      <ErrorMessage message={error} />
      <section className="collection-content">
        <div className="collection-card-grid">
          {visibleCards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              actions={
                <span className="muted text-xs">
                  {unlocked.has(card.id) ? "已解锁" : "研究地图奖励"}
                </span>
              }
            />
          ))}
        </div>
        <Pagination
          page={currentPage}
          pageCount={pageCount}
          total={cards.length}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}
