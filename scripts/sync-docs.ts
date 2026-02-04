import fs from "fs/promises";
import os from "os";
import path from "path";

const ROOT = path.resolve(os.homedir(), ".openclaw", "docs");

type RepoTarget = {
  name: string;
  owner: string;
  repo: string;
  branch: string;
  sourcePath: string;
  destPath: string;
};

type TreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
};

type TreeResponse = {
  tree: TreeEntry[];
  truncated: boolean;
};

const targets: RepoTarget[] = [
  {
    name: "openclaw-docs",
    owner: "openclaw",
    repo: "openclaw",
    branch: "main",
    sourcePath: "docs",
    destPath: path.join(ROOT, "openclaw-docs"),
  },
  {
    name: "clawhub-docs",
    owner: "openclaw",
    repo: "clawhub",
    branch: "main",
    sourcePath: "docs",
    destPath: path.join(ROOT, "clawhub-docs"),
  },
  {
    name: "openclaw-skills",
    owner: "openclaw",
    repo: "skills",
    branch: "main",
    sourcePath: "skills",
    destPath: path.join(ROOT, "openclaw-skills"),
  },
];

const allowedExtensions = new Set([".md", ".mdx"]);
const TREE_TIMEOUT_MS = 30_000;
const RAW_TIMEOUT_MS = 20_000;
const RETRY_DELAY_BASE_MS = 500;
const DOWNLOAD_CONCURRENCY = Number(process.env.DOCS_SYNC_CONCURRENCY ?? 16);
const PROGRESS_INTERVAL = Number(process.env.DOCS_SYNC_PROGRESS ?? 500);

// Security: Detect supply chain attack patterns (prompt injection, malicious payloads)
type Threat = { type: string; match: string };
const THREAT_LOG = path.resolve(ROOT, "..", "security-scan.log");

// Trusted domains for pipe-to-shell patterns (official installers)
const TRUSTED_SHELL_DOMAINS = [
  "openclaw.ai",
  "tailscale.com",
  "bun.sh",
  "deb.nodesource.com",
  "get.docker.com",
  "raw.githubusercontent.com/Homebrew/",
  "raw.githubusercontent.com/openclaw/",
  "raw.githubusercontent.com/trycua/",
];

// Trusted domains for executable downloads
const TRUSTED_EXECUTABLE_DOMAINS = [
  "dl.google.com",
  "github.com",
  "openclaw.ai",
];

function isPrivateOrLocalIP(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;

  // 127.x.x.x (loopback)
  if (parts[0] === 127) return true;
  // 10.x.x.x (private class A)
  if (parts[0] === 10) return true;
  // 172.16-31.x.x (private class B)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.x.x (private class C)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 100.64-127.x.x (CGNAT / Tailscale)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  return false;
}

function isTrustedShellDomain(url: string): boolean {
  return TRUSTED_SHELL_DOMAINS.some((domain) => url.includes(domain));
}

function isTrustedExecutableDomain(url: string): boolean {
  return TRUSTED_EXECUTABLE_DOMAINS.some((domain) => url.includes(domain));
}

function scanForThreats(content: string): Threat[] {
  const threats: Threat[] = [];

  // Process line-by-line to avoid cross-line false positives
  const lines = content.split("\n");

  for (const line of lines) {
    // 1. Base64 decoded and piped to shell execution
    // Must have the pipe - that's what makes it dangerous
    const base64Exec = /base64\s+(-[dD]|--decode)[^|]*\|\s*(bash|sh|zsh)/gi;
    for (const match of line.matchAll(base64Exec)) {
      threats.push({ type: "base64-exec", match: match[0] });
    }

    // 2. Curl/wget piped directly to shell (the classic dropper)
    // Require URL pattern to avoid matching "curl jq" or other garbage
    // Skip trusted official installers
    const pipeToShell =
      /(curl|wget)\s+[^\n|]*https?:\/\/[^\s|]+[^\n|]*\|\s*(bash|sh|zsh)/gi;
    for (const match of line.matchAll(pipeToShell)) {
      if (!isTrustedShellDomain(match[0])) {
        threats.push({ type: "pipe-to-shell", match: match[0] });
      }
    }

    // 3. Command substitution with curl/wget (executes the downloaded content)
    // Require URL pattern, skip trusted sources
    const cmdSubstitution =
      /\$\(\s*(curl|wget)\s+[^)]*https?:\/\/[^\s)]+[^)]*\)/gi;
    for (const match of line.matchAll(cmdSubstitution)) {
      if (!isTrustedShellDomain(match[0])) {
        threats.push({ type: "cmd-substitution", match: match[0] });
      }
    }
  }

  // 4. Raw IP addresses in URLs (legitimate services use domains)
  // Skip localhost and private/internal IPs used in documentation examples
  const rawIpUrl = /https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gi;
  for (const match of content.matchAll(rawIpUrl)) {
    const ip = match[1];
    if (!isPrivateOrLocalIP(ip)) {
      threats.push({ type: "raw-ip-url", match: match[0] });
    }
  }

  // 5. Prompt injection: fake instructions trying to trick the agent
  // Only flag highly suspicious patterns, not common documentation phrases
  const promptInjection = [
    // Fake UI/system elements (the actual attack used "Setup-Wizard:")
    /setup[_-]?wizard\s*:/i,
    /installation[_-]?required\s*:/i,
    /system[_-]?command\s*:/i,
    // Agent-targeted injection (explicitly targeting AI)
    /(?:as\s+an?\s+ai|claude|assistant)[,:]?\s*(?:you\s+)?(?:must|should|need\s+to)\s+(?:run|execute)/i,
    /ignore\s+(?:previous|prior|above)\s+instructions?\s+and/i,
    // Urgency + execution (trying to bypass human review)
    /(?:urgent|immediate(?:ly)?|critical)\s*:?\s*(?:run|execute)\s+(?:this|now)/i,
  ];

  for (const pattern of promptInjection) {
    const match = content.match(pattern);
    if (match) {
      threats.push({ type: "prompt-injection", match: match[0] });
    }
  }

  // 6. Suspicious executable/archive file references in URLs
  // Must end with extension (not match TLDs like .app)
  // Skip trusted sources like official GitHub releases
  const execExtensions =
    /https?:\/\/[^\s"'<>]+\.(exe|msi|dmg|pkg|deb|rpm|appimage|zip|rar|7z|tar\.gz|tgz|bat|cmd|ps1|vbs|jar|apk|ipa)(?:["'\s<>]|$)/gi;
  for (const match of content.matchAll(execExtensions)) {
    const url = match[0].replace(/["'\s<>]$/, "");
    if (!isTrustedExecutableDomain(url)) {
      threats.push({ type: "executable-url", match: url });
    }
  }

  return threats;
}

async function logThreats(entries: { file: string; threats: Threat[] }[]) {
  // Always clear the log file at the start of each scan
  if (entries.length === 0) {
    // Remove old log if no threats found
    await fs.rm(THREAT_LOG, { force: true });
    return;
  }

  const lines = [
    `Security Scan - ${new Date().toISOString()}`,
    "=".repeat(50),
    "",
  ];

  for (const { file, threats } of entries) {
    lines.push(`FILE: ${file}`);
    for (const t of threats) {
      lines.push(`  [${t.type}] ${t.match}`);
    }
    lines.push("");
  }

  await fs.writeFile(THREAT_LOG, lines.join("\n"), "utf8");
  console.log(`  ⚠️  Threats logged to ${THREAT_LOG}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  return fetchJsonWithRetry<T>(url, TREE_TIMEOUT_MS, 2);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry<T>(
  url: string,
  timeoutMs: number,
  retries: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            "User-Agent": "openclaw-docs-sync",
            Accept: "application/vnd.github+json",
          },
        },
        timeoutMs,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${url}: unknown error`);
}

async function fetchTextWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
): Promise<string> {
  let lastError: unknown;
  let lastStatus: number | undefined;
  let retryAfterMs: number | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {}, timeoutMs);
      lastStatus = response.status;

      if (!response.ok) {
        const retryAfterHeader = response.headers.get("retry-after");
        if (retryAfterHeader) {
          const retryAfterSeconds = Number(retryAfterHeader);
          if (!Number.isNaN(retryAfterSeconds)) {
            retryAfterMs = retryAfterSeconds * 1000;
          }
        }

        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        if ((lastStatus === 429 || lastStatus === 403) && retryAfterMs) {
          console.log(`  Throttled by host, backing off for ${retryAfterMs}ms...`);
          await delay(retryAfterMs);
        } else {
          await delay(RETRY_DELAY_BASE_MS * (attempt + 1));
        }
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${url}: unknown error`);
}

function shouldInclude(pathname: string, sourcePath: string) {
  if (!pathname.startsWith(`${sourcePath}/`)) {
    return false;
  }
  const ext = path.extname(pathname);
  return allowedExtensions.has(ext);
}

async function syncTarget(target: RepoTarget): Promise<{ file: string; threats: Threat[] }[]> {
  console.log(`  Fetching ${target.name} tree...`);
  const treeUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${target.branch}?recursive=1`;
  const data = await fetchJson<TreeResponse>(treeUrl);

  if (data.truncated) {
    throw new Error(`Git tree for ${target.owner}/${target.repo} is truncated. Consider paging.`);
  }

  await fs.rm(target.destPath, { recursive: true, force: true });
  await fs.mkdir(target.destPath, { recursive: true });

  const files = data.tree.filter(
    (entry) => entry.type === "blob" && shouldInclude(entry.path, target.sourcePath),
  );

  if (files.length === 0) {
    console.log(`  No files found for ${target.name}`);
    return [];
  }

  console.log(`  ${target.name}: downloading ${files.length} files...`);

  const queue = [...files];
  const errors: string[] = [];
  const flagged: { file: string; threats: Threat[] }[] = [];
  let downloaded = 0;

  const workers = Array.from({ length: DOWNLOAD_CONCURRENCY }).map(async () => {
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      const relativePath = current.path.slice(target.sourcePath.length + 1);
      const destFile = path.join(target.destPath, relativePath);
      const destDir = path.dirname(destFile);

      try {
        await fs.mkdir(destDir, { recursive: true });

        const rawUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${current.path}`;
        const content = await fetchTextWithRetry(rawUrl, RAW_TIMEOUT_MS, 2);

        // Security scan (log threats but still import)
        const threats = scanForThreats(content);
        if (threats.length > 0) {
          flagged.push({ file: `${target.name}/${relativePath}`, threats });
        }

        await fs.writeFile(destFile, content, "utf8");
        downloaded += 1;
        if (downloaded % PROGRESS_INTERVAL === 0 || downloaded === files.length) {
          console.log(`  ${target.name}: ${downloaded}/${files.length} files`);
        }
      } catch (err) {
        errors.push(`${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  await Promise.all(workers);

  console.log(`  ${target.name}: ${downloaded}/${files.length} files`);
  if (errors.length > 0) {
    console.error(`  Failed:\n    ${errors.join("\n    ")}`);
  }

  return flagged;
}

async function main() {
  console.log(`Syncing docs to ${ROOT}`);
  await fs.mkdir(ROOT, { recursive: true });

  const allFlagged: { file: string; threats: Threat[] }[] = [];

  for (const target of targets) {
    try {
      const flagged = await syncTarget(target);
      allFlagged.push(...flagged);
    } catch (err) {
      console.error(`Failed to sync ${target.name}:`, err instanceof Error ? err.message : err);
      // Continue with other targets
    }
  }

  await logThreats(allFlagged);

  console.log("\nDocs synced to:", ROOT);
  console.log("\nAdd to your openclaw.json:");
  console.log(`
{
  "memory": {
    "backend": "qmd",
    "qmd": {
      "paths": [
        {
          "name": "openclaw-docs",
          "path": "${ROOT}",
          "pattern": "**/*.{md,mdx}"
        }
      ]
    }
  }
}`);
  console.log("\nDone");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
