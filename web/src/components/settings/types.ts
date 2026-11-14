import type { ProjectData } from "@/lib/data";

/** What each section of Project settings gets: the Project, and a way to make a change (then reload). */
export type SectionProps = {
  project: ProjectData;
  change: (work: () => Promise<unknown>) => Promise<void>;
};
