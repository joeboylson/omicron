import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { loadChat, sendChat, type ChatMessage, type ProjectData } from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The Project's chat, in a sheet. Live while it's open. */
export function Chat({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92dvh] flex-col gap-4 bg-muted sm:max-h-[80dvh] sm:bg-background"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-left">
          <DialogTitle>Chat</DialogTitle>
          <DialogDescription>
            Everyone in {project.name}, and its Claude sessions. Name a session (<span className="font-mono">@parser</span>) and
            it's told at the end of its next turn.
          </DialogDescription>
        </DialogHeader>
        {open && <Messages project={project} />}
      </DialogContent>
    </Dialog>
  );
}

function Messages({ project }: { project: ProjectData }) {
  const { db, act, me } = useApp();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    act(async () => setMessages(await loadChat(db, project.id)));
  }, [db, act, project.id]);
  useEffect(reload, [reload]);
  useChanges(db, project.id, reload);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (body && (await act(() => sendChat(db, project.id, body)))) {
      setText("");
      reload();
    }
  };

  return (
    <>
      <div className="min-h-40 flex-1 overflow-y-auto rounded-xl border bg-card">
        {messages === null ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <ul aria-label="Messages" className="grid gap-3 p-4">
            {messages.map((m) => {
              const mine = !m.session && m.author === me.displayName;
              return (
                <li key={m.id} className={cn("grid max-w-[85%] gap-1", mine && "justify-self-end text-right")}>
                  <div className={cn("flex items-baseline gap-2 text-xs text-muted-foreground", mine && "justify-end")}>
                    <span className="font-medium text-foreground">{m.author}</span>
                    {m.session && (
                      <span className="flex items-center gap-1">
                        <Terminal className="h-3 w-3" aria-hidden />
                        <span className="font-mono">{m.session}</span>
                      </span>
                    )}
                    <time className="font-mono" dateTime={m.created_at}>
                      {new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </time>
                  </div>
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-[15px] sm:text-sm",
                      mine ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    {m.body}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
          rows={1}
          placeholder="Message"
          aria-label="New message"
          className="min-h-11 resize-none rounded-2xl bg-card sm:min-h-10"
        />
        <Button type="submit" disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </>
  );
}
