/**
 * 开源软件鸣谢页面。
 *
 * 作者：JucieOvo
 *
 * 该页面只展示游戏代码使用的生产依赖，不展示卡牌内容来源。数据由发行流程生成，
 * 前端不读取 node_modules 或项目源码。
 */

import { ExternalLink, ScrollText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";

interface CreditPackage {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
  readonly homepage: string | null;
  readonly direct: boolean;
}

interface CreditData {
  readonly generatedFrom: string;
  readonly packageCount: number;
  readonly projectCount: number;
  readonly packages: readonly CreditPackage[];
}

export function CreditsPage() {
  const [data, setData] = useState<CreditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [directOnly, setDirectOnly] = useState(false);

  useEffect(() => {
    fetch("/credits.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`读取鸣谢数据失败：HTTP ${response.status}`);
        }
        return (await response.json()) as CreditData;
      })
      .then(setData)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  const visiblePackages = useMemo(() => {
    if (!data) {
      return [];
    }
    const normalizedQuery = query.trim().toLowerCase();
    return data.packages.filter((pkg) => {
      if (directOnly && !pkg.direct) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return `${pkg.name} ${pkg.license}`.toLowerCase().includes(normalizedQuery);
    });
  }, [data, directOnly, query]);

  if (!data) {
    return error ? <ErrorMessage message={error} /> : <LoadingMessage label="读取开源鸣谢" />;
  }

  return (
    <div className="page-screen credits-page">
      <section className="panel credits-header">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <ScrollText size={19} color="var(--accent)" />
            <div>
              <strong>开源鸣谢</strong>
              <div className="mt-1 text-xs text-[var(--muted)]">
                游戏代码使用的生产依赖，共 {data.projectCount} 个项目、{data.packageCount}{" "}
                个安装版本
              </div>
            </div>
          </div>
          <a className="ghost-button" href="/THIRD_PARTY_LICENSES.txt" download>
            <ExternalLink size={16} />
            完整许可证
          </a>
        </div>
        <div className="credits-toolbar">
          <label className="credits-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索软件或许可证"
            />
          </label>
          <button
            type="button"
            className={["credits-filter", directOnly ? "active" : ""].join(" ")}
            onClick={() => setDirectOnly((value) => !value)}
          >
            仅直接依赖
          </button>
          <span className="text-xs text-[var(--muted)]">显示 {visiblePackages.length} 项</span>
        </div>
      </section>

      <section className="credits-grid">
        {visiblePackages.map((pkg) => (
          <article className="credits-card" key={pkg.name}>
            <div className="credits-card-heading">
              <strong>{pkg.name}</strong>
              {pkg.direct ? <span>直接依赖</span> : null}
            </div>
            <div className="credits-version">{pkg.versions.join(" / ")}</div>
            <div className="credits-license">{pkg.license}</div>
            {pkg.homepage ? (
              <a href={pkg.homepage} target="_blank" rel="noreferrer">
                项目主页
                <ExternalLink size={13} />
              </a>
            ) : (
              <span className="credits-no-link">无项目主页</span>
            )}
          </article>
        ))}
        {visiblePackages.length === 0 ? (
          <div className="credits-empty">没有匹配的开源项目</div>
        ) : null}
      </section>

      <ErrorMessage message={error} />
    </div>
  );
}
