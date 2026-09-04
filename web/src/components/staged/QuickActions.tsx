/**
 * The sidebar's quick-action block from the new design.
 *
 * Staged: finished as a component, not mounted. Every action it shows —
 * report a fault, scan equipment, new work order, record maintenance —
 * exists in the product only as a dialog opened from a device that has
 * already been chosen. None of them has a standalone route to link to,
 * so mounting this now would put four buttons in the sidebar that lead
 * nowhere.
 *
 * They become real in the stage that adds the create flows. At that
 * point this takes the list and renders it; nothing here needs
 * rewriting.
 */
import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export interface QuickAction {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Tints the icon where an action is urgent rather than routine. */
  tone?: "default" | "urgent";
}

export function QuickActions({
  actions,
  collapsed = false,
}: {
  actions: QuickAction[];
  collapsed?: boolean;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="mt-6">
      {!collapsed && (
        <h2 className="px-3 pb-2 text-[0.65rem] font-medium uppercase tracking-wider text-brand-300/70">
          Quick actions
        </h2>
      )}
      <ul>
        {actions.map(({ label, to, icon: Icon, tone = "default" }) => (
          <li key={to}>
            <NavLink
              to={to}
              title={collapsed ? label : undefined}
              className={`mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-brand-100/80 transition hover:bg-white/10 hover:text-white ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <Icon size={16} className={tone === "urgent" ? "text-rose-400" : "text-brand-300"} />
              {!collapsed && <span className="flex-1">{label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
