// The people table: everyone, their logins, and the Projects they're in
// (the ones you can see). Any member can add people to their Projects or
// take them out. Mirrors `omicron people`.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Plus, Search, X } from "lucide-react";
import { go, useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addMember, listPeopleTable, listProjects, removeMember, type PersonRow, type ProjectSummary } from "@/lib/data";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Group } from "@/components/Grouped";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function PeoplePage() {
  const { db, act, me } = useApp();
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");

  const reload = useCallback(() => {
    act(async () => {
      const [p, pr] = await Promise.all([listPeopleTable(db), listProjects(db)]);
      setPeople(p);
      setProjects(pr);
    });
  }, [db, act]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);

  const change = (work: () => Promise<unknown>) => act(work).then((ok) => ok && reload());
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (people ?? []).filter((p) => {
    const text = `${p.display_name} ${p.logins.join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });

  return (
    <>
      <NavBar
        title="People"
        titleClassName="mx-auto w-full max-w-3xl"
        left={
          <Button variant="ghost" className="gap-0.5 px-2 [&_svg]:size-5" aria-label="Back to Projects" onClick={() => go("/")}>
            <ChevronLeft /> Projects
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-3xl px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or login"
            aria-label="Search people"
            className="pl-9"
          />
        </div>
        {people === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <Group
            title={`${shown.length} ${shown.length === 1 ? "person" : "people"}`}
            note="Projects show here when you're in them too. People sign in with Tailscale; anyone you add sees the Project straight away."
          >
            {shown.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nobody matches “{query}”.</p>
            ) : (
              <ul aria-label="People" className="divide-y">
                {shown.map((p) => {
                  const outside = projects.filter((pr) => !p.projectIds.includes(pr.id));
                  const inside = p.projectIds.filter((id) => name(id));
                  return (
                    <li key={p.id} aria-label={p.display_name} className="flex gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium sm:bg-secondary"
                      >
                        {initials(p.display_name)}
                      </span>
                      <div className="grid min-w-0 flex-1 gap-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[15px] font-medium sm:text-sm">
                            {p.display_name}
                            {p.id === me.personId && <span className="font-normal text-muted-foreground"> (you)</span>}
                          </span>
                          <span className="truncate font-mono text-xs text-muted-foreground">{p.logins.join(", ")}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${p.display_name}'s Projects`}>
                          {inside.length === 0 && <span className="text-sm text-muted-foreground">No Projects you're in.</span>}
                          {inside.map((id) => (
                            <Badge key={id} variant="secondary" className="gap-1 pr-1 font-normal">
                              {name(id)}
                              <button
                                type="button"
                                aria-label={`Take ${p.display_name} out of ${name(id)}`}
                                className="rounded-full p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => change(() => removeMember(db, id, p.id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                          {outside.length > 0 && (
                            <Select value="" onValueChange={(id) => change(() => addMember(db, id, p.id))}>
                              <SelectTrigger
                                aria-label={`Add ${p.display_name} to a Project`}
                                className="h-7 w-auto gap-1 border-dashed px-2 text-xs text-muted-foreground"
                              >
                                <Plus className="h-3 w-3" aria-hidden />
                                <SelectValue placeholder="Add to…" />
                              </SelectTrigger>
                              <SelectContent>
                                {outside.map((pr) => (
                                  <SelectItem key={pr.id} value={pr.id}>
                                    {pr.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Group>
        )}
      </main>
    </>
  );
}
