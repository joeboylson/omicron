---
name: omicron-handoff
description: Write an Omicron handoff note so the next conversation in this window picks up exactly where this one stops. After it's saved, the user types /clear and the new conversation starts with the note. Use when the user runs /omicron-handoff or asks for an Omicron handoff before clearing.
allowed-tools: Bash(omicron:*), Bash(git status:*), Bash(git branch:*), Bash(git log:*)
---

# Hand this session's work to the next conversation

Write a handoff note, save it with `omicron handoff write`, then stop. When
the user types `/clear`, the new conversation in this window gets the note.

## 1. Check this is an Omicron session

Run `omicron sessions list --as-machine` and find this window's session. If
`omicron handoff write` later says this isn't a tracked session, tell the user
to quit and reopen this conversation with `omicron open --resume <its id>`, and stop.

## 2. Check the real state

Don't write from memory. Run the checks and use what they say:
- `git status` and the current branch
- the tasks this session is working on: `omicron tasks show <Project> <n> --as-machine`
- anything this session started that's still running (servers, watchers,
  `/loop`): it stops when the conversation is cleared, so say what existed
  and what it was waiting for

## 3. Write the note

Short and direct, plain words, real names of files and commands, at most 100
lines. Point to files instead of copying them. Start with `# <what this is
about>`, then:

1. **Goal right now:** what the user is trying to get to.
2. **Done:** what's finished and checked, and how it was checked.
3. **Not done:** what's left, in order, with the next step first.
4. **Watch out:** anything surprising, broken or decided that the next
   conversation would otherwise trip on.
5. **Check first:** the commands to run before carrying on.

## 4. Save it and stop

```sh
omicron handoff write <<'NOTE'
<the note>
NOTE
```

Then tell the user, in one line, that the note is saved and to type `/clear`.
Do nothing else.
