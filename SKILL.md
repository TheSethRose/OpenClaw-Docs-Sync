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

## Run the sync (steps 1–4)
Run the script below whenever you need a fresh mirror.

Recommended (portable):
- `npx tsx scripts/sync-docs.ts`

Optional (Bun, fastest):
- `bun run scripts/sync-docs.ts`

### Bun crash avoidance for QMD
QMD defaults to Bun. This skill ships `scripts/qmd.sh`, which runs QMD via
`tsx`/Node to avoid Bun crashes.

Manual query example:
- `scripts/qmd.sh query "OpenClaw Security" -c openclaw-docs --files -n 5`

Script path:
- `scripts/sync-docs.ts`

What it does:
- Mirrors OpenClaw `docs/` into `docs/`
- Mirrors ClawHub `docs/` into `docs/clawdhub/`
- Mirrors Skills `skills/` into `docs/skills/`
- Runs QMD collection creation + embeddings

Expected QMD collection name: `openclaw-docs`

## QMD retrieval guidance (most important)
Always prioritize **QMD query + reranking** to get the highest-signal results. Then open the exact files with `qmd get` or `qmd multi-get`.

### 1) Best default: combined search + rerank
Use this when you’re unsure or want the most relevant results across all three repos.
- `qmd query "<your question>" -c openclaw-docs --files -n 20`

Then open the top-ranked files:
- `qmd get <file>:<line>`
- `qmd multi-get "<glob>" -l 200`

### 2) Semantic search (when wording differs)
Use vector similarity for paraphrased or conceptual questions.
- `qmd vsearch "<concept>" -c openclaw-docs --files -n 20 --min-score 0.2`

### 3) Exact text search (when you know the term)
Use BM25 for known phrases, flags, or exact file references.
- `qmd search "<exact term>" -c openclaw-docs --files -n 50`

### 4) Narrow by repo folder
Use path hints in your query or filter results after you get filepaths.

Repo path hints:
- OpenClaw docs: `docs/`
- ClawHub docs: `docs/clawdhub/`
- Skills repo: `docs/skills/`

### 5) Retrieval workflow (recommended)
1. Run `qmd query` for the broad best results.
2. Identify top paths + file names.
3. Use `qmd get` or `qmd multi-get` to pull exact sections.
4. Cite the path + line numbers in your answer.

## Output expectations
- The local mirror should be a 1:1 copy of the three repo paths.
- The QMD collection should be rebuilt after each sync.
- Results should favor **official docs** over secondary sources.

## Notes
- This skill assumes QMD is installed and available in PATH.
- The sync script only ingests folders + `.md`/`.mdx` files.
