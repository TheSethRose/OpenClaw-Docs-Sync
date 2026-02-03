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
- Preferred (Bun): `bun run scripts/sync-docs.ts`
- TS runner (portable): `npx tsx scripts/sync-docs.ts`

Script path:
- `scripts/sync-docs.ts`

This is intended to run daily or on demand to keep docs in sync.
