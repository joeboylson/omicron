// The people table: everyone, their logins, and the Projects they're in
// (the ones you can see). Any member can add people to their Projects or
// take them out. Mirrors `omicron people`.

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addMember, listPeopleTable, listProjects, removeMember, type PersonRow, type ProjectSummary } from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { ListSkeleton } from "@/components/Skeleton";

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
  // Only the Projects you're in show (the rest aren't yours to see).
  const visible = (p: PersonRow) => p.projectIds.filter((id) => projects.some((pr) => pr.id === id));
  const choices = projects.map((pr) => ({ id: pr.id, name: pr.name }));
  const columns: ColumnDef<PersonRow, any>[] = [
    {
      accessorKey: "display_name",
      header: ({ column }) => <SortHeader column={column} label="Name" />,
      cell: ({ row: { original: p } }) => (
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
            {initials(p.display_name)}
          </span>
          <span className="font-medium">
            {p.display_name}
            {p.id === me.personId && <span className="font-normal text-muted-foreground"> (you)</span>}
          </span>
        </div>
      ),
    },
    {
      id: "login",
      accessorFn: (p) => p.logins.join(", "),
      header: ({ column }) => <SortHeader column={column} label="Login" />,
      cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>,
      meta: { className: "hidden md:table-cell" },
    },
    {
      id: "projects",
      accessorFn: (p) => visible(p).length,
      header: ({ column }) => <SortHeader column={column} label="Projects" />,
      cell: ({ row: { original: p } }) => (
        <MultiSelect
          label={`${p.display_name}'s Projects`}
          none="No Projects you're in"
          choices={choices}
          picked={new Set(visible(p))}
          toggle={(id, on) => change(() => (on ? addMember(db, id, p.id) : removeMember(db, id, p.id)))}
        />
      ),
      meta: { className: "w-[45%]" },
    },
  ];

  return (
    <>
      <TopBar here="/people" title="People" />
      <main className="mx-auto grid w-full max-w-5xl gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        {people === null ? (
          <ListSkeleton rows={4} />
        ) : (
          <DataTable
            label="People"
            columns={columns}
            data={people}
            rowLabel={(p) => p.display_name}
            initialSort={[{ id: "display_name", desc: false }]}
            search={{ label: "Search people", placeholder: "Search by name or login", text: (p) => `${p.display_name} ${p.logins.join(" ")}` }}
          />
        )}
      </main>
    </>
  );
}
