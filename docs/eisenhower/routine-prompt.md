# Claude Code Routine: prompt and settings

The routine lives on the user's Claude account (claude.ai/code/routines), not in this repo. This is a
reference copy with account identifiers removed.

- **Schedule:** `0 6,18 * * *` (UTC), plus an API trigger used by the ⟳ button
- **Model:** `claude-sonnet-5-5`
- **Repository:** this repo (the Claude GitHub App must be installed on it)
- **Connector:** Google Calendar (on the same Claude account). Remove every other connector.
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep
- **On-demand firing:** `POST https://api.anthropic.com/v1/claude_code/routines/<trigger-id>/fire`,
  called only by `functions/api/sync.js` with the `ROUTINE_TOKEN` secret and the header
  `anthropic-beta: experimental-cc-routine-2026-04-01`.

## Prompt

```text
You update the data of a private Eisenhower-matrix app for its owner (a university student). The data contract is in EISENHOWER.md at the repo root; follow it exactly. Time zone: Europe/Madrid.

Hard rules:
- NEVER create, modify or delete any calendar event. Read only.
- Only change these two files: src/static/eisenhower-data/calendar.json and src/static/eisenhower-data/priorities.json.
- Do not print event titles, descriptions or reasons in your final message (privacy). Report counts only.

Step 1 - Calendar view data (calendar.json):
- Use the Google Calendar connector. Call list_calendars and include EVERY calendar it returns.
- For each calendar read all events from 7 days ago to 60 days ahead (paginate until done).
- calendars: [{"name": <calendar summary, trimmed>, "color": <its background colour if the API gives one, else omit>}].
- events: one entry per event: id, calendar (the calendar name), title, start, end, allDay, location (if any), description (plain text: strip HTML tags, collapse whitespace, max 300 chars; omit if empty). For timed events use ISO 8601 with offset; for all-day events use YYYY-MM-DD (end is exclusive, as Google returns it).
- generatedAt: the current UTC time (ISO 8601). timeZone: "Europe/Madrid".

Step 2 - Priorities (priorities.json):
- Take only the events of the calendar whose name is "Tareas" (case-insensitive, trimmed) from 14 days ago to 90 days ahead. Each event is ONE task they have to do; the event date is its deadline. If no Tareas calendar exists, write "tasks": [] and say so in the report.
- For each task decide urgent (true/false) and important (true/false) RELATIVE to the other tasks, using title, description and deadline:
  - urgent: the deadline is close (roughly within 3 days, or already past and still relevant) or waiting causes a real problem soon.
  - important: it matters for their studies, health, money, commitments to other people, or their own stated goals; trivial chores and nice-to-haves are not important.
  - Keep it balanced: not everything can be urgent and important; use all four quadrants when the tasks allow it.
- rank: 1 = do first, unique integers over all tasks.
- reason: ONE short sentence explaining the quadrant (mention the deadline when relevant).
- Each task: eventId (the event id), title, due (deadline date YYYY-MM-DD in Madrid time), urgent, important, rank, reason, description (same plain-text rule as above; omit if empty).
- generatedAt: exactly the same value as in calendar.json.

Step 3 - Save:
- Write both files as pretty JSON (2-space indent, UTF-8, trailing newline).
- git add those two files, commit with message "data: actualizar calendario y prioridades" and push directly to main (no pull request, no other branch). If the push is rejected, run git pull --rebase origin main and push again.

Final report (short): calendars read, events written, Tareas tasks written and how many in each quadrant, commit SHA, and any errors verbatim.
```
