// Writing a comment or a message: text, and images added by pasting,
// dropping or picking files, uploaded right away (so Send is quick). In a
// conversation, @ suggests sessions and # suggests tasks (#281).

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { imageProblem, randomId, IMAGE_TYPES, IMAGES_PER_COMMENT, uploadImage } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Textarea } from "@/components/ui/textarea";
import { Row } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { typing } from "@/lib/mentions";

/** An image being added. */
type Pending = { key: string; name: string; preview: string; path?: string; error?: string };

/** A suggestion for what's being typed after @ or #: what goes in, and what it shows. */
export type Suggestion = { insert: string; label: string };


export function Composer({
  projectId,
  value,
  onChange,
  onSend,
  placeholder,
  label,
  noun = "comment",
  suggest,
  className,
}: {
  projectId: string;
  value: string;
  onChange: (text: string) => void;
  /** Send it; call `clear` once it's saved. */
  onSend: (body: string, images: string[], clear: () => void) => unknown;
  placeholder: string;
  label: string;
  /** "comment" or "message", for the limit's wording. */
  noun?: string;
  suggest?: (kind: "@" | "#", query: string) => Suggestion[];
  className?: string;
}) {
  const { db } = useApp();
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Previews are only needed while it's being written.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Suggestions for an @ or # being typed.
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const word = suggest ? typing(value, caret) : null;
  const options = word && dismissed !== `${word.start}:${word.kind}` ? suggest!(word.kind, word.query).slice(0, 6) : [];
  useEffect(() => setPicked(0), [word?.kind, word?.query]);

  function choose(s: Suggestion) {
    if (!word) return;
    const next = value.slice(0, word.start) + s.insert + " " + value.slice(caret);
    onChange(next);
    const at = word.start + s.insert.length + 1;
    setCaret(at);
    requestAnimationFrame(() => box.current?.setSelectionRange(at, at));
  }

  function add(files: File[]) {
    const room = IMAGES_PER_COMMENT - pending.length;
    for (const [i, file] of files.entries()) {
      const key = randomId();
      const name = file.name || "Pasted image";
      if (i >= room) {
        setPending((p) => [...p, { key, name, preview: "", error: `A ${noun} can have at most ${IMAGES_PER_COMMENT} images.` }]);
        continue;
      }
      const problem = imageProblem(file);
      const preview = problem ? "" : URL.createObjectURL(file);
      if (preview) previews.current.push(preview);
      setPending((p) => [...p, { key, name, preview, error: problem ?? undefined }]);
      if (problem) continue;
      uploadImage(db, projectId, file).then(
        (path) => setPending((p) => p.map((x) => (x.key === key ? { ...x, path } : x))),
        (e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, error: `Couldn't add ${name}: ${e.message}` } : x))),
      );
    }
  }

  const uploading = pending.some((p) => !p.path && !p.error);
  const ready = pending.filter((p) => p.path).map((p) => p.path!);
  const canSend = !uploading && (value.trim() !== "" || ready.length > 0);

  function send() {
    if (!canSend) return;
    onSend(value.trim(), ready, () => {
      onChange("");
      setPending([]);
    });
  }

  return (
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
      className={cn("relative transition-colors", dragging && "bg-[color-mix(in_srgb,var(--sys-blue)_10%,transparent)]", className)}
    >
      {options.length > 0 && (
        <ul
          id="composer-suggestions"
          role="listbox"
          aria-label={word!.kind === "@" ? "Sessions" : "Tasks"}
          className="absolute inset-x-2 bottom-full z-10 mb-1 overflow-hidden rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {options.map((s, i) => (
            <li
              key={s.insert}
              id={`composer-suggestion-${i}`}
              role="option"
              aria-selected={i === picked}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              className={cn("flex min-h-11 cursor-default items-center truncate rounded-md px-2 sm:min-h-8", i === picked && "bg-accent")}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
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
          ref={box}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart);
            setDismissed(null);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              add(files);
            }
          }}
          onKeyDown={(e) => {
            if (options.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPicked((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(options[picked]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(`${word!.start}:${word!.kind}`);
                return;
              }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
          placeholder={dragging ? "Drop images to add them" : placeholder}
          aria-label={label}
          aria-autocomplete={suggest ? "list" : undefined}
          aria-controls={options.length > 0 ? "composer-suggestions" : undefined}
          aria-activedescendant={options.length > 0 ? `composer-suggestion-${picked}` : undefined}
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
  );
}
