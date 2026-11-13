# Omicron brainstorm

## The link to a Claude session should be right there (13 Nov 2026)
Problem: connecting this chat to Omicron meant quitting it and running `omicron open --resume <long id>` by hand. Too many steps to remember. The link should be right there, no thinking needed. Ideas, not decided:
- **Link in place.** A command run inside the chat (`! omicron link`, or a `/omicron` slash command) that makes the chat an Omicron session without quitting it. Omicron's hooks already know the chat's id.
- **Every chat is linked to start with.** When Claude starts in a Project's folder, a start-up hook links it on its own. Nothing to do at all.
- **`claude` just means `omicron open`.** A shell shortcut, so the usual way of starting Claude goes through Omicron.
- **Always visible.** The status line under the chat shows the session's name and whether it's linked, so it's never a question.
- **Spot the strays.** `omicron doctor` and the Sessions page list Claude chats on this machine that aren't linked yet, each with a one-step way to link it.

## Security risk: the web page can make a computer run things (13 Nov 2026)
- The web page can type messages into running Claude sessions (`omicron sessions send`, from any machine).
- A message to Claude is basically a command on that computer: Claude can run anything in its folder, and sessions Omicron starts don't stop to ask.
- Today that's only safe because the page is behind Joe's Tailscale login and the home lab's gate.
- If the page is ever hosted publicly (like Vercel), anyone who signs in, or gets past the database's access rules, could make a computer run things.
- Rule from Joe: the web page never starts a session, types into one, or shows its screen. Only the Tauri app can, on the computer it runs on. No remote session control. (Later exceptions, both in "The gate": a computer whose gate is open, and Joe on the serving computer's own page.)

## Two parts: safe and machine-only (13 Nov 2026)
The test for any feature: if it can make a computer do something, it's **machine-only**. If it only reads or changes shared records, it's **safe**.
- **Safe (the web page):** tasks, Projects, people, and seeing sessions, folders, and team jobs and their status. Fine to host anywhere, even publicly.
- **Machine-only (a Tauri desktop app):** starting and showing sessions, folders, the terminal, accounts, and starting teams and their workers. It only acts on the computer it runs on.
- The desktop app can show the safe pages too, so the web page is really the safe part of it.
- **Desktop app ideas:** tabs of sessions, each with a simple terminal (like v2-mercury: xterm.js on the page, a shell behind it), and a list of sessions with "open a new session". Omicron keeps track of past sessions too, not only Claude.
- **Folders:** a Folder is one path, on one machine, for one Project. "Open a new session" starts Claude in one. It's added from the computer it's on: "Add folder" in the desktop app (the computer's own folder picker), or `omicron folders add` in the folder. Maybe `omicron open` remembers the folder it runs in.

## Two views of a Project: Tasks and Dev (13 Nov 2026)
- **Tasks view:** the board as it is today. On the web page and in the desktop app.
- **Dev view:** desktop app only; the web page doesn't even show the switch (one exception: Joe on the serving computer's own page, see "The gate").
  - Left: the Project's folders and its sessions (running and past), with "open a new session".
  - Middle: the sessions as tabs, each a terminal.
  - Right: the board turned into a list, grouped by column, to refer to while working.
- Drag a task from the list onto a session to hand that task to it.

## Session buttons in the desktop app (13 Nov 2026)
Each is a button that does what the `omicron` commands do today.
- **Open:** pick a folder, Claude starts there in a new tab.
- **Close a tab:** only lets go (like Ctrl-\). Claude keeps running and the session stays in the list.
- **End:** quits Claude, which ends the session.
- **Hand off:** one session carries on after clearing, with an empty memory but knowing where it was:
  1. The app asks the session to write its handoff note.
  2. It waits until the note is saved (it sees the change come in).
  3. It sends `/clear`.
  4. The fresh chat, in the same tab and the same session, starts with the note (the start-up hook already does this).
- Past handoff notes show under each session in the left list, to read back.

## The rest of the Dev view: teams, loops, accounts (13 Nov 2026)
All machine-only, because each one makes the computer do something.
- **Teams:** set a folder up, start a team (it starts its own Claude workers), give it jobs. Seeing a team's jobs and status stays safe, on the web page too.
- **Loops:** a loop types a prompt into a session every so often, so setting one up, changing or stopping it happens on the dev side. The list of loops can be seen anywhere.
- **Accounts:** save and switch the Claude accounts on this computer.
- **Setup checks:** what `omicron doctor` says this computer still needs.
- **The `omicron` command** does everything the web page and the desktop app do. The desktop app is buttons on the same program, and like it, the command only acts on the computer it runs on.

## Drop chat (13 Nov 2026)
Decided: Omicron loses the Project chat.
- Task comments already cover talking about the work: sessions post their reports there, and Joe answers in them.
- Chat was the easiest way for someone to give Claude orders (the same risk as typing into a session from the web page).
- The morning summary, the only thing that uses chat today, becomes a task comment or a note instead.

## Linking, what keeps sessions running, and tasks (13 Nov 2026)
- **Linking:** any Claude started in a known Folder links itself when it starts. Any other Claude chat on the computer shows up in the desktop app with a "Link" button.
- **What keeps sessions running:** a separate background program, like today. The desktop app only connects to it, so quitting the app leaves sessions running. The app starts the program if it's off.
- **Tasks carry the same risk chat did.** If a session acted on tasks or comments given to it from the web page, anyone who can add a task could give Claude orders. So a session only works on a task handed to it on that computer: dragged onto it in the desktop app, or given with the `omicron` command. Tasks and comments from the web page are only things to read.

## The gate: letting a computer take orders for a while (13 Nov 2026)
By default a computer takes no orders from anywhere else. The gate is the one exception.
- Each computer opens its own gate, only from itself: a **toggle in the desktop app**, or a closing time typed into the `omicron` command (like `omicron gate open --until 17:00`).
- While it's open, the computer takes messages and handed-over work from other machines and the web page. When it closes, it stops.
- It closes at the time you choose, and never more than **24 hours** after it opened.
- The computer itself checks the gate, not the database, so nobody can open it from outside by changing a row.
- The desktop app always shows whether the gate is open and when it closes.
- This is how working across machines stays manageable (a hard part of what legion and the board did): before handing work to another computer, open its gate until, say, 5 PM.

- **Only the computer's owner can send it orders**, even while the gate is open. Other people in the Project can't, ever.
- **The computer serving the web page always takes orders from Joe**, with no gate to open, so he can work from his phone without logging in to unlock it each day. It only counts when the order comes straight into that computer's own page and that computer sees Joe's Tailscale login itself (through the home lab's gate), not from a row in the database. Everything else still needs the gate.
- Risk Joe accepts: anyone holding his unlocked phone (or his Tailscale login) can give orders to that computer.
- **The same rule covers the Dev view.** Seeing and typing into a terminal is no more dangerous than giving orders. So on the serving computer's own page, signed in as Joe, the page shows that computer's Dev view, terminal included, for that computer's sessions only. Everyone else, and every other computer, gets only the Tasks view.

Not hosting publicly: the web page stays behind Tailscale and the home lab's gate (no Vercel), so sign-in stays as it is.
