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
    destPath: ROOT,
  },
  {
    name: "clawhub-docs",
    owner: "openclaw",
    repo: "clawhub",
    branch: "main",
    sourcePath: "docs",
    destPath: path.join(ROOT, "clawdhub"),
  },
  {
    name: "skills-repo",
    owner: "openclaw",
    repo: "skills",
    branch: "main",
    sourcePath: "skills",
    destPath: path.join(ROOT, "skills"),
  },
];

const allowedExtensions = new Set([".md", ".mdx"]);

// Security: Detect supply chain attack patterns (prompt injection, malicious payloads)
type Threat = { type: string; match: string };
const THREAT_LOG = path.resolve(ROOT, "..", "security-scan.log");

function scanForThreats(content: string): Threat[] {
  const threats: Threat[] = [];

  // 1. Base64 decoded and piped to shell execution
  const base64Exec = /base64\s+(-[dD]|--decode)\s*\|?\s*(bash|sh|zsh)/gi;
  for (const match of content.matchAll(base64Exec)) {
    threats.push({ type: "base64-exec", match: match[0] });
  }

  // 2. Curl/wget piped directly to shell (the classic dropper)
  const pipeToShell = /(curl|wget)\s+[^|]*\|\s*(bash|sh|zsh)/gi;
  for (const match of content.matchAll(pipeToShell)) {
    threats.push({ type: "pipe-to-shell", match: match[0] });
  }

  // 3. Command substitution with curl/wget (executes the downloaded content)
  const cmdSubstitution = /\$\(\s*(curl|wget)\s+[^)]+\)/gi;
  for (const match of content.matchAll(cmdSubstitution)) {
    threats.push({ type: "cmd-substitution", match: match[0] });
  }

  // 4. Raw IP addresses in URLs (legitimate services use domains)
  const rawIpUrl = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/gi;
  for (const match of content.matchAll(rawIpUrl)) {
    threats.push({ type: "raw-ip-url", match: match[0] });
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

  return threats;
}

async function logThreats(entries: { file: string; threats: Threat[] }[]) {
  if (entries.length === 0) return;

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
  const response = await fetch(url, {
    headers: {
      "User-Agent": "openclaw-docs-sync",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function shouldInclude(pathname: string, sourcePath: string) {
  if (!pathname.startsWith(`${sourcePath}/`)) {
    return false;
  }
  const ext = path.extname(pathname);
  return allowedExtensions.has(ext);
}

async function syncTarget(target: RepoTarget): Promise<{ file: string; threats: Threat[] }[]> {
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

  const queue = [...files];
  const errors: string[] = [];
  const flagged: { file: string; threats: Threat[] }[] = [];
  let downloaded = 0;

  const concurrency = 8;
  const workers = Array.from({ length: concurrency }).map(async () => {
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      const relativePath = current.path.slice(target.sourcePath.length + 1);
      const destFile = path.join(target.destPath, relativePath);
      const destDir = path.dirname(destFile);

      try {
        await fs.mkdir(destDir, { recursive: true });

        const rawUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${current.path}`;
        const response = await fetch(rawUrl);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const content = await response.text();

        // Security scan (log threats but still import)
        const threats = scanForThreats(content);
        if (threats.length > 0) {
          flagged.push({ file: `${target.name}/${relativePath}`, threats });
        }

        await fs.writeFile(destFile, content, "utf8");
        downloaded += 1;
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

async function runQmd() {
  const collectionName = "openclaw-docs";
  const mask = "**/*.{md,mdx}";

  await runCommand(
    "qmd",
    ["collection", "add", ROOT, "--name", collectionName, "--mask", mask],
    true,
  );
  await runCommand("qmd", ["embed", "-f"], true);
}

async function runCommand(
  command: string,
  args: (string | number)[],
  inheritOutput = false,
) {
  const { spawn } = await import("child_process");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args.map(String), {
      stdio: inheritOutput ? "inherit" : "pipe",
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
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

  console.log("Building collection...");
  await runQmd();
  console.log("Done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
