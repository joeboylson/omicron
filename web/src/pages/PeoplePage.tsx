// The people table: everyone, their logins, and the Projects they're in
// (the ones you can see). Any member can add people to their Projects or
// take them out. Mirrors `omicron people`.

import { useCallback, useEffect, useState } from "react";
import { FolderKanban, MoreHorizontal, Trash2, UserMinus, UserPlus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/base/dropdown-menu";
import { useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addMember, deletePerson, listPeopleTable, listProjects, removeMember, type PersonRow, type ProjectSummary } from "@/lib/data";
import { Confirm } from "@/components/base/confirm";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/base/dialog";
import { TopBar } from "@/components/TopBar";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { chosenText } from "@/components/MultiSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  const [adding, setAdding] = useState(false);
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
  // Whose Projects are being changed, in a sheet (#236).
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const visible = (p: PersonRow) => p.projectIds.filter((id) => projects.some((pr) => pr.id === id));
  const choices = projects.map((pr) => ({ id: pr.id, name: pr.name }));
  const columns: ColumnDef<PersonRow, any>[] = [
    {
      accessorKey: "display_name",
      header: ({ column }) => <SortHeader column={column} label="Name" />,
      cell: ({ row: { original: p } }) => (
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
            {initials(p.display_name)}
          </span>
          <span className="min-w-0 font-medium">
            {p.display_name}
            {p.id === me.personId && <span className="font-normal text-muted-foreground"> (you)</span>}
            {/* On a phone, the login sits under the name. */}
            <span className="block max-w-[calc(100vw-8rem)] truncate tabular-nums text-xs font-normal text-muted-foreground sm:hidden" title={p.logins.join(", ")}>{p.logins.join(", ")}</span>
          </span>
        </div>
      ),
      meta: { phone: "main" },
    },
    {
      id: "login",
      accessorFn: (p) => p.logins.join(", "),
      header: ({ column }) => <SortHeader column={column} label="Login" />,
      cell: ({ getValue }) => <span className="tabular-nums text-xs text-muted-foreground">{getValue()}</span>,
      meta: { className: "hidden md:table-cell", phone: "hide" },
    },
    {
      id: "projects",
      accessorFn: (p) => visible(p).length,
      header: ({ column }) => <SortHeader column={column} label="Projects" />,
      // Text: changed from the person's ⋯ menu (#236).
      cell: ({ row: { original: p } }) => (
        <span className={cn("text-sm", visible(p).length === 0 && "text-muted-foreground")} data-testid="person-projects">
          {chosenText(choices, new Set(visible(p)), "None")}
        </span>
      ),
      meta: { className: "w-[45%]" },
    },
    {
      id: "delete",
      header: () => <span className="sr-only">Delete</span>,
      enableSorting: false,
      cell: ({ row: { original: p } }) => {
        // Taken out of the Project the list is showing, when it's filtered to one.
        const here = inProject && p.projectIds.includes(inProject) ? projects.find((pr) => pr.id === inProject) : undefined;
        // Deleted only if all their Projects are yours (the Web Machine checks too).
        const yours = p.projectIds.every((id) => projects.some((pr) => pr.id === id));
        const self = p.id === me.personId;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="text-muted-foreground" aria-label={`More for ${p.display_name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(p)}>
                  <FolderKanban /> Projects…
                </DropdownMenuItem>
                {!self && (here || yours) && <DropdownMenuSeparator />}
                {!self && here && (
                  <DropdownMenuItem onSelect={() => change(() => removeMember(db, here.id, p.id))}>
                    <UserMinus /> Remove from {here.name}
                  </DropdownMenuItem>
                )}
                {!self && here && yours && <DropdownMenuSeparator />}
                {!self && yours && (
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
      <TopBar
        here="/people"
        title="People"
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Add person
          </Button>
        }
      />
      <AddPerson open={adding} onOpenChange={setAdding} />
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
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent noClose className="gap-4 sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>{editing ? `${editing.display_name}'s Projects` : "Projects"}</DialogTitle>
            <DialogDescription className="sr-only">Tick the Projects they're in.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ul aria-label="Projects" className="grid">
              {projects.map((pr) => {
                const now = (people ?? []).find((x) => x.id === editing.id) ?? editing;
                const on = now.projectIds.includes(pr.id);
                return (
                  <li key={pr.id} className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      id={`pp-${pr.id}`}
                      checked={on}
                      onCheckedChange={(v) => change(() => (v ? addMember(db, pr.id, editing.id) : removeMember(db, pr.id, editing.id)))}
                    />
                    <Label htmlFor={`pp-${pr.id}`} className="flex-1 font-normal">
                      {pr.name}
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button onClick={() => setEditing(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirm
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.display_name ?? ""}?`}
        sentence={
          deleting && visible(deleting).length > 0
            ? `They're taken out of ${listNames(visible(deleting).map((id) => projects.find((pr) => pr.id === id)!.name))} and can't sign in again. This can't be undone.`
            : "They can't sign in again. This can't be undone."
        }
        action={`Delete ${deleting?.display_name ?? ""}`}
        onConfirm={() => deleting && change(() => deletePerson(db, deleting.id)).then(() => setDeleting(null))}
      />
    </>
  );
}

/** How someone new gets in: they open this page's address and sign in with
 *  Tailscale; then they're listed here, to add to Projects. */
function AddPerson({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const address = window.location.origin;
  // Opened on this computer itself, the address is one only it can use.
  const here = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(address);
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), setCopied(false))}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>Add someone</DialogTitle>
          <DialogDescription>
            {here
              ? "Send them the address you open Omicron with on your other devices. Once they’ve opened it, they’re listed here and you can add them to Projects."
              : "Send them this address. Once they’ve opened it, they’re listed here and you can add them to Projects."}
          </DialogDescription>
        </DialogHeader>
        {!here && (
          <div className="flex items-center gap-2 rounded-md bg-muted py-1.5 pl-3 pr-1">
            <code className="min-w-0 flex-1 break-all tabular-nums text-sm">{address}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigator.clipboard?.writeText(address).then(
                  () => setCopied(true),
                  () => {},
                )
              }
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
        <p className="text-sm text-muted-foreground">They need to be on your Tailscale network to open it.</p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
