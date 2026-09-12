/**
 * 参考客户端全局布局。
 *
 * 作者：JucieOvo
 */

import {
  BookOpen,
  FlaskConical,
  GraduationCap,
  Home,
  Library,
  Settings,
  Swords,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";

const navigation = [
  { to: "/", label: "实验室", icon: Home },
  { to: "/deck", label: "牌组", icon: BookOpen },
  { to: "/research", label: "研究地图", icon: FlaskConical },
  { to: "/collection", label: "收藏", icon: Library },
  { to: "/tutorial", label: "教程", icon: GraduationCap },
  { to: "/sandbox", label: "沙盒", icon: FlaskConical },
  { to: "/settings", label: "系统", icon: Settings },
] as const;

export function Layout() {
  const location = useLocation();
  const isBattle = location.pathname.startsWith("/match/");
  if (isBattle) {
    return (
      <div className="battle-root">
        <header className="battle-topbar">
          <NavLink to="/" className="flex items-center gap-2 font-bold">
            <Swords size={18} color="var(--accent)" />
            <span>模型大战魔型</span>
          </NavLink>
          <span className="text-xs text-[var(--muted)]">对局牌桌</span>
        </header>
        <main className="battle-main">
          <Outlet />
        </main>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="flex items-center gap-2 font-bold">
            <Swords size={23} color="var(--accent)" />
            <span>模型大战魔型</span>
            <span className="text-xs font-normal text-[var(--muted)]">MODEL MAYHEM</span>
          </NavLink>
          <nav className="app-navigation">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "app-navigation-link",
                      isActive
                        ? "bg-[var(--surface-3)] text-[var(--accent-strong)]"
                        : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
                    ].join(" ")
                  }
                >
                  <Icon size={18} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
