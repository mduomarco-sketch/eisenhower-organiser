# Eisenhower Organiser

An Eisenhower-matrix task app where **Claude reads a Google Calendar and decides what is urgent and
important**, relative to everything else on the list.

It is a fork of [Super Productivity](https://github.com/super-productivity/super-productivity) (MIT),
built as a personal app for one user on a laptop, an iPhone and an iPad. This repository is a
**public copy of the code only**: the data files contain made-up samples and no personal
information, account identifiers or secrets.

## How it works

```
Google Calendar ("Tareas" = one event per task, the date is the deadline)
   │  read-only, through the Google Calendar connector of the user's own Claude account
   ▼
Claude Code Routine — every 12 h, or on demand from the ⟳ button
   │  writes src/static/eisenhower-data/calendar.json + priorities.json and commits to main
   ▼
GitHub Actions → npm run buildFrontend:prodWeb → wrangler pages deploy   (workflow: docs/eisenhower/deploy-workflow.yml)
   ▼
Cloudflare Pages, behind Cloudflare Access (email one-time PIN)
   ▼
The app on each device: a built-in plugin reads priorities.json and puts every task in its quadrant
```

- **Quadrants** come from two tags, `EM_URGENT` and `EM_IMPORTANT`, which drive Super Productivity's
  Eisenhower board.
- **Relative ranking:** each run sends *all* open tasks to Claude at once, so "important" means
  important compared with the rest. Each task gets a one-sentence reason in its notes.
- **The user always wins:** a task moved by hand, edited, completed or deleted is never changed again.
- **⟳ Sync with Claude:** a header button calls `POST /api/sync`, a Cloudflare Pages Function
  (`functions/api/sync.js`) that fires the routine's API trigger with server-side secrets.
  No key ever reaches the browser.
- **Devices** stay in sync through Super Productivity's own Dropbox sync.

## What differs from upstream

See [`EISENHOWER.md`](EISENHOWER.md) for the full list, the JSON data contract and the deploy setup.
The routine's prompt (with identifiers removed) is in
[`docs/eisenhower/routine-prompt.md`](docs/eisenhower/routine-prompt.md).

Highlights: the `eisenhower-ai` plugin (`src/assets/eisenhower-plugin/`), the Calm Minimal / poster
theme (`src/assets/themes/calm-minimal.css`), the board as start page, a phone layout with a 2x2
"room" map, and the sync function.

## Run it locally

Requires Node 22 (`.nvmrc`) and git.

```bash
npm ci                         # set ELECTRON_SKIP_BINARY_DOWNLOAD=1 to skip Electron
npm run startFrontend          # http://localhost:4200 (first build ~2 min)
npm run buildFrontend:prodWeb  # production web build into dist/browser
```

With the sample data the board shows one task in each quadrant. The ⟳ button needs a deployed
routine and the `ROUTINE_FIRE_URL` / `ROUTINE_TOKEN` secrets, so it won't work locally.

## Deploying your own

1. A Claude account with Claude Code on the web (Pro/Max), the Google Calendar connector and the
   Claude GitHub App on your repo.
2. A routine using the prompt in `docs/eisenhower/routine-prompt.md`, schedule `0 6,18 * * *`,
   plus an API trigger for the ⟳ button.
3. A Cloudflare Pages project, Cloudflare Access in front of it, and the Pages secrets
   `ROUTINE_FIRE_URL` and `ROUTINE_TOKEN`.
4. Copy `docs/eisenhower/deploy-workflow.yml` to `.github/workflows/deploy.yml` and add the repo
   secrets `CLOUDFLARE_API_TOKEN` (Pages Write) and `CLOUDFLARE_ACCOUNT_ID`.

Keep a deployment like this **private**: once the routine runs, the data files hold a real calendar.

## License

MIT, like upstream: see [`LICENSE`](LICENSE). Upstream's own README is kept in
[`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md). The poster fonts (Anton, Archivo Narrow) are
under the SIL Open Font License; their licenses are in `src/assets/fonts/poster/`.
