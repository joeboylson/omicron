import type { ReactNode } from "react";
import { go, useApp } from "@/lib/app";
import { Button } from "@/components/base/button";
import { cn } from "@/lib/utils";

const PAGES = [
  { path: "/", label: "Projects" },
  { path: "/people", label: "People" },
  { path: "/machines", label: "Machines" },
] as const;

/**
 * The top of the home pages: a menu to Projects, People and Machines, you
 * (to Settings), then the page's title with its actions beside it.
 */
export function TopBar({ here, title, actions }: { here: (typeof PAGES)[number]["path"]; title: string; actions?: ReactNode }) {
  const { me } = useApp();
  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-1 px-[max(0.5rem,env(safe-area-inset-left))]">
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1">
            {PAGES.map((p) => (
              <Button
                key={p.path}
                variant="ghost"
                size="sm"
                aria-current={p.path === here ? "page" : undefined}
                className={cn("text-muted-foreground", p.path === here && "bg-secondary text-foreground")}
                onClick={() => go(p.path)}
              >
                {p.label}
              </Button>
            ))}
          </nav>
          <Button
            variant="ghost"
            size="sm"
            className="max-w-40 shrink-0 truncate text-muted-foreground"
            data-testid="me"
            data-person-id={me.personId}
            data-via={me.via}
            title={me.login}
            aria-label={`${me.displayName}: Settings`}
            onClick={() => go("/settings")}
          >
            {me.displayName}
          </Button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-3 pt-4">
        <h1 className="flex-1 truncate text-3xl font-bold tracking-tight">{title}</h1>
        {actions}
      </div>
    </>
  );
}
