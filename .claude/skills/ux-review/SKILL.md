---
name: ux-review
description: Review Omicron's web page the way its users would. Takes fresh screenshots of every page and state into ref/ux/<date>/, has agents play a handful of real use cases and critique what they see against familiar apps, then turns the findings into tasks on the Omicron board. Use when Joe says "ux review", "review the UI", "act like a user", or runs /ux-review.
---

# UX review: screenshots, use cases, critiques, tasks

Four steps. Steps 2 and 3 use the Agent tool; keep it to at most 8 agents
in all (one inventory, one use-case writer, up to 6 critics).

## 1. Fresh screenshots of every page and state

1. Make the folder: `ref/ux/<YYYY-MM-DD>/` (add `-2`, `-3` if it exists).
2. **Coverage first.** Spawn one agent (Explore) with this brief: "List
   every page, sheet, menu, empty state, error state and setting in
   Omicron's web page (web/src/pages, web/src/components, the routes in
   web/src/App.tsx). Compare with the steps in dev/seed/shots.js and
   return, as a list, each page or state it doesn't photograph, with how to
   reach it (what to click, what data it needs)." Add the missing ones to
   dev/seed/shots.js (and dev/seed/seed.js for data they need), so the
   photographs grow with the app. Keep its style: one `await shot("name")`
   per state, names numbered so the folder reads in order.
3. Run `bash scripts/shots.sh ref/ux/<date>` (it fills a throwaway Project
   with made-up data, takes desktop and phone pictures, and cleans up). If a
   step fails, fix the step and run it again; don't skip states.
4. Write `ref/ux/<date>/README.md`: one line per picture saying what it
   shows. Commit the folder (pictures and README) when the review is done.

## 2. Use cases

Spawn one agent (general-purpose) to write the use cases. Brief it with
DEFINITIONS.txt, ref/BRAINSTORM.md and the README from step 1, and ask for
at most 10 short use cases: who the person is, what they're trying to get
done, and the steps they'd take. It must cover at least:
- **A household board.** Joe and his wife Claire share a board: household
  tasks, Joe's tasks, Claire's tasks, tasks for later, date ideas. A general
  board of ideas and to-dos, used from the phone as much as the computer.
- **A developer working tasks one at a time.** Joe hands tasks to Claude
  sessions on his computer, follows them, reviews their reports.
- **An overnight run.** Joe sets up a run (Run rules, To do in order, the
  gate open until morning), walks away, and follows it from his phone.
Return them as a numbered list.

## 3. Critiques, one agent per use case or two

Spawn the critics in one message so they run at the same time: one agent
(general-purpose) per use case, or per two related ones, at most 6. Give
each: its use case(s), the path of the screenshots folder and its README,
and this brief:

"You are this person, using Omicron for the first time and then every day.
Look at every screenshot that bears on your use case (read the image files).
Judge it as a user, informed by the apps people know (Trello, Linear,
Things, Reminders, Notion, GitHub): what's expected, what's familiar, how
things usually work. Report problems only, each with: the screenshot file,
what's wrong in plain words, why it matters to you, and what you'd expect
instead. Look for: things that don't make visual sense; things that don't
do what you'd expect; features you can't find or reach from the page (or
can't tell exist); missing feedback, empty or error states; anything hard
on a phone or by keyboard; words that are jargon. Rate each: high (stops
me), medium (slows me), low (polish). At most 15, most important first."

## 4. Findings into tasks

1. Merge the critics' findings: the same problem from several use cases is
   one finding (note which use cases hit it, and keep the highest rating).
   Drop ones that are wrong about how Omicron works (check the code if
   unsure) and ones that go against decisions in ref/BRAINSTORM.md.
2. Show Joe the merged list (title, rating, use cases) and ask which to
   file, unless he said to file them all.
3. File each as a task in the Omicron Project, in To do, labelled `ux`:
   `omicron tasks add Omicron "<short title>" --label ux --notes "<what's wrong, why it matters, what's expected; screenshot ref/ux/<date>/<file>; use cases: …>"`.
   High-rated ones first (`omicron tasks move Omicron <n> --top`).
4. Add a "Findings" section to `ref/ux/<date>/README.md` listing each
   finding with its task number, and commit and push.
5. Tell Joe in a few lines: how many pictures, how many findings, how many
   tasks filed, and the top three.
