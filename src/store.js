import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Checks whether a path is accessible.
 *
 * @param {string} p Path to check.
 * @returns {Promise<boolean>} `true` if the path exists, `false` otherwise.
 */
export const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/**
 * Lists the skill folders directly inside a directory.
 *
 * A skill is a non-hidden directory (or symlink) containing a `SKILL.md` file.
 *
 * @param {string} dir Directory to scan; a missing directory yields an empty list.
 * @returns {Promise<string[]>} Sorted skill folder names.
 */
export async function listSkills(dir) {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const found = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || !(e.isDirectory() || e.isSymbolicLink())) continue;
    if (await exists(path.join(dir, e.name, "SKILL.md"))) found.push(e.name);
  }
  return found.sort();
}

const SKIP = new Set(["node_modules", "dist", "build"]);
const MAX_DEPTH = 6;

// Map of skill name -> directory, found in `root` itself and in any `skills/` folder
// at any depth. Shallowest match wins when names collide.
/**
 * Finds skills in a directory and in any `skills/` folder below it.
 *
 * A directory that is itself a skill (has its own `SKILL.md`) is a single-skill repo: it is returned alone, named by its front matter `name` or else `rootName`.
 *
 * Skips hidden folders, `node_modules`, `dist` and `build`, and searches up to 6 levels deep. The shallowest match wins when names collide.
 *
 * @param {string} root Directory to search.
 * @param {string} [rootName] Name for `root` when it is itself a skill and declares no usable name.
 * @returns {Promise<Map<string, string>>} Map of skill name to its directory.
 */
export async function findSkills(root, rootName) {
  const found = new Map();
  if (await exists(path.join(root, "SKILL.md"))) {
    const declared = (await readName(root)) ?? "";
    const name = /^[\w.-]+$/.test(declared) ? declared : rootName;
    return name ? found.set(name, root) : found;
  }
  const add = async (dir) => {
    for (const name of await listSkills(dir)) {
      if (!found.has(name)) found.set(name, path.join(dir, name));
    }
  };
  await add(root);
  let level = [root];
  for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
    const next = [];
    for (const dir of level) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (await exists(path.join(full, "SKILL.md"))) continue;
        if (e.name === "skills") await add(full);
        next.push(full);
      }
    }
    level = next;
  }
  return found;
}

async function readName(dir) {
  const text = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
  return text
    .match(/^name:\s*(.+)$/m)?.[1]
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Reads the `description` field from a skill's `SKILL.md` front matter.
 *
 * @param {string} skillDir Skill directory.
 * @returns {Promise<string>} The description, or an empty string if none is found.
 */
export async function describe(skillDir) {
  const text = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const m = text.match(/^description:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/**
 * Collects the names a skill is known by.
 *
 * Includes the folder name and, when present, the `name` field in `SKILL.md`.
 *
 * @param {string} dir Directory containing skill folders.
 * @param {string} folder Skill folder name inside `dir`.
 * @returns {Promise<Set<string>>} Set of names.
 */
export async function skillNames(dir, folder) {
  const names = new Set([folder]);
  const name = await readName(path.join(dir, folder));
  if (name) names.add(name);
  return names;
}

/**
 * Computes a content hash of a directory tree.
 *
 * Covers relative file paths and file contents, in sorted order, ignoring `.git` folders.
 *
 * @param {string} dir Directory to hash.
 * @returns {Promise<string>} First 16 hex characters of the SHA-256 digest.
 */
export async function hashDir(dir) {
  const h = crypto.createHash("sha256");
  const walk = async (d) => {
    const entries = (await fs.readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      if (e.name === ".git") continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        h.update(path.relative(dir, full).replaceAll("\\", "/"));
        h.update(await fs.readFile(full));
      }
    }
  };
  await walk(dir);
  return h.digest("hex").slice(0, 16);
}

/**
 * Copies a skill directory to a destination, replacing anything already there.
 *
 * Symlinks are dereferenced and `.git` folders are left out.
 *
 * @param {string} src Source skill directory.
 * @param {string} dest Destination directory.
 * @returns {Promise<void>}
 */
export async function copySkill(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, {
    recursive: true,
    dereference: true,
    filter: (file) => path.basename(file) !== ".git",
  });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(`could not parse ${file}: ${e.message}`);
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Reads the `spm.json` manifest.
 *
 * A missing file yields an empty manifest. The legacy format (`repo` string and `skills` array) is migrated: `repo` joins `repos`, and every listed skill is pinned to it.
 *
 * @param {string} file Path to the manifest.
 * @returns {Promise<{repos: string[], skills: Object<string, (string|{repo: string, ref?: string, market?: string}|null)>}>} The manifest; `skills` maps each name to the repo it came from, or to `{repo, ref, market}` for a market install.
 * @throws {Error} If the file cannot be parsed.
 */
export async function readManifest(file) {
  const { repo, repos, skills, ...rest } = await readJson(file, {});
  const pool = [...new Set([...(repo ? [repo] : []), ...(repos ?? [])])];
  const pinned = Array.isArray(skills)
    ? Object.fromEntries(skills.map((n) => [n, pool[0] ?? null]))
    : (skills ?? {});
  return { ...rest, repos: pool, skills: sortKeys(pinned) };
}

/**
 * Writes the manifest to disk with deduplicated repos and skills sorted by name.
 *
 * @param {string} file Path to the manifest.
 * @param {{repos: string[], skills: Object<string, (string|{repo: string, ref?: string, market?: string}|null)>}} manifest Manifest to write.
 * @returns {Promise<void>}
 */
export const writeManifest = (file, manifest) =>
  writeJson(file, {
    repos: [...new Set(manifest.repos)],
    skills: sortKeys(manifest.skills),
    ...Object.fromEntries(
      Object.entries(manifest).filter(([k]) => !["repos", "skills"].includes(k)),
    ),
  });

/**
 * Reads the spm state file.
 *
 * A missing file yields an empty state.
 *
 * @param {string} file Path to the state file.
 * @returns {Promise<{skills: Object<string, *>}>} The state.
 * @throws {Error} If the file cannot be parsed.
 */
export async function readState(file) {
  const s = await readJson(file, {});
  return { skills: s.skills ?? {} };
}

/**
 * Writes the state file with skill entries sorted by name.
 *
 * @param {string} file Path to the state file.
 * @param {{skills: Object<string, *>}} state State to write.
 * @returns {Promise<void>}
 */
export const writeState = (file, state) =>
  writeJson(file, {
    skills: Object.fromEntries(Object.entries(state.skills).sort(([a], [b]) => a.localeCompare(b))),
  });

/**
 * Updates `skillOverrides` in the project's settings so global skills are hidden.
 *
 * Each global skill name is set to `"off"` unless a local skill has the same name, in which case an existing `"off"` is removed.
 *
 * @param {Object} options Options.
 * @param {string} options.settingsFile Path to the project's `settings.json`.
 * @param {string} options.globalDir Global skills directory.
 * @param {string} options.localDir Project skills directory.
 * @returns {Promise<void>}
 * @throws {Error} If the settings file exists but cannot be parsed.
 */
export async function syncOverrides({ settingsFile, globalDir, localDir }) {
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`could not parse ${settingsFile}: ${e.message}`);
  }
  const keep = new Set();
  for (const folder of await listSkills(localDir)) {
    for (const n of await skillNames(localDir, folder)) keep.add(n);
  }
  const overrides = { ...settings.skillOverrides };
  for (const folder of await listSkills(globalDir)) {
    for (const n of await skillNames(globalDir, folder)) {
      if (keep.has(n)) {
        if (overrides[n] === "off") delete overrides[n];
      } else overrides[n] = "off";
    }
  }
  settings.skillOverrides = overrides;
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
}

/**
 * Removes the `"off"` overrides that hide global skills from the project's settings.
 *
 * Does nothing if the settings file is missing, unparseable, or has no `skillOverrides`. Drops `skillOverrides` entirely when it ends up empty.
 *
 * @param {string} settingsFile Path to the project's `settings.json`.
 * @param {string} globalDir Global skills directory.
 * @returns {Promise<void>}
 */
export async function removeOverrides(settingsFile, globalDir) {
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch {
    return;
  }
  if (!settings.skillOverrides) return;
  for (const folder of await listSkills(globalDir)) {
    for (const n of await skillNames(globalDir, folder)) {
      if (settings.skillOverrides[n] === "off") delete settings.skillOverrides[n];
    }
  }
  if (!Object.keys(settings.skillOverrides).length) delete settings.skillOverrides;
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
}
