import fs from "node:fs/promises";
import path from "node:path";
import { globalSkillsDir, projectPaths } from "./paths.js";
import { fetchRepo, repoSpec } from "./repo.js";
import {
  listSkills,
  describe,
  hashDir,
  copySkill,
  readManifest,
  writeManifest,
  readState,
  writeState,
  exists,
  syncOverrides,
  removeOverrides,
} from "./store.js";

const HELP = `spm - install Claude skills from a GitHub repo into a project

Usage:
  spm init [owner/repo[#ref]]   create spm.json, record the skills repo, and hide global
                                skills in this project (only project skills stay)
  spm install <skill...>        add skills to spm.json and copy them into ./.claude/skills
                                (alias: i, add)
  spm install                   recreate .claude/skills from spm.json (like npm install)
  spm uninstall <skill...>      remove skills from the project (alias: rm, remove)
  spm update [skill...]         re-copy installed skills from the repo
  spm list                      skills installed in this project (alias: ls)
  spm available [filter]        skills available in the repo (alias: search)

Options:
  -f, --force    overwrite a skill that already exists locally
  --no-isolate   with init: don't hide global skills (and stop doing so if previously on)
  -h, --help     show this help

Env:
  SPM_REPO         skills repo (owner/repo[#ref], git URL or path); overrides spm.json
  SPM_CACHE_DIR    where repos are cloned (default: ~/.cache/spm)
  SPM_GLOBAL_DIR   global skills folder hidden by isolation (default: ~/.claude/skills)
`;

async function load(p) {
  return { manifest: await readManifest(p.manifest), state: await readState(p.state) };
}

async function save(p, { manifest, state }) {
  await writeManifest(p.manifest, manifest);
  await writeState(p.state, state);
  if (!manifest.isolate) return;
  await syncOverrides({
    settingsFile: p.settings,
    globalDir: globalSkillsDir(),
    localDir: p.skillsDir,
  });
}

async function init(p, { isolate, repo } = {}) {
  await fs.mkdir(p.skillsDir, { recursive: true });
  const cfg = await load(p);
  if (repo) cfg.manifest.repo = repo;
  if (isolate !== undefined) cfg.manifest.isolate = isolate;
  await save(p, cfg);
  if (isolate === false) await removeOverrides(p.settings, globalSkillsDir());
  return cfg.manifest;
}

async function install(names, { force }) {
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;
  const targets = names.length ? names : [...manifest.skills];
  if (!targets.length) return console.log("Nothing to install. Usage: spm install <skill>");

  const spec = repoSpec(manifest);
  const sourceDir = await fetchRepo(spec);
  const available = await listSkills(sourceDir);
  await fs.mkdir(p.skillsDir, { recursive: true });

  for (const name of targets) {
    const src = path.join(sourceDir, name);
    const dest = path.join(p.skillsDir, name);
    if (!available.includes(name)) {
      console.error(`✗ ${name}: not found in ${spec}${suggest(name, available)}`);
      process.exitCode = 1;
      continue;
    }
    if (!manifest.skills.includes(name)) manifest.skills.push(name);
    if ((await exists(dest)) && !force) {
      console.log(`• ${name}: already installed (use --force to overwrite)`);
      state.skills[name] ??= { hash: await hashDir(dest) };
      continue;
    }
    await copySkill(src, dest);
    state.skills[name] = { hash: await hashDir(dest) };
    console.log(`✓ ${name}`);
  }
  await save(p, cfg);
}

async function uninstall(names) {
  if (!names.length) throw new Error("usage: spm uninstall <skill...>");
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;
  for (const name of names) {
    const dest = path.join(p.skillsDir, name);
    if (!(await exists(dest)) && !manifest.skills.includes(name)) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    await fs.rm(dest, { recursive: true, force: true });
    manifest.skills = manifest.skills.filter((n) => n !== name);
    delete state.skills[name];
    console.log(`✓ removed ${name}`);
  }
  await save(p, cfg);
}

async function update(names) {
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;
  const targets = names.length ? names : manifest.skills;
  if (!targets.length) return console.log("No skills installed in this project.");
  const sourceDir = await fetchRepo(repoSpec(manifest));
  for (const name of targets) {
    const src = path.join(sourceDir, name);
    const dest = path.join(p.skillsDir, name);
    if (!manifest.skills.includes(name)) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    if (!(await exists(src))) {
      console.error(`✗ ${name}: no longer in the repo`);
      process.exitCode = 1;
      continue;
    }
    const repoHash = await hashDir(src);
    const localHash = (await exists(dest)) ? await hashDir(dest) : null;
    if (repoHash === localHash) {
      state.skills[name] = { hash: repoHash };
      console.log(`• ${name}: up to date`);
      continue;
    }
    const edited = localHash && localHash !== state.skills[name]?.hash;
    await copySkill(src, dest);
    state.skills[name] = { hash: repoHash };
    console.log(`✓ ${name}: updated${edited ? " (local edits overwritten)" : ""}`);
  }
  await save(p, cfg);
}

async function list() {
  const p = projectPaths();
  const local = await listSkills(p.skillsDir);
  if (!local.length) return console.log("No skills installed in this project.");
  const { state } = await load(p);
  for (const name of local) {
    const tracked = state.skills[name];
    const flag = !tracked
      ? " (untracked)"
      : tracked.hash !== (await hashDir(path.join(p.skillsDir, name)))
        ? " (modified)"
        : "";
    console.log(`${name}${flag}`);
  }
}

async function available(filter) {
  const p = projectPaths();
  const spec = repoSpec((await load(p)).manifest);
  const dir = await fetchRepo(spec);
  const all = (await listSkills(dir)).filter((n) => !filter || n.includes(filter.toLowerCase()));
  if (!all.length) {
    return console.log(`No skills found in ${spec}${filter ? ` matching "${filter}"` : ""}.`);
  }
  const width = Math.max(...all.map((n) => n.length));
  for (const name of all) {
    const desc = (await describe(path.join(dir, name))).slice(0, 80);
    console.log(`${name.padEnd(width)}  ${desc}`);
  }
}

function suggest(name, available) {
  const close = available.filter((a) => a.includes(name) || name.includes(a)).slice(0, 3);
  return close.length ? `\n  did you mean: ${close.join(", ")}?` : "";
}

export async function run(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const [cmd, ...rest] = argv.filter((a) => !a.startsWith("-"));
  const force = flags.has("-f") || flags.has("--force");

  if (!cmd || flags.has("-h") || flags.has("--help") || cmd === "help") return console.log(HELP);

  switch (cmd) {
    case "init": {
      const isolate = !flags.has("--no-isolate");
      const p = projectPaths();
      const { repo } = await init(p, { isolate, repo: rest[0] });
      if (!repo && !process.env.SPM_REPO) {
        console.log("Tip: set the skills repo with `spm init <owner/repo>`");
      }
      return console.log(
        isolate
          ? "Initialized spm.json and .claude/skills; global skills are hidden for this project (.claude/settings.json)"
          : "Initialized spm.json and .claude/skills",
      );
    }
    case "install":
    case "i":
    case "add":
      return install(rest, { force });
    case "uninstall":
    case "remove":
    case "rm":
      return uninstall(rest);
    case "update":
    case "up":
      return update(rest);
    case "list":
    case "ls":
      return list();
    case "available":
    case "search":
      return available(rest[0]);
    default:
      throw new Error(`unknown command "${cmd}". Run spm --help`);
  }
}
