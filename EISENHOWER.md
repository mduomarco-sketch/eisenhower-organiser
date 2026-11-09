# Eisenhower fork

A fork of [Super Productivity](https://github.com/super-productivity/super-productivity)
(MIT, upstream commit `896f3d0`) set up as an Eisenhower-matrix app.

## What is different from upstream

| Change | Where |
|---|---|
| Poster theme (her pick; id `calm-minimal`), default on first start | `src/assets/themes/calm-minimal.css`, `src/app/core/theme/custom-theme.service.ts` |
| Boards enabled and the Eisenhower board is the start page | `src/app/features/config/new-install-config.const.ts`, `default-global-config.const.ts` |
| Built-in plugin `eisenhower-ai` ("Calendario"), enabled by default | `src/assets/eisenhower-plugin/`, `src/app/plugins/bundled-plugins.const.ts`, `plugin.service.ts` |
| Data written by the Claude routine | `src/static/eisenhower-data/` (served at `/static/eisenhower-data/`) |
| Phone look (under 600px only): 2x2 room map, room names and colours, calmer rows with friendly dates, "Lock in." board title, sparkle Claude button, Tablero and Calendario in the bottom bar | `src/app/features/boards/eisenhower-rooms.const.ts`, `friendly-due.util.ts`, `board.component`, `task.component`, `mobile-bottom-nav`, `page-title`, `calm-minimal.css` |
| English by default on every device (a language picked in Settings still wins) | `src/app/core/language/language.service.ts` |
| Easter egg: half of the finished tasks show a small picture from a list of image URLs (no repeats within 50; the list is empty in this public copy). Menu without Search, Support us and Help (`magic-nav-config.service.ts`) | `src/assets/eisenhower-plugin/plugin.js` |
| Upstream GitHub workflows removed | (so nothing runs in GitHub Actions) |

## Data contract (written by the Claude routine every 12 h)

`src/static/eisenhower-data/calendar.json`: everything shown in the Calendario view.

```json
{
  "generatedAt": "2026-11-08T06:00:00Z",
  "timeZone": "Europe/Madrid",
  "calendars": [{ "name": "Tareas", "color": "#c0564b" }],
  "events": [
    {
      "id": "<google event id>",
      "calendar": "Tareas",
      "title": "…",
      "start": "2026-11-09T10:00:00+01:00 or 2026-11-09 for all-day",
      "end": "…",
      "allDay": false,
      "location": "optional",
      "description": "optional, plain text, max 300 chars"
    }
  ]
}
```

`src/static/eisenhower-data/priorities.json`: only the events of the **Tareas** calendar.

```json
{
  "generatedAt": "2026-11-08T06:00:00Z",
  "tasks": [
    {
      "eventId": "<google event id>",
      "title": "…",
      "due": "2026-11-09",
      "urgent": true,
      "important": false,
      "rank": 1,
      "reason": "one sentence in English",
      "description": "optional, plain text"
    }
  ]
}
```

## How the plugin applies priorities

- One task per Tareas event, created in the Inbox with the `urgent` / `important` tags
  (`EM_URGENT`, `EM_IMPORTANT`), which place it in the right board quadrant.
- Claude's reason goes into the task notes; the last line `ref: cal:<eventId>` links the task to the event.
- If she moves a task to another quadrant, Claude never changes its tags again.
- If she edits a task's notes, Claude stops updating those notes (the plugin keeps the last notes it wrote in its synced state to detect this).
- Done tasks and tasks she deleted are never touched or recreated.
- The plugin re-reads the file on start, every 30 min and when the app comes back to the foreground.

## Build

- Build command: `npm run buildFrontend:prodWeb`
- Output directory: `dist/browser`
- Environment variables: `NODE_VERSION=22`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`

## "⟳ Sincronizar con Claude" button

- Header button from the plugin. It calls `POST /api/sync`, a Cloudflare Pages Function in
  `functions/api/sync.js` (picked up by `wrangler pages deploy`, which the deploy workflow runs from the repo root).
- The function fires the routine with `ROUTINE_FIRE_URL` and `ROUTINE_TOKEN`, which are Pages
  **secrets**; they never reach the browser. The endpoint is behind Cloudflare Access like the rest of the site.
- After a successful fire the button is on a 10-minute cooldown (kept in `localStorage`), and the plugin
  checks `priorities.json` every 60 s for up to 15 min; when `generatedAt` changes it applies the
  results and shows "Actualizado ✓". 429 from Claude shows "Too many syncs, try later".

## Deploys

GitHub Actions (`.github/workflows/deploy.yml`; in this public copy the file is kept as an example at `docs/eisenhower/deploy-workflow.yml`) builds and uploads to the Cloudflare Pages project
`eisenhower` (`https://<project>.pages.dev`) on every push to `main`. It uses the repo secrets
`CLOUDFLARE_API_TOKEN` (a token limited to "Pages Write") and `CLOUDFLARE_ACCOUNT_ID`.
The site is protected by Cloudflare Access (one-time PIN by email, allowed emails only).
> **Public copy:** the two files in `src/static/eisenhower-data/` contain made-up sample data. In the private repo the routine overwrites them with real calendar data.
