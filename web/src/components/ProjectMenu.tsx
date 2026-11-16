import { useState } from "react";
import { Check, ChevronDown, House } from "lucide-react";
import { go, useApp } from "@/lib/app";
import { listProjects, type ProjectSummary } from "@/lib/data";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/base/dropdown-menu";

/**
 * The Project's name at the top of its page, as a menu (#266): Home, and
 * the other Projects to switch to. The Projects are read when it opens.
 */
export function ProjectMenu({ id, name }: { id: string; name: string }) {
  const { db } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) listProjects(db).then(setProjects, () => setProjects([]));
      }}
    >
      <DropdownMenuTrigger className="-mx-1 flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-md px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">{name}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onSelect={() => go("/")}>
          <House /> Home
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Projects</DropdownMenuLabel>
        {projects === null && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
        {projects?.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => p.id !== id && go(`/p/${p.id}`)} aria-current={p.id === id ? "page" : undefined}>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.id === id && <Check className="text-muted-foreground" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
