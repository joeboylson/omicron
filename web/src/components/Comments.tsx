// A task's comments, with images: added by pasting, dropping or picking
// files, uploaded right away (so Send is quick), shown as thumbnails that
// open full size.

import { useEffect, useRef, useState } from "react";
import { loadDraft, saveDraft } from "@/lib/drafts";
import { AlertCircle, ImagePlus, Loader2, Terminal, X } from "lucide-react";
import { ImageViewer } from "@/components/ImageViewer";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/lib/app";
import {
  addComment,
  imageLinks,
  imageName,
  imageProblem,
  randomId,
  IMAGE_TYPES,
  IMAGES_PER_COMMENT,
  uploadImage,
  type Comment,
  type ProjectData,
  type Task,
} from "@/lib/data";
import { Button } from "@/components/base/button";
import { Textarea } from "@/components/ui/textarea";
import { Group, Row } from "@/components/Grouped";
import { cn } from "@/lib/utils";

/** An image being added to the new comment. */
type Pending = { key: string; name: string; preview: string; path?: string; error?: string };

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
}: {
  project: ProjectData;
  task: Task;
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
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  // The comment's images being looked at, and which one.
  const [viewing, setViewing] = useState<{ images: string[]; at: number } | null>(null);
  const [, setLinksVersion] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
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

  // Previews are only needed while the comment is being written.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function add(files: File[]) {
    const room = IMAGES_PER_COMMENT - pending.length;
    for (const [i, file] of files.entries()) {
      const key = randomId();
      const name = file.name || "Pasted image";
      if (i >= room) {
        setPending((p) => [...p, { key, name, preview: "", error: `A comment can have at most ${IMAGES_PER_COMMENT} images.` }]);
        continue;
      }
      const problem = imageProblem(file);
      const preview = problem ? "" : URL.createObjectURL(file);
      if (preview) previews.current.push(preview);
      setPending((p) => [...p, { key, name, preview, error: problem ?? undefined }]);
      if (problem) continue;
      uploadImage(db, project.id, file).then(
        (path) => setPending((p) => p.map((x) => (x.key === key ? { ...x, path } : x))),
        (e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error: `Couldn't add ${name}: ${e.message}` } : x))),
      );
    }
  }

  const uploading = pending.some((p) => !p.path && !p.error);
  const ready = pending.filter((p) => p.path).map((p) => p.path!);
  const canSend = !uploading && (comment.trim() !== "" || ready.length > 0);

  async function send() {
    if (!canSend) return;
    const body = comment.trim();
    await change(async () => {
      await addComment(db, task, body, ready);
      setComment("");
      setPending([]);
    });
  }

  return (
    <Group title="Comments" id="task-comments">
      {task.comments.length > 0 && (
        <ul aria-label="Comments" className="divide-y">
          {/* Waiting for review: the session's last comment is its report. */}
          {task.comments.map((c) => (
            <li
              key={c.id}
              className={cn("grid gap-1 px-4 py-3 text-[15px] sm:text-sm", c.id === report && "border-l-4 border-l-[var(--sys-indigo)] bg-[var(--sys-indigo)]/5")}
            >
              {c.id === report && (
                <span className="text-xs font-medium text-[var(--indigo-text)]" data-testid="report-mark">
                  Report · Needs review
                </span>
              )}
              <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                {/* A session's comment is the session's; its computer is where. */}
                {c.session ? (
                  <span className="flex items-center gap-1" data-testid="comment-author">
                    <Terminal className="h-3 w-3 self-center" aria-hidden />
                    <span className="font-mono font-medium text-foreground">{c.session}</span>
                    <span>on {c.author}</span>
                  </span>
                ) : (
                  <span className="font-medium text-foreground" data-testid="comment-author">
                    {c.author}
                  </span>
                )}
                <time className="ml-auto font-mono" dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()}>
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          add([...e.dataTransfer.files]);
        }}
        className={cn("transition-colors", dragging && "bg-[color-mix(in_srgb,var(--sys-blue)_10%,transparent)]")}
      >
        {pending.length > 0 && (
          <ul aria-label="New images" className="flex flex-wrap gap-2 px-4 pt-3">
            {pending.map((p) => (
              <li key={p.key} className="relative">
                {p.error ? (
                  <div role="alert" className="flex max-w-64 items-start gap-1.5 rounded-md border border-[var(--sys-red)] px-2 py-1.5 text-xs">
                    <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--sys-red)]" aria-hidden />
                    <span className="flex-1">{p.error}</span>
                  </div>
                ) : (
                  <div className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
                    <img src={p.preview} alt={p.name} className="h-full w-full object-cover" />
                    {!p.path && (
                      <span className="absolute inset-0 grid place-items-center bg-background/60" aria-label={`Adding ${p.name}`}>
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => setPending((all) => all.filter((x) => x.key !== p.key))}
                  className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full after:absolute after:-inset-2.5 after:content-[''] border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Row className="items-end py-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                add(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }}
            placeholder={dragging ? "Drop images to add them" : "Add a comment"}
            aria-label="New comment"
            rows={1}
            className="min-h-10 resize-none border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <input
            ref={picker}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            hidden
            aria-label="Images to add"
            onChange={(e) => {
              add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="Add images"
            title="Add images (or paste or drop them)"
            onClick={() => picker.current?.click()}
          >
            <ImagePlus />
          </Button>
          <Button type="submit" variant="ghost" size="sm" disabled={!canSend}>
            Send
          </Button>
        </Row>
      </form>

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
