// Commands that work anywhere: go to a page or a Project, change the theme.

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/lib/toast";
import { go, useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addedToProjects, listPeople, listProjects, type ProjectSummary } from "@/lib/data";
import { useCommands } from "@/lib/commands";
import { applyAppearance, currentAppearance, saveAppearance, type Appearance } from "@/lib/theme";

export function GlobalCommands() {
  const { db, act, me } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const toast = useToast();
  // When someone adds you to a Project, say so, once (#244). Since when is
  // kept in this browser; the first visit starts from now.
  const seenKey = `omicron.addedSince.${me.personId}`;
  const checking = useRef(false);
  const tellAdded = useCallback(
    async (list: ProjectSummary[]) => {
      if (checking.current) return;
      checking.current = true;
      try {
        let since: string | null = null;
        try {
          since = localStorage.getItem(seenKey);
        } catch {
          // Not kept: start from now.
        }
        const now = new Date().toISOString();
        if (!since) {
          try {
            localStorage.setItem(seenKey, now);
          } catch {
            // Fine.
          }
          return;
        }
        const added = await addedToProjects(db, me.personId, since);
        if (added.length === 0) return;
        const last = added[added.length - 1];
        try {
          localStorage.setItem(seenKey, last.at);
        } catch {
          // Fine.
        }
        const project = list.find((p) => p.id === last.projectId);
        if (!project) return;
        const people = last.by ? await listPeople(db).catch(() => []) : [];
        const who = people.find((p) => p.id === last.by)?.display_name;
        toast({
          message: `${who ?? "Someone"} added you to ${project.name}`,
          action: { label: "Open", run: () => go(`/p/${project.id}`) },
        });
      } finally {
        checking.current = false;
      }
    },
    [db, me.personId, seenKey, toast],
  );
  const reload = useCallback(() => {
    listProjects(db).then((list) => {
      setProjects(list);
      tellAdded(list);
    }, () => {});
  }, [db, tellAdded]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);
  const theme = (a: Appearance) => () => {
    applyAppearance(a);
    act(() => saveAppearance(db, me.personId, a));
  };
  useCommands(
    "projects",
    projects.map((p) => ({ id: `project-${p.id}`, label: p.name, group: "Projects", keywords: "go open project", run: () => go(`/p/${p.id}`) })),
  );
  useCommands("global", [
    { id: "go-projects", label: "All Projects", group: "Go to", keywords: "home", run: () => go("/") },
    { id: "go-people", label: "People", group: "Go to", keywords: "members", run: () => go("/people") },
    { id: "go-settings", label: "Settings", group: "Go to", keywords: "preferences", run: () => go("/settings") },
    { id: "go-machines", label: "Machines", group: "Go to", keywords: "api keys", run: () => go("/machines") },
    { id: "theme-system", label: "Match the system", group: "Appearance", keywords: "theme", checked: () => currentAppearance() === "system", run: theme("system") },
    { id: "theme-light", label: "Light", group: "Appearance", keywords: "theme", checked: () => currentAppearance() === "light", run: theme("light") },
    { id: "theme-dark", label: "Dark", group: "Appearance", keywords: "theme night", checked: () => currentAppearance() === "dark", run: theme("dark") },
  ]);
  return null;
}
