import fs from "fs/promises";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "docs");

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

async function syncTarget(target: RepoTarget) {
  const treeUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${target.branch}?recursive=1`;
  const data = await fetchJson<TreeResponse>(treeUrl);

  if (data.truncated) {
    throw new Error(`Git tree for ${target.owner}/${target.repo} is truncated. Consider paging.`);
  }

  await fs.rm(target.destPath, { recursive: true, force: true });
  await fs.mkdir(target.destPath, { recursive: true });
  await fs.writeFile(path.join(target.destPath, ".gitkeep"), "keep\n", "utf8");

  const files = data.tree.filter(
    (entry) => entry.type === "blob" && shouldInclude(entry.path, target.sourcePath),
  );

  const concurrency = 8;
  let index = 0;

  const workers = Array.from({ length: concurrency }).map(async () => {
    while (index < files.length) {
      const current = files[index];
      index += 1;

      const relativePath = current.path.slice(target.sourcePath.length + 1);
      const destFile = path.join(target.destPath, relativePath);
      const destDir = path.dirname(destFile);

      await fs.mkdir(destDir, { recursive: true });

      const rawUrl = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${current.path}`;
      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(`Failed to download ${rawUrl}: ${response.status} ${response.statusText}`);
      }
      const content = await response.text();
      await fs.writeFile(destFile, content, "utf8");
    }
  });

  await Promise.all(workers);
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
  await fs.mkdir(ROOT, { recursive: true });

  for (const target of targets) {
    await syncTarget(target);
  }

  await runQmd();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
