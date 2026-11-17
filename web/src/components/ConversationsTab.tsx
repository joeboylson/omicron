// Conversations (#281): a Project's group chats with its Claude sessions.
// The list, newest activity first; inside one, its sessions, the thread
// and the message box, pinned tasks down the side (a sheet on a phone),
// and its Rules.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, MoreHorizontal, Pin, Plus, ScrollText, Terminal, X } from "lucide-react";
import { useAddressValue, useApp } from "@/lib/app";
import { loadDraft, saveDraft } from "@/lib/drafts";
import type { Dev } from "@/lib/dev";
import { must } from "@/lib/omicron";
import {
  deleteConversation,
  imageLinks,
  imageName,
  loadMessages,
  markConversationRead,
  pinTask,
  postMessage,
  renameConversation,
  sayEvery,
  startConversation,
  unpinTask,
  type Conversation,
  type Message,
  type ProjectData,
} from "@/lib/data";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { Composer, type Suggestion } from "@/components/Composer";
import { ImageViewer } from "@/components/ImageViewer";
import { Markdown } from "@/components/Markdown";
import { WatchDialog, stopWatching, watchers } from "@/components/WatchDialog";
import { BoardRulesSection } from "@/components/settings/BoardRules";
import { Group, Row } from "@/components/Grouped";
import { when } from "@/components/task/when";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Confirm } from "@/components/base/confirm";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/base/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { linkMentions } from "@/lib/mentions";

// Links last an hour; kept for the page's life so images don't flicker.
const links = new Map<string, string>();

export function ConversationsTab({
  project,
  dev,
  onChanged,
  onOpenTask,
  onEditLoops,
}: {
  project: ProjectData;
  dev: Dev | null;
  onChanged: () => void;
  onOpenTask: (n: number) => void;
  onEditLoops: () => void;
}) {
  const { db, act } = useApp();
  const [openId, setOpenId] = useAddressValue("c");
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);
  const open = project.conversations.find((c) => c.id === openId) ?? null;
  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  const sessionsIn = (c: Conversation) => watchers(project, { conversationId: c.id }).map((w) => w.session.name);

  const saveName = () =>
    naming &&
    change(async () => {
      if (naming.id) await renameConversation(db, naming.id, naming.name);
      else setOpenId(await startConversation(db, project.id, naming.name), true);
      setNaming(null);
    });

  const nameDialog = (
    <Dialog open={naming !== null} onOpenChange={(o) => !o && setNaming(null)}>
      <DialogContent className="sm:max-w-sm" onOpenAutoFocus={focusSheet}>
        <DialogHeader className="text-left">
          <DialogTitle>{naming?.id ? "Rename Conversation" : "New Conversation"}</DialogTitle>
          <DialogDescription className="sr-only">Its name.</DialogDescription>
        </DialogHeader>
        <form
          id="conversation-name"
          onSubmit={(e) => {
            e.preventDefault();
            saveName();
          }}
        >
          <Input aria-label="Name" placeholder="Name" value={naming?.name ?? ""} onChange={(e) => setNaming((n) => n && { ...n, name: e.target.value })} autoFocus />
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => setNaming(null)}>
            Cancel
          </Button>
          <Button type="submit" form="conversation-name" disabled={!naming?.name.trim()}>
            {naming?.id ? "Rename" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (open) {
    return (
      <>
        <ConversationView
          key={open.id}
          project={project}
          dev={dev}
          conversation={open}
          onBack={() => setOpenId(null)}
          onChanged={onChanged}
          onOpenTask={onOpenTask}
          onEditLoops={onEditLoops}
          onRename={() => setNaming({ id: open.id, name: open.name })}
        />
        {nameDialog}
      </>
    );
  }

  const columns: ColumnDef<Conversation, any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column} label="Name" />,
      cell: ({ row }) => (
        <button type="button" className="inline-flex min-h-8 items-center gap-2 text-left font-medium hover:underline" onClick={() => setOpenId(row.original.id, true)}>
          {row.original.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--sys-indigo)]" aria-label="Unread" role="img" />}
          {row.original.name}
        </button>
      ),
      meta: { phone: "main" },
    },
    {
      id: "sessions",
      header: "Sessions",
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{sessionsIn(row.original).join(", ")}</span>,
      meta: { className: "hidden sm:table-cell", phone: "below" },
    },
    {
      id: "when",
      accessorFn: (c) => c.last_message_at ?? c.created_at,
      header: ({ column }) => <SortHeader column={column} label="Last Message" />,
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">{row.original.last_message_at ? when(row.original.last_message_at) : ""}</span>
      ),
      meta: { className: "w-0 whitespace-nowrap text-right", phone: "end" },
    },
  ];

  return (
    <section aria-label="Conversations" className="mx-auto grid w-full max-w-4xl content-start gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-4">
      <div className="flex items-center gap-2">
        <Button size="sm" className="ml-auto gap-1" onClick={() => setNaming({ name: "" })}>
          <Plus className="h-4 w-4" aria-hidden /> New Conversation
        </Button>
      </div>
      <DataTable
        label="Conversations"
        columns={columns}
        data={project.conversations}
        initialSort={[]}
        rowLabel={(c) => c.name}
        onRowTap={(c) => setOpenId(c.id, true)}
        search={{ label: "Search conversations", placeholder: "Search Conversations", text: (c) => c.name }}
        empty={<p className="py-6 text-center text-sm text-muted-foreground">No conversations yet.</p>}
      />
      {nameDialog}
    </section>
  );
}

function ConversationView({
  project,
  dev,
  conversation,
  onBack,
  onChanged,
  onOpenTask,
  onEditLoops,
  onRename,
}: {
  project: ProjectData;
  dev: Dev | null;
  conversation: Conversation;
  onBack: () => void;
  onChanged: () => void;
  onOpenTask: (n: number) => void;
  onEditLoops: () => void;
  onRename: () => void;
}) {
  const { db, act } = useApp();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setTextNow] = useState(() => loadDraft(`c:${conversation.id}`));
  const setText = (t: string) => {
    setTextNow(t);
    saveDraft(`c:${conversation.id}`, t);
  };
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  // The side panel's picker, and the one in the phone's sheet.
  const [picking, setPicking] = useState(false);
  const [pickingHere, setPickingHere] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<{ images: string[]; at: number } | null>(null);
  const [, setLinksVersion] = useState(0);
  const thread = useRef<HTMLDivElement>(null);
  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };

  // The messages: again whenever the conversation has a new one.
  useEffect(() => {
    let gone = false;
    act(async () => {
      const m = await loadMessages(db, conversation.id);
      if (!gone) setMessages(m);
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, conversation.id, conversation.last_message_at]);
  // The newest at the bottom, in view.
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);
  // Links for the images shown.
  const missing = (messages ?? []).flatMap((m) => m.images).filter((p) => !links.has(p));
  useEffect(() => {
    if (missing.length === 0) return;
    act(async () => {
      for (const [p, url] of Object.entries(await imageLinks(db, missing))) links.set(p, url);
      setLinksVersion((v) => v + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.join("|")]);

  const people = watchers(project, { conversationId: conversation.id });
  const pinned = conversation.task_ids.map((id) => project.tasks.find((t) => t.id === id)).filter((t) => t !== undefined);
  const numbers = project.tasks.map((t) => t.number);
  const sessionNames = project.sessions.map((s) => s.name);
  const suggest = (kind: "@" | "#", q: string): Suggestion[] => {
    const query = q.toLowerCase();
    if (kind === "@") {
      // The conversation's own sessions first.
      const mine = new Set(people.map((p) => p.session.name));
      return [...project.sessions]
        .sort((a, b) => Number(mine.has(b.name)) - Number(mine.has(a.name)))
        .filter((s) => s.name.toLowerCase().startsWith(query))
        .map((s) => ({ insert: `@${s.name}`, label: `@${s.name}` }));
    }
    return project.tasks
      .filter((t) => String(t.number).startsWith(query) || (query !== "" && t.title.toLowerCase().includes(query)))
      .sort((a, b) => Number(conversation.task_ids.includes(b.id)) - Number(conversation.task_ids.includes(a.id)) || b.number - a.number)
      .map((t) => ({ insert: `#${t.number}`, label: `#${t.number} ${t.title}` }));
  };

  // In the phone's sheet the picker opens in place: a popover outside the
  // sheet would be hidden from screen readers by it (#283).
  const pinnedList = (inSheet: boolean) => (
    <ul aria-label="Pinned tasks" className="grid min-w-0 gap-1">
      {pinned.length === 0 && <li className="px-1 py-2 text-sm text-muted-foreground">No pinned tasks.</li>}
      {pinned.map((t) => (
        <li key={t.id} className="group flex items-center gap-1 rounded-md hover:bg-accent">
          <button
            type="button"
            className="grid min-h-11 min-w-0 flex-1 px-2 py-1 text-left text-sm sm:min-h-9"
            onClick={() => (setPinsOpen(false), onOpenTask(t.number))}
          >
            <span className="truncate">
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">#{t.number}</span> {t.title}
            </span>
            <span className="text-xs text-muted-foreground">{project.statuses.find((s) => s.id === t.status_id)?.name}</span>
          </button>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label={`Unpin #${t.number}`} onClick={() => change(() => unpinTask(db, conversation.id, t.id))}>
            <X />
          </Button>
        </li>
      ))}
      <li className="min-w-0">
        {inSheet ? (
          <>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-1 text-link" aria-expanded={pickingHere} onClick={() => setPickingHere(!pickingHere)}>
              <Plus className="h-4 w-4" aria-hidden /> Add Task
            </Button>
            {pickingHere && (
              <div className="mt-1 min-w-0 overflow-hidden rounded-md border">
            <Command>
              <CommandInput placeholder="Search" aria-label="Search tasks" />
              <CommandList>
                <CommandEmpty>No tasks.</CommandEmpty>
                <CommandGroup>
                  {project.tasks
                    .filter((t) => !conversation.task_ids.includes(t.id))
                    .map((t) => (
                      <CommandItem key={t.id} value={`#${t.number} ${t.title}`} onSelect={() => (setPicking(false), setPickingHere(false), change(() => pinTask(db, conversation.id, t.id)))}>
                        <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">#{t.number}</span>
                        <span className="min-w-0 truncate">{t.title}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
              </div>
            )}
          </>
        ) : (
        <Popover modal open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-1 text-link">
              <Plus className="h-4 w-4" aria-hidden /> Add Task
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search" aria-label="Search tasks" />
              <CommandList>
                <CommandEmpty>No tasks.</CommandEmpty>
                <CommandGroup>
                  {project.tasks
                    .filter((t) => !conversation.task_ids.includes(t.id))
                    .map((t) => (
                      <CommandItem key={t.id} value={`#${t.number} ${t.title}`} onSelect={() => (setPicking(false), setPickingHere(false), change(() => pinTask(db, conversation.id, t.id)))}>
                        <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">#{t.number}</span>
                        <span className="min-w-0 truncate">{t.title}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        )}
      </li>
    </ul>
  );

  return (
    <section aria-label={conversation.name} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-[max(0.5rem,env(safe-area-inset-left))] pb-2">
        <Button variant="ghost" size="sm" className="gap-0 px-1 text-link" onClick={onBack} aria-label="Back to Conversations">
          <ChevronLeft className="h-5 w-5" aria-hidden />
          <span className="max-sm:sr-only">Conversations</span>
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{conversation.name}</h2>
        {/* On a phone, its actions on a line of their own under the name. */}
        <div className="flex items-center gap-1 max-sm:w-full max-sm:justify-end">
        {conversation.unread && (
          <Button variant="outline" size="sm" onClick={() => change(() => markConversationRead(db, conversation.id))}>
            Mark as Read
          </Button>
        )}
        <Button variant="ghost" size="sm" className="gap-1 lg:hidden" onClick={() => setPinsOpen(true)}>
          <Pin className="h-4 w-4" aria-hidden /> {pinned.length} {pinned.length === 1 ? "task" : "tasks"}
        </Button>
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setRules(true)}>
          <ScrollText className="h-4 w-4" aria-hidden /> Rules
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <ul aria-label="Sessions in it" className="flex flex-wrap items-center gap-2 border-b px-[max(1rem,env(safe-area-inset-left))] py-2 text-sm">
        {people.map((w) => (
          <li key={w.session.id} className="flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-0.5">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-medium">{w.session.name}</span>
            <span className="text-muted-foreground">· {w.loop.asap ? "as soon as it's done" : `every ${sayEvery(w.loop.every_seconds)}`}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-muted-foreground"
              aria-label={`Take ${w.session.name} out`}
              onClick={() => act(() => stopWatching(db, project, dev, w)).then(() => onChanged())}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        <li>
          <Button variant="ghost" size="sm" className="gap-1 text-link" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add Session
          </Button>
        </li>
      </ul>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={thread}
            className="min-h-0 flex-1 overflow-y-auto"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a[href^="#task-"]');
              if (!a) return;
              e.preventDefault();
              onOpenTask(Number(a.getAttribute("href")!.slice(6)));
            }}
          >
            {messages !== null && messages.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No messages yet.</p>}
            <ol aria-label="Messages" className="mx-auto grid max-w-3xl gap-1 px-[max(1rem,env(safe-area-inset-left))] py-3">
              {(messages ?? []).map((m) => (
                <li key={m.id} className="grid gap-1 rounded-lg px-3 py-2 text-[0.9375rem] hover:bg-accent/40 sm:text-sm">
                  <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    {m.session ? (
                      <span className="flex items-center gap-1" data-testid="message-author">
                        <Terminal className="h-3 w-3 self-center" aria-hidden />
                        <span className="font-medium text-foreground">{m.session}</span>
                        <span>on {m.author}</span>
                      </span>
                    ) : (
                      <span className="font-medium text-foreground" data-testid="message-author">
                        {m.author}
                      </span>
                    )}
                    <time className="ml-auto tabular-nums" dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()}>
                      {when(m.created_at)}
                    </time>
                  </div>
                  {m.body && <Markdown text={linkMentions(m.body, numbers, sessionNames)} />}
                  {m.images.length > 0 && (
                    <ul aria-label="Images" className="mt-1 flex flex-wrap gap-2">
                      {m.images.map((path, i) => (
                        <li key={path}>
                          <button
                            type="button"
                            onClick={() => setViewing({ images: m.images, at: i })}
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
            </ol>
          </div>
          <div className="mx-auto w-full max-w-3xl border-t px-[max(0.5rem,env(safe-area-inset-left))]">
            <Composer
              projectId={project.id}
              value={text}
              onChange={setText}
              onSend={(body, images, clear) =>
                change(async () => {
                  await postMessage(db, conversation.id, body, images);
                  clear();
                })
              }
              placeholder="Message"
              label="New message"
              noun="message"
              suggest={suggest}
            />
          </div>
        </div>
        <aside aria-label="Pinned" className="hidden w-72 shrink-0 overflow-y-auto border-l p-2 lg:block">
          <h3 className="px-2 py-1 text-sm font-semibold">Pinned Tasks</h3>
          {pinnedList(false)}
        </aside>
      </div>

      <Dialog open={pinsOpen} onOpenChange={setPinsOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md" onOpenAutoFocus={focusSheet}>
          <DialogHeader className="text-left">
            <DialogTitle>Pinned Tasks</DialogTitle>
            <DialogDescription className="sr-only">Tasks pinned to {conversation.name}.</DialogDescription>
          </DialogHeader>
          {pinnedList(true)}
        </DialogContent>
      </Dialog>

      <RulesSheet project={project} conversation={conversation} open={rules} onOpenChange={setRules} change={change} onEditLoops={onEditLoops} />

      <WatchDialog project={project} dev={dev} target={adding ? { conversationId: conversation.id } : null} onClose={() => setAdding(false)} onChanged={onChanged} />

      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete "${conversation.name}"?`}
        sentence="Its messages are deleted too, and its sessions stop checking it."
        action="Delete Conversation"
        onConfirm={() => change(async () => {
          await deleteConversation(db, conversation.id);
          onBack();
        })}
      />

      <ImageViewer
        images={viewing?.images ?? []}
        at={viewing?.at ?? null}
        link={(p) => links.get(p)}
        name={imageName}
        onAt={(at) => setViewing((v) => (v ? { ...v, at } : v))}
        onClose={() => setViewing(null)}
      />
    </section>
  );
}

/** Rules: the board rules (the whole Project's), then each session's
 *  instructions for this conversation, its loop message and timer. */
function RulesSheet({
  project,
  conversation,
  open,
  onOpenChange,
  change,
  onEditLoops,
}: {
  project: ProjectData;
  conversation: Conversation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  change: (work: () => Promise<unknown>) => Promise<void>;
  onEditLoops: () => void;
}) {
  const { db } = useApp();
  const people = watchers(project, { conversationId: conversation.id });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-4 overflow-y-auto sm:max-w-lg" onOpenAutoFocus={focusSheet}>
        <DialogHeader className="text-left">
          <DialogTitle>Rules</DialogTitle>
          <DialogDescription className="sr-only">The board rules and each session's instructions here.</DialogDescription>
        </DialogHeader>
        <BoardRulesSection project={project} change={change} />
        {people.map((w) => {
          const watch = w.loop.watches![w.index];
          return (
            <Group key={w.session.id} title={w.session.name}>
              <Row className="py-2">
                <Instructions
                  label={`${w.session.name}'s instructions`}
                  value={watch.instructions}
                  onSave={(text) => change(async () => must(await db.from("loop_watches").update({ instructions: text }).eq("id", watch.id)))}
                />
              </Row>
              <Row className="justify-between py-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">
                  {w.loop.prompt ? `"${w.loop.prompt}" · ` : ""}
                  {w.loop.asap ? "As soon as it's done" : `Every ${sayEvery(w.loop.every_seconds)}`}
                </span>
                <Button variant="ghost" size="sm" className="shrink-0 text-link" onClick={() => (onOpenChange(false), onEditLoops())}>
                  Edit Loop…
                </Button>
              </Row>
            </Group>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}

function Instructions({ label, value, onSave }: { label: string; value: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Textarea
      aria-label={label}
      placeholder="Instructions"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value.trim() && onSave(text.trim())}
      rows={2}
      className={cn("min-h-16 resize-y border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0")}
    />
  );
}
