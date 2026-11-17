---
name: lessons
description: Read and record lessons learned in `.ai/lessons.md`. Use at the start of any task (read the section for your area), whenever you learn something non-obvious that the code and docs do not say (framework behaviour, a root cause, a pitfall, a user correction), and when the user says "zapisz lekcję", "add a lesson", "remember this for the repo", or invokes /lessons.
---

# Lessons

`.ai/lessons.md` is the repo's shared memory for agents and people. It is read
by `code-review`, `implement-spec` and the `auto-*` skills, and `CLAUDE.md`
tells every session to read it. Keeping it accurate is part of the work.

## Read (start of every task)

1. Open `.ai/lessons.md` and read the sections that match the task (e.g.
   "CPQ" + "MikroORM / Zod" for a CPQ service change, "Packaging and release"
   for a version bump).
2. Apply what applies. If a lesson contradicts what you now see in the code,
   check it; fix or delete the wrong lesson in the same change.

## Write (when you learn something)

Add a lesson when **all** of these hold:
- it is **non-obvious**: a framework behaviour, a root cause, a trap, a fact
  about the environment, or a correction from the user;
- it is **verified**: you saw it in code, logs, a test or a live run, not a guess;
- it will **matter again**: another task could hit it;
- it is **not already written down** in code comments, a skill, a manual or `AGENTS.md`.

Do not add: task status, one-off facts about a single PR, things the code
already shows, secrets or personal data.

Format (newest first within the section; create a section if none fits):

```
- **<one-line lesson, a statement not a topic>** (YYYY-MM-DD, <PR / commit / file>)
  <why it matters / what to do instead, 1-3 lines>
```

Rules:
- One lesson per entry. Short. Name exact files, helpers, commands.
- Before adding, search the file for the topic: update an existing entry
  instead of duplicating it.
- A lesson that becomes a rule everyone must follow belongs in a skill or
  `AGENTS.md` too; keep the lesson as a pointer.
- Commit lessons **with the change that taught them** (same PR). A lesson
  learned without a code change goes in a small `docs:` PR.

## Maintain

- When a lesson is wrong or obsolete (framework upgrade, refactor), fix or
  remove it in the PR that makes it obsolete.
- Keep the file scannable: if a section grows past ~15 entries, split it or
  fold related entries together.
