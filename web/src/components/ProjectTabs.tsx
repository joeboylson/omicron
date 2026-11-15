// A Project's sections as a tab bar (#248), after Apple's tab bars: at the
// bottom on a phone, icon over a one-word label; on a wider screen a
// floating bar with its labels beside the icons, a little above the bottom.
// Tabs only move between sections, and every tab is always there (an empty
// one says why).
import { ListTodo, Repeat, Settings, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectTab = "tasks" | "dev" | "runs" | "settings";

export const PROJECT_TABS: { tab: ProjectTab; label: string; Icon: typeof ListTodo }[] = [
  { tab: "tasks", label: "Tasks", Icon: ListTodo },
  { tab: "dev", label: "Dev", Icon: TerminalSquare },
  { tab: "runs", label: "Runs", Icon: Repeat },
  { tab: "settings", label: "Settings", Icon: Settings },
];

export function ProjectTabs({ tab, onTab, badges = {} }: { tab: ProjectTab; onTab: (t: ProjectTab) => void; badges?: Partial<Record<ProjectTab, number>> }) {
  return (
    <nav
      aria-label="Project"
      data-tab-bar
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/75",
        // Wider screens: floating, rounded, a little above the bottom.
        "sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:p-1 sm:pb-1 sm:shadow-lg",
      )}
    >
      <ul className="flex sm:gap-1">
        {PROJECT_TABS.map(({ tab: t, label, Icon }) => {
          const on = t === tab;
          const count = badges[t];
          return (
            <li key={t} className="flex-1 sm:flex-none">
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onTab(t)}
                className={cn(
                  "relative flex h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  "sm:h-10 sm:flex-row sm:gap-2 sm:rounded-xl sm:px-4 sm:text-sm",
                  on ? "text-[var(--sys-blue)] sm:bg-accent sm:text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="h-6 w-6 sm:h-4 sm:w-4" aria-hidden strokeWidth={on ? 2.25 : 1.75} />
                  {count ? (
                    <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-[var(--sys-red)] px-1 text-center text-[0.6875rem] leading-4 text-white sm:hidden">
                      {count}
                    </span>
                  ) : null}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Space at the bottom of a tab's content so the bar never covers it. */
export const TAB_BAR_SPACE = "pb-[calc(3.25rem+env(safe-area-inset-bottom))] sm:pb-20";
