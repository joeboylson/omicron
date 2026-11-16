// The shapes of what the page reads.

export type ProjectSummary = {
  id: string;
  name: string;
  taskCount: number;
  memberCount: number;
  /** Machines added to it (not counting ones on every Project). */
  machineCount: number;
  /** Claude sessions running in it now. */
  sessionCount: number;
};

export type Status = { id: string; name: string; position: number; is_done: boolean; color: string | null };

export type Label = { id: string; name: string; color: string | null };

/** A second way to group tasks: rows on the board, like "Joe's to-do". */
export type Topic = { id: string; name: string; position: number };

export type Person = { id: string; display_name: string };

export type Comment = {
  id: string;
  author: string;
  session: string | null;
  body: string;
  created_at: string;
  /** Its images' paths in Storage (see IMAGES_BUCKET). */
  images: string[];
};

export type ChecklistItem = { id: string; text: string; done: boolean; position: number };

export type Task = {
  id: string;
  number: number;
  title: string;
  notes: string;
  status_id: string;
  due_on: string | null;
  needs_review: boolean;
  position: number;
  assignee_person_id: string | null;
  topic_id: string | null;
  /** The Claude session it was sent to, and when the session picked it up. */
  assignee_session_id: string | null;
  /** The session it was given to, which has since ended (until it's given out again). */
  ended_session: string | null;
  picked_up_at: string | null;
  labelIds: string[];
  checklist: ChecklistItem[];
  /** How many comments it has. The comments themselves are loaded when the
   *  task is opened (#265); until then `comments` is empty. */
  commentCount: number;
  comments: Comment[];
  /** Requests to hand it to its session, newest first. */
  dispatches: Dispatch[];
  /** Team jobs it's linked to. */
  jobs: JobLink[];
  /** When the task is a team member's question to a person. */
  question: TeamQuestion | null;
};

/** A team member's question, asked as a task; answered with a comment. */
export type TeamQuestion = {
  team: string;
  /** Who asked, like builder-2. */
  worker: string;
  open: boolean;
  asked_at: string;
  /** The comment that was passed on as the answer, and when. */
  answer_comment_id: string | null;
  answered_at: string | null;
  /** The team's computer, and when its gate closes (as it last said). */
  machine: string;
  gate_until: string | null;
};

/** A team's job, as linked from a task. */
export type JobLink = { id: string; team: string; number: number; title: string; state: string; step: string | null };

export type Dispatch = {
  id: string;
  state: "pending" | "claimed" | "done" | "failed";
  result: string | null;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  /** When it can no longer be taken (the database's 20 seconds). */
  claim_by: string;
};

export type HandoffNote = {
  id: string;
  number: number;
  session_id: string | null;
  state: "waiting" | "picked_up" | "replaced" | "cancelled";
  written_at: string;
  body: string;
};

export type ClaudeSession = {
  id: string;
  name: string;
  state: "open" | "closed" | "gone";
  folder: string;
  machine_id: string;
  machine: string;
  /** When its machine's gate closes, as the machine last said (display only). */
  gate_until: string | null;
  /** Why it's gone, when it is. */
  gone_why: string | null;
};

export type ProjectData = {
  id: string;
  name: string;
  /** How its Claude sessions work: given to a session with every task. */
  run_rules: string;
  statuses: Status[];
  labels: Label[];
  topics: Topic[];
  members: Person[];
  tasks: Task[];
  sessions: ClaudeSession[];
  handoffs: HandoffNote[];
  /** Running loops, one per session at most. */
  loops: SessionLoop[];
  /** Where its sessions start: one path on one machine each. Added only on that machine. */
  folders: Folder[];
  /** Its runs, newest first (the last few). */
  runs: Run[];
  /** Loops that have ended (stopped or finished), newest first, the last few. */
  pastLoops: SessionLoop[];
  /** Loops not started yet, and templates for new ones (#253). */
  plans: LoopPlan[];
};

/** A loop not started yet (a draft), or a template to start new ones from. */
/** What a loop's session does in each case (#261); a case left out uses the default. */
export type LoopRules = { question?: string; info?: string; done?: string; input?: string; idle?: string };

export type LoopPlan = {
  id: string;
  name: string;
  kind: "command" | "tasks";
  prompt: string;
  every_seconds: number | null;
  times: number | null;
  task_ids: string[];
  session_id: string | null;
  template: boolean;
  created_at: string;
  rules: LoopRules;
};

/** A session working down To do on its own (see `omicron runs`). */
export type Run = {
  id: string;
  machine_id: string;
  session_id: string | null;
  label_id: string | null;
  /** Who started it: its own machine (needs no gate), or a person elsewhere. */
  started_by: string;
  state: "running" | "pausing" | "stopped" | "finished";
  task_id: string | null;
  /** The tasks it works down, in order; null: the top status. */
  task_ids: string[] | null;
  done: number;
  note: string | null;
  started_at: string;
  updated_at: string;
};

export type Folder = { id: string; path: string; machine_id: string; machine: string };

/** A prompt Omicron types into a session every so often. */
export type SessionLoop = {
  id: string;
  session_id: string;
  state?: "running" | "stopped" | "finished";
  started_at?: string;
  prompt: string;
  every_seconds: number;
  until: string | null;
  times: number | null;
  runs: number;
  note: string | null;
  next_run_at: string;
  last_run_at: string | null;
  rules?: LoopRules;
  /** Next run as soon as the session's done, instead of every so often (#278). */
  asap?: boolean;
  /** Hands off and clears the session before each run (#278). */
  start_fresh?: boolean;
  /** The tasks it checks each run (#278). */
  watches?: LoopWatch[];
};

/** One item on a loop's list (#278): tasks by status, label and who
 *  they're given to (all must match), or one task. */
export type LoopWatch = {
  id: string;
  status_ids: string[];
  label_ids: string[];
  given_person: string | null;
  given_session: string | null;
  task_id: string | null;
  instructions: string;
};

/** A watch to add: any of its parts (the rest empty). */
export type NewWatch = Partial<Omit<LoopWatch, "id">>;

/** Who a task is given to: a person, a Claude session, or (both null) nobody. */
export type Who = { person: string | null; session: string | null };
