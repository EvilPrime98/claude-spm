import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { listSkills, skillNames, exists } from "./store.js";

const STOPWORDS = new Set(
  "the and for with this that use used using when user users you your from into any not are can has have will its it's all also than then them their there these those such only other more most some what which who how why where about over under after before while should would could may might must does did done being been was were out off per via etc".split(
    " ",
  ),
);
const OVERLAP_THRESHOLD = 0.45;
const GLOBAL_NOISE_TOKENS = 500;

/**
 * Estimates the tokens in a text as `chars / 4`, rounded up.
 *
 * @param {string} text Text to measure.
 * @returns {number} Approximate token count.
 */
export const estimateTokens = (text) => Math.ceil(text.length / 4);

const terms = (text) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

/**
 * Scores how much skill descriptions say the same thing, by TF-IDF cosine similarity.
 *
 * @param {{name: string, text: string}[]} docs Skill names and the text to compare (description and trigger phrases).
 * @returns {{a: string, b: string, score: number}[]} Pairs scoring at least 0.45, highest first.
 */
export function findOverlaps(docs) {
  const tokens = docs.map((d) => terms(d.text));
  const df = new Map();
  for (const ts of tokens) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  const vectors = tokens.map((ts) => {
    const v = new Map();
    for (const t of ts) v.set(t, (v.get(t) ?? 0) + 1);
    for (const [t, n] of v) v.set(t, n * Math.log(1 + docs.length / df.get(t)));
    return { v, norm: Math.hypot(...v.values()) };
  });
  const pairs = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const [x, y] = [vectors[i], vectors[j]];
      if (!x.norm || !y.norm) continue;
      let dot = 0;
      for (const [t, w] of x.v) dot += w * (y.v.get(t) ?? 0);
      const score = dot / (x.norm * y.norm);
      if (score >= OVERLAP_THRESHOLD) pairs.push({ a: docs[i].name, b: docs[j].name, score });
    }
  }
  return pairs.sort((p, q) => q.score - p.score);
}

/**
 * Splits a `SKILL.md` into its always-loaded front matter fields and the rest.
 *
 * @param {string} text Contents of a `SKILL.md`.
 * @returns {{name: string, description: string, body: string}} Fields; missing ones are empty strings.
 */
export function parseSkill(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const front = m?.[1] ?? "";
  const field = (key) => {
    const m = front.match(new RegExp(`^${key}:[ \\t]*(.*)$((?:\\r?\\n[ \\t]+.*)*)`, "m"));
    if (!m) return "";
    const first = /^[>|][+-]?$/.test(m[1].trim()) ? "" : m[1];
    const text = [first, ...m[2].split(/\r?\n/)]
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    return text.replace(/^["']|["']$/g, "");
  };
  return {
    name: field("name"),
    description: field("description"),
    body: text.slice(m?.[0].length ?? 0),
  };
}

/**
 * Maps a project directory to its Claude Code transcript folder name (every non-alphanumeric becomes `-`).
 *
 * @param {string} cwd Project root.
 * @returns {string} Folder name under `~/.claude/projects`.
 */
export const transcriptFolder = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const skillKey = (name) => name.replace(/^\//, "").split(":").pop();

/**
 * Counts skill invocations in the project's Claude Code transcripts.
 *
 * Counts `Skill` tool calls and `/skill` slash commands newer than the window. Reads only, locally; transcripts of sub-folders of the project are not included.
 *
 * @param {string} cwd Project root.
 * @param {Object} [options] Options.
 * @param {number} [options.days=60] Size of the window in days.
 * @param {string} [options.projectsDir] Transcripts root (default `~/.claude/projects`).
 * @param {number} [options.now] Current time in ms.
 * @returns {Promise<{counts: Map<string, number>, files: number}>} Invocations per skill name, and transcripts read.
 */
export async function usageCounts(cwd, { days = 60, projectsDir, now = Date.now() } = {}) {
  const root =
    projectsDir ??
    path.join(process.env.SPM_CLAUDE_DIR ?? path.join(os.homedir(), ".claude"), "projects");
  const dir = path.join(root, transcriptFolder(cwd));
  const counts = new Map();
  if (!(await exists(dir))) return { counts, files: 0 };
  const cutoff = now - days * 86_400_000;
  const bump = (name) => counts.set(skillKey(name), (counts.get(skillKey(name)) ?? 0) + 1);
  let files = 0;
  for (const f of await fs.readdir(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const file = path.join(dir, f);
    if ((await fs.stat(file)).mtimeMs < cutoff) continue;
    files++;
    const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"Skill"') && !line.includes("<command-name>")) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.timestamp && Date.parse(entry.timestamp) < cutoff) continue;
      const content = entry.message?.content;
      if (entry.type === "assistant" && Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_use" && b.name === "Skill" && b.input?.skill) bump(b.input.skill);
        }
      } else if (entry.type === "user") {
        const text = typeof content === "string" ? content : (content?.[0]?.text ?? "");
        const cmd = text.match(/<command-name>([^<]+)<\/command-name>/)?.[1];
        if (cmd) bump(cmd);
      }
    }
  }
  return { counts, files };
}

async function scan(dir, source, offNames) {
  const found = [];
  for (const folder of await listSkills(dir)) {
    const names = await skillNames(dir, folder);
    if (source === "global" && [...names].some((n) => offNames.has(n))) continue;
    const text = await fs.readFile(path.join(dir, folder, "SKILL.md"), "utf8");
    const { name, description, body } = parseSkill(text);
    found.push({
      name: folder,
      names,
      source,
      description,
      descriptionTokens: estimateTokens(`${name || folder} ${description}`),
      bodyTokens: estimateTokens(body),
      text: `${description} ${name || folder}`,
    });
  }
  return found;
}

/**
 * Builds the context cost report for everything Claude would see in the project.
 *
 * Covers skills declared in the manifest (`spm`), hand-written ones in `.claude/skills` (`project`), and global skills not turned off by the project's overrides (`global`). A skill is flagged when it was never used in the window, or when it overlaps a skill that is used more.
 *
 * @param {Object} input Inputs.
 * @param {{skills: Object, isolate?: boolean}} input.manifest The project manifest.
 * @param {string} input.skillsDir Project skills directory.
 * @param {string} input.globalDir Global skills directory.
 * @param {Object<string, string>} [input.overrides] The project's `skillOverrides`.
 * @param {Map<string, number>} input.counts Invocations per skill name.
 * @param {boolean} input.hasUsage Whether any transcripts were read; without them nothing is flagged as unused.
 * @returns {Promise<{skills: Object[], overlaps: Object[], totals: {description: number, body: number}, advice: string[]}>} The report; skills are ranked by cost.
 */
export async function buildReport({
  manifest,
  skillsDir,
  globalDir,
  overrides = {},
  counts,
  hasUsage,
}) {
  const off = new Set(Object.keys(overrides).filter((n) => overrides[n] === "off"));
  const local = await scan(skillsDir, "project", off);
  for (const s of local) if (s.name in manifest.skills) s.source = "spm";
  const shadowed = new Set(local.flatMap((s) => [...s.names]));
  const global = (await scan(globalDir, "global", off)).filter(
    (s) => ![...s.names].some((n) => shadowed.has(n)),
  );
  const skills = [...local, ...global];
  for (const s of skills) {
    s.uses = Math.max(0, ...[...s.names].map((n) => counts.get(n) ?? 0));
    s.overlaps = [];
    s.reasons = [];
  }
  const overlaps = findOverlaps(skills.map((s) => ({ name: s.name, text: s.text })));
  const byName = new Map(skills.map((s) => [s.name, s]));
  for (const { a, b, score } of overlaps) {
    const [x, y] = [byName.get(a), byName.get(b)];
    x.overlaps.push({ with: b, score });
    y.overlaps.push({ with: a, score });
    const loser =
      x.uses === y.uses
        ? x.descriptionTokens + x.bodyTokens >= y.descriptionTokens + y.bodyTokens
          ? x
          : y
        : x.uses < y.uses
          ? x
          : y;
    const winner = loser === x ? y : x;
    loser.reasons.push(`overlaps ${winner.name} (${Math.round(score * 100)}%)`);
  }
  if (hasUsage) for (const s of skills) if (!s.uses) s.reasons.unshift("unused");
  for (const s of skills) s.flagged = s.reasons.length > 0;
  skills.sort((p, q) => q.descriptionTokens + q.bodyTokens - (p.descriptionTokens + p.bodyTokens));
  const totals = {
    description: skills.reduce((n, s) => n + s.descriptionTokens, 0),
    body: skills.reduce((n, s) => n + s.bodyTokens, 0),
  };
  const advice = [];
  const globalTokens = global.reduce((n, s) => n + s.descriptionTokens, 0);
  if (
    !manifest.isolate &&
    globalTokens >= GLOBAL_NOISE_TOKENS &&
    globalTokens > totals.description / 2
  ) {
    advice.push(
      `Global skills add ~${globalTokens} tokens to every session here. Run \`spm init\` to hide them in this project.`,
    );
  }
  return { skills, overlaps, totals, advice };
}

/**
 * Formats the report as a table.
 *
 * @param {Awaited<ReturnType<typeof buildReport>>} report Result of `buildReport`.
 * @param {{days: number, files: number}} usage Window and number of transcripts read.
 * @returns {string} Multi-line text.
 */
export function formatReport(report, { days, files }) {
  const { skills, totals, advice } = report;
  if (!skills.length) return "No skills visible in this project.";
  const rows = skills.map((s) => [
    s.name,
    s.source,
    `~${s.descriptionTokens}`,
    `~${s.bodyTokens}`,
    files ? String(s.uses) : "-",
    s.reasons.join(", "),
  ]);
  const head = ["skill", "source", "always", "on use", `uses/${days}d`, "flags"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) =>
    r
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const out = [line(head), ...rows.map(line)];
  out.push(
    "",
    `Always loaded: ~${totals.description} tokens (descriptions). On use: up to ~${totals.body} more (bodies). Estimates: chars/4.`,
  );
  if (!files)
    out.push(
      `No transcripts found for this project, so usage is unknown (nothing flagged as unused).`,
    );
  out.push(...advice);
  return out.join("\n");
}

/**
 * Turns off global skills in the project's settings (`skillOverrides: "off"`).
 *
 * @param {string} settingsFile Path to the project's `settings.json`.
 * @param {string[]} names Global skill names to turn off.
 * @returns {Promise<void>}
 * @throws {Error} If the settings file exists but cannot be parsed.
 */
export async function disableGlobal(settingsFile, names) {
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`could not parse ${settingsFile}: ${e.message}`);
  }
  settings.skillOverrides = {
    ...settings.skillOverrides,
    ...Object.fromEntries(names.map((n) => [n, "off"])),
  };
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
}

/**
 * Reads `skillOverrides` from the project's settings.
 *
 * @param {string} settingsFile Path to the project's `settings.json`.
 * @returns {Promise<Object<string, string>>} The overrides; empty if the file is missing or unreadable.
 */
export async function readOverrides(settingsFile) {
  try {
    return JSON.parse(await fs.readFile(settingsFile, "utf8")).skillOverrides ?? {};
  } catch {
    return {};
  }
}
