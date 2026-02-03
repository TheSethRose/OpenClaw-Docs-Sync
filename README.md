# OpenClaw Docs Sync

Synchronize OpenClaw, ClawHub, and Skills repository documentation into a local `docs/` mirror and index it with QMD for fast search.

## What it does
- Pulls **only folders + .md/.mdx files** from:
  - `https://github.com/openclaw/openclaw/tree/main/docs`
  - `https://github.com/openclaw/clawhub/tree/main/docs`
  - `https://github.com/openclaw/skills/tree/main/skills`
- Writes a 1:1 local mirror under `docs/`.
- Builds a QMD collection and embeddings for search.

## Run
- Recommended (portable): `npx tsx scripts/sync-docs.ts`
- Optional (Bun, fastest): `bun run scripts/sync-docs.ts`

## Bun crash avoidance for QMD
QMD currently shells out to Bun by default. To avoid Bun crashes, this repo ships
`scripts/qmd.sh`, which forces QMD to run via `tsx`/Node.

All QMD calls inside `scripts/sync-docs.ts` already use `scripts/qmd.sh`.
For manual queries, use:
- `scripts/qmd.sh query "OpenClaw Security" -c openclaw-docs --files -n 5`

Script path:
- `scripts/sync-docs.ts`

This is intended to run daily or on demand to keep docs in sync.
