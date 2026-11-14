// Who's in a Project, in one place from the board's header: its members
// (add and take out), and the link to send someone new.
import { useEffect, useState } from "react";
import { Share } from "lucide-react";
import { useApp } from "@/lib/app";
import { listPeople, type Person, type ProjectData } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Group, Row } from "@/components/Grouped";
import { MembersSection } from "@/components/settings/Members";
import { initials } from "@/components/TaskCard";

/** The page's address only this computer can open (its own name for itself). */
export function onlyHere(address: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(address);
}

/** The header's button: the first few members' faces, opening the sheet. */
export function ShareButton({ project, onClick }: { project: ProjectData; onClick: () => void }) {
  const { me } = useApp();
  const shown = [...project.members].sort((a, b) => Number(a.id === me.personId) - Number(b.id === me.personId)).slice(0, 3);
  const n = project.members.length;
  return (
    <Button variant="ghost" className="gap-1.5 px-2" aria-label={`Share, ${n} ${n === 1 ? "member" : "members"}`} onClick={onClick}>
      <span aria-hidden className="flex -space-x-2">
        {shown.map((m) => (
          <span key={m.id} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-secondary text-[11px] font-medium">
            {initials(m.display_name)}
          </span>
        ))}
      </span>
      <Share className="h-5 w-5 text-muted-foreground" aria-hidden />
    </Button>
  );
}

export function ShareSheet({
  project,
  open,
  onOpenChange,
  onChanged,
}: {
  project: ProjectData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  const [people, setPeople] = useState<Person[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setCopied(false);
      act(async () => setPeople(await listPeople(db)));
    }
  }, [open, db, act]);
  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) {
      setPeople(await listPeople(db));
      onChanged();
    }
  };
  const link = window.location.href.split("?")[0];
  const here = onlyHere(link);
  const canShare = typeof navigator.share === "function";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
        <DialogHeader className="text-left">
          <DialogTitle>Share {project.name}</DialogTitle>
          <DialogDescription className="sr-only">Who's in {project.name}, and the link to send someone new.</DialogDescription>
        </DialogHeader>
        <MembersSection project={project} change={change} people={people} />
        <Group title="Link">
          {here ? (
            <Row className="py-2 text-sm">Open Omicron on another device to get a link others can use.</Row>
          ) : (
            <Row className="py-2">
              <span className="min-w-0 flex-1 truncate text-sm" title={link}>
                {link.replace(/^https?:\/\//, "")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-link"
                onClick={() =>
                  navigator.clipboard?.writeText(link).then(
                    () => setCopied(true),
                    () => {},
                  )
                }
              >
                {copied ? "Copied" : "Copy Link"}
              </Button>
              {canShare && (
                <Button variant="ghost" size="sm" className="text-link" onClick={() => navigator.share({ title: project.name, url: link }).catch(() => {})}>
                  Share…
                </Button>
              )}
            </Row>
          )}
        </Group>
      </DialogContent>
    </Dialog>
  );
}
