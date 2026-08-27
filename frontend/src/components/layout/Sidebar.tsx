import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ShieldHalf } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from "./nav-config";

const STORAGE_KEY = "sentinel-sidebar-collapsed";

// Pixel-matched to the reference design (Sentinel.dc.html): 232px expanded /
// 64px collapsed, active state is an inset left accent bar (not a filled
// pill), 220ms cubic-bezier width transition.
export function Sidebar() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  const visibleItems = user
    ? NAV_ITEMS.filter((item) => item.roles.includes(user.role))
    : [];

  return (
    <aside
      className={cn(
        "hidden md:flex h-screen shrink-0 flex-col overflow-hidden border-r border-[var(--border-default)] bg-[var(--bg-surface)] py-4 px-3 transition-[width] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        collapsed ? "w-16" : "w-[232px]",
      )}>
      <div className="flex items-center gap-2.5 px-2 pb-5 pt-1.5">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand)]">
          <ShieldHalf
            className="h-[15px] w-[15px] text-white"
            strokeWidth={2.2}
          />
        </div>
        {!collapsed && (
          <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">
            CamOps
          </span>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-[11px] whitespace-nowrap rounded-lg px-2.5 py-[9px] text-sm text-[var(--text-secondary)] transition-colors duration-[140ms]",
                "hover:bg-[var(--color-brand-soft)] hover:text-[var(--text-primary)]",
                isActive &&
                  "bg-[var(--color-brand-soft)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--color-brand)]",
              )
            }
            title={collapsed ? item.label : undefined}>
            <item.icon
              className="h-[18px] w-[18px] shrink-0"
              strokeWidth={1.7}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Pinned to the bottom, above Collapse — not part of the scrolling
          nav list — so it stays anchored regardless of role/item count. */}
      {user && SETTINGS_NAV_ITEM.roles.includes(user.role) && (
        <NavLink
          to={SETTINGS_NAV_ITEM.path}
          className={({ isActive }) =>
            cn(
              "mt-1 flex items-center gap-[11px] whitespace-nowrap rounded-lg border-t border-[var(--border-default)] px-2.5 py-[9px] pt-[13px] text-sm text-[var(--text-secondary)] transition-colors duration-[140ms]",
              "hover:bg-[var(--color-brand-soft)] hover:text-[var(--text-primary)]",
              isActive &&
                "bg-[var(--color-brand-soft)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--color-brand)]",
            )
          }
          title={collapsed ? SETTINGS_NAV_ITEM.label : undefined}>
          <SETTINGS_NAV_ITEM.icon
            className="h-[18px] w-[18px] shrink-0"
            strokeWidth={1.7}
          />
          {!collapsed && <span className="truncate">{SETTINGS_NAV_ITEM.label}</span>}
        </NavLink>
      )}

      <button
        onClick={toggle}
        className="mt-1 flex items-center gap-[11px] whitespace-nowrap rounded-lg border-t border-[var(--border-default)] px-2.5 py-[9px] text-[12.5px] text-[var(--text-secondary)] transition-colors duration-[140ms] hover:bg-[var(--color-brand-soft)] hover:text-[var(--text-primary)]">
        <ChevronLeft
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-transform duration-200",
            collapsed && "rotate-180",
          )}
          strokeWidth={1.7}
        />
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
