// Who's in a Project, in one place from the board's header: its members
// (add and take out), and the link to send someone new.
import { CopyButton } from "@/components/CopyButton";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { listPeople, type Person, type ProjectData } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Group, Row } from "@/components/Grouped";
import { MembersSection } from "@/components/settings/Members";

/** The page's address only this computer can open (its own name for itself). */
export function onlyHere(address: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(address);
}

/** Who's in a Project and the link to send someone new: the top of its
 *  Settings tab (#248). */
export function Sharing({ project, onChanged }: { project: ProjectData; onChanged: () => void }) {
  const { db, act } = useApp();
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    act(async () => setPeople(await listPeople(db)));
  }, [db, act]);
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
    <>
      <MembersSection project={project} change={change} people={people} />
      <Group title="Link">
        {here ? (
          <Row className="py-2 text-sm">Open Omicron on another device to get a link others can use.</Row>
        ) : (
          <Row className="py-2">
            <span className="min-w-0 flex-1 truncate text-sm" title={link}>
              {link.replace(/^https?:\/\//, "")}
            </span>
            <CopyButton text={link} label="Copy Link" className="text-link" />
            {canShare && (
              <Button variant="ghost" size="sm" className="text-link" onClick={() => navigator.share({ title: project.name, url: link }).catch(() => {})}>
                Share…
              </Button>
            )}
          </Row>
        )}
      </Group>
    </>
  );
}
