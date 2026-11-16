// A task's comments, with images shown as thumbnails that open full size
// (written in the Composer).

import { useEffect, useRef, useState } from "react";
import { loadDraft, saveDraft } from "@/lib/drafts";
import { Terminal } from "lucide-react";
import { ImageViewer } from "@/components/ImageViewer";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/lib/app";
import { addComment, imageLinks, imageName, type Comment, type ProjectData, type Task } from "@/lib/data";
import { Composer } from "@/components/Composer";
import { Group } from "@/components/Grouped";
import { cn } from "@/lib/utils";

// Links last an hour; kept for the page's life so images don't flicker on reload.
const links = new Map<string, string>();

/** On a team's question: what happened to a person's comment as an answer. */
function answerMark(task: Task, c: Comment): string | null {
  const q = task.question;
  if (!q || c.session || c.created_at < q.asked_at) return null;
  if (q.answer_comment_id === c.id) return `Passed on to ${q.worker}`;
  if (!q.open) return null;
  const open = q.gate_until !== null && new Date(q.gate_until).getTime() > Date.now();
  return open ? `Passing on to ${q.worker}…` : `Held until ${q.machine}'s remote control is on`;
}

export function Comments({
  project,
  task,
  change,
  when,
  id = "task-comments",
}: {
  project: ProjectData;
  task: Task;
  /** Its id on the page (the tree view shows many, #268). */
  id?: string;
  change: (work: () => Promise<unknown>) => Promise<unknown>;
  when: (iso: string) => string;
}) {
  const { db, act } = useApp();
  // Kept for this task until it's sent, even if the sheet closes (#200).
  const [comment, setCommentNow] = useState(() => loadDraft(task.id));
  const setComment = (text: string) => {
    setCommentNow(text);
    saveDraft(task.id, text);
  };
  // The comment that's the session's report, while it waits for review.
  const report = task.needs_review ? [...task.comments].reverse().find((c) => c.session)?.id : undefined;
  // The comment's images being looked at, and which one.
  const [viewing, setViewing] = useState<{ images: string[]; at: number } | null>(null);
  const [, setLinksVersion] = useState(0);
  // The thumbnail that opened the viewer, to put focus back on when it closes.
  const opener = useRef<HTMLButtonElement | null>(null);

  // Links for the images shown.
  const shown = task.comments.flatMap((c) => c.images);
  const missing = shown.filter((p) => !links.has(p));
  useEffect(() => {
    if (missing.length === 0) return;
    act(async () => {
      for (const [p, url] of Object.entries(await imageLinks(db, missing))) links.set(p, url);
      setLinksVersion((v) => v + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.join("|")]);

  return (
    <Group title="Comments" id={id}>
      {task.comments.length > 0 && (
        <ul aria-label="Comments" className="divide-y">
          {/* Unread: the session's last comment is its report. */}
          {task.comments.map((c) => (
            <li
              key={c.id}
              className={cn("grid gap-1 px-4 py-3 text-[0.9375rem] sm:text-sm", c.id === report && "border-l-4 border-l-[var(--sys-indigo)] bg-[var(--sys-indigo)]/5")}
            >
              {c.id === report && (
                <span className="text-xs font-medium text-[var(--indigo-text)]" data-testid="report-mark">
                  Report · Unread
                </span>
              )}
              <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                {/* A session's comment is the session's; its computer is where. */}
                {c.session ? (
                  <span className="flex items-center gap-1" data-testid="comment-author">
                    <Terminal className="h-3 w-3 self-center" aria-hidden />
                    <span className="tabular-nums font-medium text-foreground">{c.session}</span>
                    <span>on {c.author}</span>
                  </span>
                ) : (
                  <span className="font-medium text-foreground" data-testid="comment-author">
                    {c.author}
                  </span>
                )}
                <time className="ml-auto tabular-nums" dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()}>
                  {when(c.created_at)}
                </time>
              </div>
              {c.body && <Markdown text={c.body} />}
              {answerMark(task, c) && <p className="text-xs text-muted-foreground" data-testid="answer-mark">{answerMark(task, c)}</p>}
              {c.images.length > 0 && (
                <ul aria-label="Images" className="mt-1 flex flex-wrap gap-2">
                  {c.images.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        onClick={(e) => {
                          opener.current = e.currentTarget;
                          setViewing({ images: c.images, at: c.images.indexOf(path) });
                        }}
                        aria-label={`Open ${imageName(path)}`}
                        className="block overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {links.get(path) ? (
                          <img src={links.get(path)} alt={imageName(path)} className="h-24 max-w-40 object-cover" loading="lazy" />
                        ) : (
                          <span className="block h-24 w-32 animate-pulse motion-reduce:animate-none" aria-hidden />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Composer
        projectId={project.id}
        value={comment}
        onChange={setComment}
        onSend={(body, images, clear) => change(async () => {
          await addComment(db, task, body, images);
          clear();
        })}
        placeholder={task.question?.open ? `Answer ${task.question.worker}` : "Add a comment"}
        label="New comment"
      />

      <ImageViewer
        images={viewing?.images ?? []}
        at={viewing?.at ?? null}
        link={(p) => links.get(p)}
        name={imageName}
        onAt={(at) => setViewing((v) => (v ? { ...v, at } : v))}
        onClose={() => {
          setViewing(null);
          // Back to the thumbnail it was opened from.
          setTimeout(() => opener.current?.focus(), 0);
        }}
      />
    </Group>
  );
}
