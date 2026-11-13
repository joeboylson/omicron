// Commands that work anywhere: go to a page or a Project, change the theme.

import { useCallback, useEffect, useState } from "react";
import { go, useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { listProjects, type ProjectSummary } from "@/lib/data";
import { useCommands } from "@/lib/commands";
import { applyAppearance, saveAppearance, type Appearance } from "@/lib/theme";

export function GlobalCommands() {
  const { db, act, me } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const reload = useCallback(() => {
    listProjects(db).then(setProjects, () => {});
  }, [db]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);
  const theme = (a: Appearance) => () => {
    applyAppearance(a);
    act(() => saveAppearance(db, me.personId, a));
  };
  useCommands("global", [
    ...projects.map((p) => ({ id: `project-${p.id}`, label: p.name, group: "Projects", keywords: "go open project", run: () => go(`/p/${p.id}`) })),
    { id: "go-projects", label: "All Projects", group: "Go to", keywords: "home", run: () => go("/") },
    { id: "go-people", label: "People", group: "Go to", keywords: "members", run: () => go("/people") },
    { id: "go-settings", label: "Settings", group: "Go to", keywords: "preferences", run: () => go("/settings") },
    { id: "go-machines", label: "Machines", group: "Go to", keywords: "api keys", run: () => go("/machines") },
    { id: "theme-system", label: "Match the system", group: "Appearance", keywords: "theme", run: theme("system") },
    { id: "theme-light", label: "Light", group: "Appearance", keywords: "theme", run: theme("light") },
    { id: "theme-dark", label: "Dark", group: "Appearance", keywords: "theme night", run: theme("dark") },
  ]);
  return null;
}
