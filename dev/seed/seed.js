// Fill the dev (test) Supabase with made-up data to click around in.
// Run inside the omicron-dev test machine, through dev/seed/seed.sh (which
// wipes the database first).
//
// Everything goes in the way it would for real: people sign in through a
// real `omicron serve`, machines register and act with their keys, Claude
// sessions are added and report through the real hooks and commands (with
// sleeping processes standing in for Claude Code windows). So the data
// follows the same rules as the app.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const { startOmicron, need } = require("../../e2e/tests/omicron.js");

const BIN = need("OMICRON_BIN");
const SUPA = need("OMICRON_SUPABASE_URL");
const KEY = need("OMICRON_SUPABASE_KEY");
const SECRET = need("OMICRON_SUPABASE_SECRET_KEY");

// Times relative to now, so the data always looks recent.
const day = 24 * 3600 * 1000;
const date = (days) => new Date(Date.now() + days * day).toISOString().slice(0, 10);

async function api(token, method, p, data) {
  const res = await fetch(`${SUPA}${p}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** A person, signed in through the Web Machine with their Tailscale login. */
async function person(omicron, login, name) {
  const res = await fetch(`${omicron.url}/api/session`, {
    method: "POST",
    headers: { "tailscale-user-login": login, "tailscale-user-name": name },
  });
  const s = await res.json();
  if (!res.ok) throw new Error(`sign in ${login}: ${s.error}`);
  return { id: s.person_id, name, token: s.access_token, call: (m, p, d) => api(s.access_token, m, p, d) };
}

/** A registered machine with its own settings folder (no secret key). */
function machine(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `omicron-seed-${name}-`));
  const write = (c) => fs.writeFileSync(path.join(home, "config.json"), JSON.stringify(c));
  write({ supabase_url: SUPA, supabase_key: KEY, supabase_secret_key: SECRET });
  execFileSync(BIN, ["machines", "register", name], { env: { ...process.env, OMICRON_HOME: home } });
  const saved = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  write({ supabase_url: SUPA, supabase_key: KEY, machine_key: saved.machine_key });
  const env = { ...process.env, OMICRON_HOME: home };
  delete env.OMICRON_SUPABASE_SECRET_KEY;
  const run = (args, opts = {}) => execFileSync(BIN, args, { env: { ...env, ...(opts.env || {}) }, input: opts.input, encoding: "utf8" });
  return {
    name,
    home,
    run,
    /** A Claude Code window on this machine: a session in `project` called `session`. */
    window(project, session, folder) {
      const proc = spawn("sleep", ["86400"], { detached: true, stdio: "ignore" });
      proc.unref();
      const claude = crypto.randomUUID();
      const inWin = { OMICRON_CLAUDE_PID: String(proc.pid) };
      run(["hook", "session-start"], { env: inWin, input: JSON.stringify({ session_id: claude, cwd: folder, source: "startup" }) });
      run(["sessions", "add", session, "--project", project], { env: inWin });
      return {
        proc,
        cli: (...args) => run([...args, "--as-machine"], { env: inWin }),
        stop: () => run(["hook", "stop"], { env: inWin, input: JSON.stringify({ session_id: claude, stop_hook_active: false }) }),
        close: () =>
          run(["hook", "session-end"], { env: inWin, input: JSON.stringify({ session_id: claude, reason: "prompt_input_exit" }) }),
      };
    },
  };
}

/** Statuses and labels are names, or [name, color]. */
async function project(owner, name, statusList, labelList) {
  const split = (x) => (Array.isArray(x) ? x : [x, null]);
  const statuses = statusList.map((x) => split(x)[0]);
  const statusColors = Object.fromEntries(statusList.map(split));
  const labels = labelList.map((x) => split(x)[0]);
  const labelColors = Object.fromEntries(labelList.map(split));
  const p = await owner.call("POST", "/rest/v1/rpc/start_project", { name });
  // Replace the starting To do / Done with this Project's own list.
  const start = await owner.call("GET", `/rest/v1/statuses?project_id=eq.${p.id}&select=id,name,is_done`);
  const ids = {};
  for (const [i, s] of statuses.entries()) {
    const done = i === statuses.length - 1;
    const same = start.find((x) => x.name === s);
    if (same) {
      await owner.call("PATCH", `/rest/v1/statuses?id=eq.${same.id}`, { position: i });
      ids[s] = same.id;
    } else {
      const [row] = await owner.call("POST", "/rest/v1/statuses", { project_id: p.id, name: s, position: i, is_done: done });
      ids[s] = row.id;
    }
  }
  for (const s of start) if (!statuses.includes(s.name)) await owner.call("DELETE", `/rest/v1/statuses?id=eq.${s.id}`);
  for (const s of statuses) {
    if (statusColors[s]) await owner.call("PATCH", `/rest/v1/statuses?id=eq.${ids[s]}`, { color: statusColors[s] });
  }
  const labelIds = {};
  for (const l of labels) {
    labelIds[l] = (await owner.call("POST", "/rest/v1/labels", { project_id: p.id, name: l, color: labelColors[l] }))[0].id;
  }
  let position = 0;
  return {
    id: p.id,
    name,
    status: ids,
    async member(who) {
      await owner.call("POST", "/rest/v1/project_members", { project_id: p.id, person_id: who.id });
    },
    /** Add a task as `by`. Extra: notes, due (days from now), to (person), labels, checklist [[text, done]], comments [[person, text]]. */
    async task(by, status, title, extra = {}) {
      const [t] = await by.call("POST", "/rest/v1/tasks", {
        project_id: p.id,
        status_id: ids[status],
        title,
        notes: extra.notes ?? "",
        due_on: extra.due === undefined ? null : date(extra.due),
        assignee_person_id: extra.to?.id ?? null,
        position: position++,
      });
      for (const l of extra.labels ?? []) await by.call("POST", "/rest/v1/task_labels", { task_id: t.id, label_id: labelIds[l] });
      for (const [i, [text, done]] of (extra.checklist ?? []).entries()) {
        await by.call("POST", "/rest/v1/checklist_items", { task_id: t.id, text, done, position: i });
      }
      for (const [who, body] of extra.comments ?? []) await who.call("POST", "/rest/v1/comments", { task_id: t.id, body });
      return t;
    },
  };
}

(async () => {
  const omicron = await startOmicron();
  const windows = [];
  try {
    const joe = await person(omicron, "joeboylson@github", "Joe Boylson");
    const claire = await person(omicron, "claireboylson@gmail.com", "Claire Boylson");
    const sam = await person(omicron, "sam.rivera@example.com", "Sam Rivera");
    const nina = await person(omicron, "nina.okafor@example.com", "Nina Okafor");

    // ---- House and garden: Joe and Claire.
    const house = await project(joe, "House and garden", ["To do", ["Doing", "blue"], ["Waiting on someone", "orange"], "Done"], [
      ["outside", "green"],
      ["car", "blue"],
      ["kids", "pink"],
      ["bills", "red"],
      ["shopping", "purple"],
    ]);
    await house.member(claire);
    await house.task(joe, "To do", "Clean out the gutters", { due: 9, labels: ["outside"], notes: "Before the first big storm. Ladder is in the garage." });
    await house.task(claire, "To do", "Book the winter tyre swap", { to: joe, labels: ["car"], due: 5 });
    await house.task(claire, "To do", "Birthday present for Mia", {
      due: 21,
      labels: ["kids", "shopping"],
      notes: "She wants the big Lego set, or the art kit if that's sold out.",
      comments: [[joe, "The Lego one is on sale at the toy shop until Friday."]],
    });
    await house.task(joe, "To do", "Renew the parking permit", { due: -2, labels: ["car", "bills"], notes: "The old one ran out. Online form, needs the reg number." });
    await house.task(claire, "To do", "Pick a paint colour for the hallway", {
      checklist: [["Get three sample pots", false], ["Paint test squares", false], ["Decide", false]],
    });
    await house.task(joe, "Doing", "Fix the back gate", {
      to: joe,
      due: 1,
      labels: ["outside"],
      notes: "The latch is loose and the bottom hinge is bent. Hardware store has both.",
      checklist: [["Buy a new latch", true], ["Buy a hinge", true], ["Fit them", false]],
      comments: [[claire, "It blew open again last night."], [joe, "Parts bought, fitting it Saturday."]],
    });
    await house.task(claire, "Doing", "Sort the garage shelves", {
      to: claire,
      checklist: [["Paint cans", true], ["Tools", false], ["Bikes", false], ["Camping gear", false]],
    });
    await house.task(joe, "Waiting on someone", "Quote for the new fence", {
      labels: ["outside", "bills"],
      notes: "Asked two companies on Monday. Fencewright said this week.",
    });
    await house.task(claire, "Waiting on someone", "Plumber to look at the boiler", { due: 3, labels: ["bills"] });
    await house.task(joe, "Done", "Renew the car insurance", { labels: ["car", "bills"] });
    await house.task(claire, "Done", "Pick up the dry cleaning");
    await house.task(joe, "Done", "Book Mia's dentist check-up", { labels: ["kids"] });

    // ---- Groceries: quick list.
    const groceries = await project(claire, "Groceries", ["To buy", ["In the basket", "blue"], "Done"], [
      ["fresh", "green"],
      ["pantry", "brown"],
      ["household", "teal"],
    ]);
    await groceries.member(joe);
    for (const [s, t, l] of [
      ["To buy", "Milk", "fresh"],
      ["To buy", "Eggs", "fresh"],
      ["To buy", "Sourdough", "fresh"],
      ["To buy", "Coffee beans", "pantry"],
      ["To buy", "Dishwasher tablets", "household"],
      ["To buy", "Bananas", "fresh"],
      ["In the basket", "Rice", "pantry"],
      ["In the basket", "Olive oil", "pantry"],
      ["Done", "Bin bags", "household"],
      ["Done", "Tomatoes", "fresh"],
    ]) {
      await groceries.task(t === "Coffee beans" ? joe : claire, s, t, { labels: [l] });
    }

    // ---- Lisbon trip: three people, chat on.
    const trip = await project(joe, "Lisbon trip", [["To book", "orange"], ["Booked", "blue"], ["Packed", "purple"], "Done"], [
      ["travel", "teal"],
      ["money", "yellow"],
      ["food", "red"],
    ]);
    await trip.member(claire);
    await trip.member(sam);
    await trip.task(joe, "To book", "Airport transfer", { due: 30, labels: ["travel"], to: sam });
    await trip.task(claire, "To book", "Dinner at Taberna da Rua", { due: 40, labels: ["food"], notes: "Saturday, 4 people, 8pm." });
    await trip.task(sam, "To book", "Day trip to Sintra", {
      labels: ["travel"],
      checklist: [["Train times", true], ["Palace tickets", false], ["Lunch spot", false]],
      comments: [[claire, "Pena Palace sells out, book a week ahead."]],
    });
    await trip.task(joe, "Booked", "Flights", { labels: ["travel", "money"], notes: "Confirmation in the shared folder." });
    await trip.task(claire, "Booked", "Apartment in Alfama", { labels: ["money"] });
    await trip.task(sam, "Packed", "Adapters and chargers", { to: sam });
    await trip.task(joe, "Done", "Ask for time off", {});
    await joe.call("PATCH", `/rest/v1/projects?id=eq.${trip.id}`, { chat_enabled: true });
    for (const [who, body] of [
      [claire, "Found a great tile workshop near the apartment, worth an afternoon?"],
      [sam, "Yes! Thursday works for me."],
      [joe, "Booked flights, landing 10:40. Sam, can you sort the transfer?"],
      [sam, "On it this week."],
    ]) {
      await who.call("POST", "/rest/v1/chat_messages", { project_id: trip.id, body });
    }

    // ---- Wedding photos: Joe and Nina.
    const photos = await project(joe, "Wedding photos", ["To sort", ["Editing", "indigo"], ["Sent", "purple"], "Done"], [
      ["album", "pink"],
      ["prints", "brown"],
    ]);
    await photos.member(nina);
    await photos.task(nina, "To sort", "Pick the 40 for the album", { labels: ["album"], to: joe, due: 14 });
    await photos.task(joe, "Editing", "Colour-correct the ceremony set", { to: nina, checklist: [["Indoor", true], ["Outdoor", false]] });
    await photos.task(nina, "Sent", "Prints for the grandparents", { labels: ["prints"] });
    await photos.task(joe, "Done", "Back up every card", {});

    // ---- Omicron: Joe, plus Claude sessions on two machines.
    const code = await project(joe, "Omicron", ["Backlog", ["To do", "teal"], ["Doing", "blue"], ["Review", "orange"], "Done"], [
      ["web", "blue"],
      ["cli", "purple"],
      ["database", "teal"],
      ["bug", "red"],
      ["docs", "brown"],
    ]);
    const mini = machine("mac-mini");
    const studio = machine("studio");
    const build = machine("build-box");
    for (const m of [mini, studio, build]) {
      const [row] = await joe.call("GET", `/rest/v1/machines?name=eq.${m.name}&select=id`);
      await joe.call("POST", "/rest/v1/project_machines", { project_id: code.id, machine_id: row.id });
    }

    await code.task(joe, "Backlog", "Drag tasks between statuses", { labels: ["web"] });
    await code.task(joe, "Backlog", "Label colours", { labels: ["web"] });
    await code.task(joe, "Backlog", "Teams (rewrite of legion)", { labels: ["cli"], notes: "Section 7 of TODO.md." });
    await code.task(joe, "To do", "omicron accounts (rewrite of janus)", { labels: ["cli"], due: 6 });
    await code.task(joe, "To do", "Fade closed sessions a bit more", { labels: ["web"] });
    await code.task(joe, "To do", "Write the setup guide", { labels: ["docs"], due: 12 });
    const parserTask = await code.task(joe, "Doing", "Parse the change list into events", {
      labels: ["database"],
      checklist: [["Inserts", true], ["Updates", true], ["Deletes", false], ["Late saves", false]],
    });
    const stripTask = await code.task(joe, "Review", "Sessions strip on the web page", { labels: ["web"] });
    await code.task(joe, "Review", "Handoff notes sheet", { labels: ["web"] });
    await code.task(joe, "Done", "Chat per Project", { labels: ["web", "database"] });
    await code.task(joe, "Done", "Comments on tasks", { labels: ["web", "database"] });
    await code.task(joe, "Done", "Fix checklist tick flicker", { labels: ["bug", "web"] });

    // Sessions: two open, one closed, one that stopped without saying.
    const webPage = mini.window("Omicron", "web-page", "/Users/joe/omicron/web");
    const parser = studio.window("Omicron", "parser", "/Users/joe/omicron");
    const docs = build.window("Omicron", "docs", "/home/joe/omicron/docs");
    const old = mini.window("Omicron", "handoff", "/Users/joe/omicron");
    windows.push(webPage, parser, docs, old);

    // Tasks sent to sessions: the strip one picked up and reported, the
    // parser one picked up, one still waiting.
    const sendTo = async (t, s) => {
      const [row] = await joe.call("GET", `/rest/v1/sessions?project_id=eq.${code.id}&name=eq.${s}&select=id`);
      await joe.call("PATCH", `/rest/v1/tasks?id=eq.${t.id}`, { assignee_session_id: row.id });
    };
    await sendTo(stripTask, "web-page");
    webPage.stop();
    webPage.cli("tasks", "comment", "Omicron", String(stripTask.number), "Done: open sessions first, closed ones faded, tap one for its handoff notes. Screenshots are in the PR.", "--review");
    await sendTo(parserTask, "parser");
    parser.stop();
    parser.cli("tasks", "comment", "Omicron", String(parserTask.number), "Inserts and updates work and are tested. Deletes next.");
    const docsTask = await code.task(joe, "To do", "Document the hooks", { labels: ["docs"] });
    await sendTo(docsTask, "docs");
    await joe.call("POST", "/rest/v1/comments", { task_id: stripTask.id, body: "Looks good. Can closed ones fade a bit more?" });

    // Handoff notes.
    webPage.cli("handoff", "write", "Started the sessions strip. Chips are done; tapping one should open its notes. Next: the sheet.");
    webPage.cli(
      "handoff",
      "write",
      "# Sessions strip\n\nDone: strip and notes sheet, tested on desktop and phone.\nNot done: fade closed sessions more (Joe asked).\nCheck first: git status, dev/e2e.sh passes.",
    );
    parser.cli("handoff", "write", "# Change list parser\n\nInserts and updates done. Deletes next, then late saves.\nCheck first: cargo test --test daemon.");
    old.cli("handoff", "write", "Wrote the first version of handoff notes. Nothing left open.");
    old.close();

    // Chat.
    await joe.call("PATCH", `/rest/v1/projects?id=eq.${code.id}`, { chat_enabled: true });
    await joe.call("POST", "/rest/v1/chat_messages", { project_id: code.id, body: "Morning. @web-page how's the sessions strip going?" });
    webPage.cli("chat", "send", "Omicron", "Chips are done and open their handoff notes. Screenshots next.");
    await joe.call("POST", "/rest/v1/chat_messages", { project_id: code.id, body: "Great. @parser how far are you?" });
    parser.cli("chat", "send", "Omicron", "Inserts and updates done; starting deletes.");
    await joe.call("POST", "/rest/v1/chat_messages", { project_id: code.id, body: "Thanks both." });

    // A Needs review mark from a session without a comment, too.
    webPage.cli("tasks", "needs-review", "Omicron", "9");

    // The docs window dies without closing: its session shows as stopped
    // once anything on build-box notices.
    docs.proc.kill();
    await new Promise((r) => setTimeout(r, 200));
    const other = spawn("sleep", ["5"]);
    build.run(["hook", "session-start"], {
      env: { OMICRON_CLAUDE_PID: String(other.pid) },
      input: JSON.stringify({ session_id: crypto.randomUUID(), cwd: "/tmp", source: "startup" }),
    });
    other.kill();
  } finally {
    // Leave web-page and parser "open"; stop the stand-in processes.
    for (const w of windows) {
      try {
        w.proc.kill();
      } catch {}
    }
    omicron.stop();
  }
  console.log("Seeded: 4 people, 5 Projects, 3 machines, 4 Claude sessions, tasks, comments, handoff notes and chat.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
