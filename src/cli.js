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
  exists,
  syncOverrides,
  removeOverrides,
} from "./store.js";

const HELP = `spm - install Claude skills from a GitHub repo into a project

Usage:
  spm init [owner/repo[#ref]]   set up .claude/skills, record the skills repo, and hide
                                global skills in this project (only project skills stay)
  spm install <skill...>        copy skills into ./.claude/skills (alias: i, add)
  spm install                   install every skill listed in .claude/skills.json
  spm uninstall <skill...>      remove skills from the project (alias: rm, remove)
  spm update [skill...]         re-copy installed skills from the repo
  spm list                      skills installed in this project (alias: ls)
  spm available [filter]        skills available in the repo (alias: search)

Options:
  -f, --force    overwrite a skill that already exists locally
  --no-isolate   with init: don't hide global skills (and stop doing so if previously on)
  -h, --help     show this help

Env:
  SPM_REPO         skills repo (owner/repo[#ref], git URL or path); overrides skills.json
  SPM_CACHE_DIR    where repos are cloned (default: ~/.cache/spm)
  SPM_GLOBAL_DIR   global skills folder hidden by isolation (default: ~/.claude/skills)
`;

async function init(p, { isolate, repo } = {}) {
  await fs.mkdir(p.skillsDir, { recursive: true });
  const manifest = await readManifest(p.manifest);
  if (repo) manifest.repo = repo;
  if (isolate !== undefined) manifest.isolate = isolate;
  await writeManifest(p.manifest, manifest);
  if (isolate === false) await removeOverrides(p.settings, globalSkillsDir());
  else if (manifest.isolate) await sync(p, manifest);
}

async function sync(p, manifest) {
  if (!manifest.isolate) return;
  await syncOverrides({
    settingsFile: p.settings,
    globalDir: globalSkillsDir(),
    localDir: p.skillsDir,
  });
}

async function install(names, { force }) {
  const p = projectPaths();
  const manifest = await readManifest(p.manifest);
  const targets = names.length ? names : Object.keys(manifest.skills);
  if (!targets.length) return console.log("Nothing to install. Usage: spm install <skill>");

  const spec = repoSpec(manifest);
  const sourceDir = await fetchRepo(spec);
  const available = await listSkills(sourceDir);
  await init(p);

  for (const name of targets) {
    const src = path.join(sourceDir, name);
    const dest = path.join(p.skillsDir, name);
    if (!available.includes(name)) {
      console.error(`✗ ${name}: not found in ${spec}${suggest(name, available)}`);
      process.exitCode = 1;
      continue;
    }
    if ((await exists(dest)) && !force) {
      console.log(`• ${name}: already installed (use --force to overwrite)`);
      manifest.skills[name] ??= { hash: await hashDir(dest) };
      continue;
    }
    await copySkill(src, dest);
    manifest.skills[name] = { hash: await hashDir(dest) };
    console.log(`✓ ${name}`);
  }
  await writeManifest(p.manifest, manifest);
  await sync(p, manifest);
}

async function uninstall(names) {
  if (!names.length) throw new Error("usage: spm uninstall <skill...>");
  const p = projectPaths();
  const manifest = await readManifest(p.manifest);
  for (const name of names) {
    const dest = path.join(p.skillsDir, name);
    if (!(await exists(dest)) && !manifest.skills[name]) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    await fs.rm(dest, { recursive: true, force: true });
    delete manifest.skills[name];
    console.log(`✓ removed ${name}`);
  }
  await writeManifest(p.manifest, manifest);
  await sync(p, manifest);
}

async function update(names) {
  const p = projectPaths();
  const manifest = await readManifest(p.manifest);
  const targets = names.length ? names : Object.keys(manifest.skills);
  if (!targets.length) return console.log("No skills installed in this project.");
  const sourceDir = await fetchRepo(repoSpec(manifest));
  for (const name of targets) {
    const src = path.join(sourceDir, name);
    const dest = path.join(p.skillsDir, name);
    if (!manifest.skills[name]) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    if (!(await exists(src))) {
      console.error(`✗ ${name}: no longer in the repo`);
      process.exitCode = 1;
      continue;
    }
    const globalHash = await hashDir(src);
    const localHash = (await exists(dest)) ? await hashDir(dest) : null;
    if (globalHash === localHash) {
      console.log(`• ${name}: up to date`);
      continue;
    }
    const edited = localHash && localHash !== manifest.skills[name].hash;
    await copySkill(src, dest);
    manifest.skills[name] = { hash: globalHash };
    console.log(`✓ ${name}: updated${edited ? " (local edits overwritten)" : ""}`);
  }
  await writeManifest(p.manifest, manifest);
  await sync(p, manifest);
}

async function list() {
  const p = projectPaths();
  const local = await listSkills(p.skillsDir);
  if (!local.length) return console.log("No skills installed in this project.");
  const manifest = await readManifest(p.manifest);
  for (const name of local) {
    const tracked = manifest.skills[name];
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
  const spec = repoSpec(await readManifest(p.manifest));
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
      await init(p, { isolate, repo: rest[0] });
      const { repo } = await readManifest(p.manifest);
      if (!repo && !process.env.SPM_REPO) {
        console.log("Tip: set the skills repo with `spm init <owner/repo>`");
      }
      return console.log(
        isolate
          ? "Initialized .claude/skills; global skills are hidden for this project (.claude/settings.json)"
          : "Initialized .claude/skills",
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
