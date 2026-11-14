// The people table: everyone, their logins, and the Projects they're in
// (the ones you can see). Any member can add people to their Projects or
// take them out. Mirrors `omicron people`.

import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal, Trash2, UserMinus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addMember, deletePerson, listPeopleTable, listProjects, removeMember, type PersonRow, type ProjectSummary } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/base/dialog";
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

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function PeoplePage() {
  const { db, act, me } = useApp();
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // Only people in one Project ("" for everyone).
  const [inProject, setInProject] = useState("");
  // Deleting asks once more, in a dialog.
  const [deleting, setDeleting] = useState<PersonRow | null>(null);

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
            {/* On a phone, the login sits under the name. */}
            <span className="block break-all font-mono text-xs font-normal text-muted-foreground sm:hidden">{p.logins.join(", ")}</span>
          </span>
        </div>
      ),
      meta: { phone: "main" },
    },
    {
      id: "login",
      accessorFn: (p) => p.logins.join(", "),
      header: ({ column }) => <SortHeader column={column} label="Login" />,
      cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>,
      meta: { className: "hidden md:table-cell", phone: "hide" },
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
    {
      id: "delete",
      header: () => <span className="sr-only">Delete</span>,
      enableSorting: false,
      cell: ({ row: { original: p } }) => {
        if (p.id === me.personId) return null;
        // Taken out of the Project the list is showing, when it's filtered to one.
        const here = inProject && p.projectIds.includes(inProject) ? projects.find((pr) => pr.id === inProject) : undefined;
        // Deleted only if all their Projects are yours (the Web Machine checks too).
        const yours = p.projectIds.every((id) => projects.some((pr) => pr.id === id));
        if (!here && !yours) return null;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="text-muted-foreground" aria-label={`More for ${p.display_name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {here && (
                  <DropdownMenuItem onSelect={() => change(() => removeMember(db, here.id, p.id))}>
                    <UserMinus /> Remove from {here.name}
                  </DropdownMenuItem>
                )}
                {here && yours && <DropdownMenuSeparator />}
                {yours && (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(p)}>
                    <Trash2 /> Delete {p.display_name}…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      meta: { className: "w-0 whitespace-nowrap", phone: "end" },
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
            data={inProject ? people.filter((p) => p.projectIds.includes(inProject)) : people}
            toolbar={
              projects.length > 0 && (
                <select
                  aria-label="Only people in"
                  value={inProject}
                  onChange={(e) => setInProject(e.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Everyone</option>
                  {projects.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      In {pr.name}
                    </option>
                  ))}
                </select>
              )
            }
            rowLabel={(p) => p.display_name}
            initialSort={[{ id: "display_name", desc: false }]}
            search={{ label: "Search people", placeholder: "Search by name or login", text: (p) => `${p.display_name} ${p.logins.join(" ")}` }}
          />
        )}
      </main>
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="gap-4 sm:max-w-md">
          {deleting && (
            <>
              <DialogHeader className="text-left">
                <DialogTitle>Delete {deleting.display_name}?</DialogTitle>
                <DialogDescription>
                  {visible(deleting).length > 0
                    ? `They're taken out of ${listNames(visible(deleting).map((id) => projects.find((pr) => pr.id === id)!.name))}, and can't sign in again. This can't be undone.`
                    : "They can't sign in again. This can't be undone."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setDeleting(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => change(() => deletePerson(db, deleting.id)).then(() => setDeleting(null))}>
                  Delete {deleting.display_name}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
