import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

const CODE_EXT = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".py",
  ".rb",
  ".pl",
  ".php",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".jar",
  ".bin",
]);
const LISTED = 25;

/**
 * Inventories a skill folder for the pre-install review.
 *
 * Flags symlinks, scripts and binaries (by extension, a `scripts/` folder, or a NUL byte), and an `allowed-tools` entry in `SKILL.md`.
 *
 * @param {string} dir Skill directory.
 * @returns {Promise<{files: {path: string, size: number}[], size: number, flags: string[], symlinks: string[]}>} Files (relative, `/`-separated), total size, risk flags and the symlinks found.
 */
export async function inspectSkill(dir) {
  const files = [];
  const flags = [];
  const symlinks = [];
  const walk = async (d) => {
    const entries = (await fs.readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      if (e.name === ".git") continue;
      const full = path.join(d, e.name);
      const rel = path.relative(dir, full).replaceAll("\\", "/");
      if (e.isSymbolicLink()) symlinks.push(rel);
      else if (e.isDirectory()) await walk(full);
      else {
        files.push({ path: rel, size: (await fs.stat(full)).size });
        if (await isExecutable(full, rel)) flags.push(`script or binary: ${rel}`);
      }
    }
  };
  await walk(dir);
  for (const rel of symlinks) flags.push(`symlink: ${rel}`);
  const skillMd = await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => "");
  const front = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const tools = front.match(/^allowed-tools:\s*(.*)$/m);
  if (tools) flags.push(`allowed-tools: ${tools[1].trim() || "(list)"}`);
  const size = files.reduce((n, f) => n + f.size, 0);
  return { files, size, flags, symlinks };
}

async function isExecutable(full, rel) {
  if (CODE_EXT.has(path.extname(rel).toLowerCase()) || rel.split("/").includes("scripts")) {
    return true;
  }
  const fh = await fs.open(full, "r");
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(4096), 0, 4096, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/**
 * Formats the review screen for a skill about to be installed.
 *
 * @param {Object} info What is being installed.
 * @param {string} info.name Skill name.
 * @param {string} info.repo Source repo spec.
 * @param {string} info.sha Commit the skill was read at.
 * @param {string} info.hash Content hash that will be stored in the state file.
 * @param {string} [info.market] Market it was found on.
 * @param {string} [info.from] Commit currently installed, when this is an update.
 * @param {Awaited<ReturnType<typeof inspectSkill>>} report Result of `inspectSkill`.
 * @returns {string} Multi-line text.
 */
export function formatReview({ name, repo, sha, hash, market, from }, report) {
  const lines = [`Review ${name}${market ? ` (from ${market})` : ""}`, `  source  ${repo}`];
  lines.push(`  commit  ${from ? `${from.slice(0, 12)} -> ` : ""}${sha}`);
  lines.push(`  hash    ${hash}`);
  lines.push(`  files   ${report.files.length} (${kb(report.size)})`);
  for (const f of report.files.slice(0, LISTED)) lines.push(`    ${f.path}  ${kb(f.size)}`);
  if (report.files.length > LISTED) lines.push(`    ... ${report.files.length - LISTED} more`);
  if (report.flags.length) {
    lines.push("  ! beyond plain instructions:");
    for (const flag of report.flags) lines.push(`    ${flag}`);
  }
  return lines.join("\n");
}

/**
 * Asks a yes/no question on the terminal.
 *
 * @param {string} question Prompt text.
 * @returns {Promise<boolean>} `true` only for an answer starting with "y".
 * @throws {Error} If stdin is not a terminal; callers must then pass `--yes`.
 */
export async function confirm(question) {
  if (!process.stdin.isTTY) {
    throw new Error("confirmation needed but stdin is not a terminal (pass --yes to skip)");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}
