---
name: hig-review
description: Review Omicron's web page against Apple's Human Interface Guidelines. Takes fresh screenshots, has agents each check one area of the guidelines (summarized in ref/hig/), and files what they find as tasks that cite the guideline. Use when Joe says "HIG review", "check it against Apple's guidelines", or runs /hig-review.
---

# HIG review: screenshots, ten reviewers, tasks that cite the guideline

The guidelines are summarized in `ref/hig/<topic>.md` (one file per HIG
page, rules numbered so a task can cite "HIG buttons #4"; each file names
its source page). `ref/hig/README.md` lists them. Read them; don't review
from memory. If a page Omicron now needs isn't there, add a file the same
way (fetch https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<topic>.json).

Omicron's own rules come first where they're stricter (CLAUDE.md, the
project's memory): no explanatory subtitles or help text under titles,
sections or forms; no jargon, made-up terms or developer language; the page
explains itself to someone with no technical skills.

## 1. Fresh screenshots

`bash scripts/shots.sh ref/ux/<YYYY-MM-DD>` (desktop and phone, made-up
data, cleans up after). Write `ref/ux/<date>/README.md`: one line per
picture saying what it shows.

## 2. Ten reviewers, one area each

Spawn them in one message so they run at the same time (Agent tool,
general-purpose). Areas:

1. Layout and spacing (layout, sidebars, toolbars; navigation bars are in toolbars)
2. Typography and writing (typography, writing, labels)
3. Color, dark mode and contrast (color, dark-mode, accessibility's color rules)
4. Accessibility (accessibility, keyboards, pointing-devices)
5. Buttons, menus and controls (buttons, menus, pull-down-buttons, segmented-controls, toggles, pickers)
6. Sheets, popovers, alerts and modality (sheets, popovers, alerts, action-sheets, modality)
7. Lists, tables and search (lists-and-tables, search-fields, searching, text-fields, entering-data)
8. Feedback, loading and undo (feedback, loading, undo-and-redo, managing-notifications)
9. Touch and drag (gestures, drag-and-drop) on the phone pictures
10. First use and help (onboarding, offering-help, settings, collaboration-and-sharing)

Brief for each: "You review Omicron's web page for <area>. Read
ref/hig/<files> first, then every screenshot in ref/ux/<date>/ that bears
on it (the README says what each shows), desktop and phone. Report problems
only, at most 12, most important first, each with: the screenshot file;
what's wrong in plain words; the rule it breaks, cited as `HIG <topic>
#<n>` with the rule's words; what it should be instead. Rate each high
(stops someone), medium (slows them), low (polish). Don't report what goes
against these Omicron rules: <the rules above>. Check the code
(web/src) when a picture can't tell you."

## 3. Merge and file

1. Merge duplicates across reviewers (keep the highest rating, all the
   rules cited). Drop ones that are wrong about how Omicron works (check
   the code) or that go against Omicron's own rules or ref/BRAINSTORM.md.
2. File each as a task in the Omicron Project, To do, labelled `hig`:
   `omicron tasks add Omicron "<short title>" --label hig --notes "<what's wrong; what it should be; HIG <topic> #<n>: <rule>; source <URL>; screenshot ref/ux/<date>/<file>>"`.
   High ones first (`omicron tasks move Omicron <n> --top`).
3. Add a "Findings" section to `ref/ux/<date>/README.md` listing each with
   its task number. Commit and push.
4. Tell Joe in a few lines: how many findings, how many tasks, the top three.
