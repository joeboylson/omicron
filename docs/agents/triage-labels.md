# Triage labels

The skills speak in five triage roles. On the Omicron board some are
columns rather than labels; this maps each role to what to do.

| Role in mattpocock/skills | On the Omicron board                                  | Meaning                                  |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `needs-triage`            | label `needs-triage`, in To do                        | Joe needs to look at it                  |
| `needs-info`              | status **Waiting on Joe**, with the question as a comment | Waiting on Joe for more information  |
| `ready-for-agent`         | status **To do** (no label): a session can take it    | Fully specified, ready for an AFK agent  |
| `ready-for-human`         | label `ready-for-human`, given to Joe (`--to "Joe Boylson"` when added) | Needs Joe to do it |
| `wontfix`                 | label `wontfix`, moved to **Done** with a comment why | Will not be done                         |

Labels are made the first time they're used (`omicron tasks label Omicron <n> <label>`).
