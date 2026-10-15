import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

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

export async function describe(skillDir) {
  const text = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const m = text.match(/^description:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

export async function skillNames(dir, folder) {
  const names = new Set([folder]);
  const text = await fs.readFile(path.join(dir, folder, "SKILL.md"), "utf8");
  const m = text.match(/^name:\s*(.+)$/m);
  if (m) names.add(m[1].trim().replace(/^["']|["']$/g, ""));
  return names;
}

export async function hashDir(dir) {
  const h = crypto.createHash("sha256");
  const walk = async (d) => {
    const entries = (await fs.readdir(d, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
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

export async function copySkill(src, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true, dereference: true });
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

export async function readManifest(file) {
  const m = await readJson(file, {});
  return { ...m, skills: [...new Set(m.skills ?? [])].sort() };
}

export const writeManifest = (file, manifest) =>
  writeJson(file, { ...manifest, skills: [...new Set(manifest.skills)].sort() });

export async function readState(file) {
  const s = await readJson(file, {});
  return { skills: s.skills ?? {} };
}

export const writeState = (file, state) =>
  writeJson(file, {
    skills: Object.fromEntries(Object.entries(state.skills).sort(([a], [b]) => a.localeCompare(b))),
  });

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
