---
name: openclaw-docs-sync
description: Sync OpenClaw + ClawHub + Skills docs into a local mirror, build QMD search collections, and guide high-precision retrieval from the three repos.
keywords:
  - openclaw
  - clawhub
  - skills
  - docs
  - qmd
  - embeddings
  - search
author: Seth Rose
version: 1.0.0
---

# OpenClaw Docs Sync

## Purpose
Keep a local, search-optimized mirror of the OpenClaw framework docs, ClawHub CLI/docs, and the Skills repository. The mirror is indexed with QMD so the agent can retrieve authoritative, high-signal answers fast.

## When to use
Use this skill when the agent needs **fresh documentation** or **precise references** from:
- OpenClaw framework docs
- ClawHub CLI/docs
- Skills repo (all `SKILL.md` files)

## What this skill provides
1. A deterministic sync script that mirrors docs daily or on demand.
2. A QMD collection build step with embeddings.
3. Retrieval guidance for highest quality results.

## Running the sync

```bash
npx tsx scripts/sync-docs.ts
```

This will:
1. Mirror `openclaw/openclaw` docs → `~/.openclaw/docs/`
2. Mirror `openclaw/clawhub` docs → `~/.openclaw/docs/clawdhub/`
3. Mirror `openclaw/skills` skills → `~/.openclaw/docs/skills/`
4. Build QMD collection `openclaw-docs` with embeddings

## Querying with QMD

```bash
# Semantic + BM25 combined (best default)
qmd query "your question" -c openclaw-docs --files -n 20

# Get specific file content
qmd get <file>:<line>

# Get multiple files by glob
qmd multi-get "**/*.md" -l 200
```

## QMD retrieval guidance

### Search modes

| Mode | When to use | Command |
|------|-------------|---------|
| Combined | Default, best results | `qmd query "<question>" -c openclaw-docs --files -n 20` |
| Semantic | Conceptual/paraphrased queries | `qmd vsearch "<concept>" -c openclaw-docs --files -n 20 --min-score 0.2` |
| Exact | Known terms, flags, file names | `qmd search "<exact term>" -c openclaw-docs --files -n 50` |

### Retrieval workflow
1. Run a search to get file paths
2. Use `qmd get <file>:<line>` for specific content
3. Use `qmd multi-get "<glob>" -l 200` for multiple files
4. Cite path + line numbers in your answer

### Path hints for filtering results
- OpenClaw framework: `~/.openclaw/docs/*.md`
- ClawHub CLI: `~/.openclaw/docs/clawdhub/*.md`
- Skills repo: `~/.openclaw/docs/skills/**/*.md`

## Requirements
- QMD installed globally (`npm i -g qmd`)
- Bun runtime (QMD uses Bun-native APIs)

## Notes
- Sync script only downloads `.md` and `.mdx` files
- Collection is rebuilt on each sync
- Always prefer official docs over secondary sources
