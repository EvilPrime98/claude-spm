import fs from "node:fs/promises";
import path from "node:path";
import { globalSkillsDir, projectPaths } from "./paths.js";
import { loadPool, pickCandidate, repoKey, repoSpecs } from "./repo.js";
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

const HELP = `spm - install Claude skills from GitHub repos into a project

Usage:
  spm init [owner/repo[#ref]]   create spm.json, add the repo to the pool, and hide global
                                skills in this project (only project skills stay)
  spm repo add <owner/repo>     add a skills repo to the pool (spm.json "repos")
  spm repo rm <owner/repo>      remove a repo from the pool (--force if skills use it)
  spm repo list                 repos in the pool (alias: ls)
  spm install <skill...>        add skills to spm.json and copy them into ./.claude/skills
                                from the first repo that has them (alias: i, add)
  spm install                   recreate .claude/skills from spm.json (like npm install)
  spm uninstall <skill...>      remove skills from the project (alias: rm, remove)
  spm update [skill...]         re-copy installed skills from the repo
  spm list                      skills installed in this project (alias: ls)
  spm available [filter]        skills available in the pool (alias: search)

Options:
  -f, --force    overwrite a skill that already exists locally
  --from <repo>  with install: take the skills from this repo of the pool
  --no-isolate   with init: don't hide global skills (and stop doing so if previously on)
  -h, --help     show this help
  -v, --version  print the spm version

Env:
  SPM_REPO         single skills repo (owner/repo[#ref], git URL or path); replaces the pool
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
  if (repo) cfg.manifest.repos = withRepo(cfg.manifest.repos, repo);
  if (isolate !== undefined) cfg.manifest.isolate = isolate;
  await save(p, cfg);
  if (isolate === false) await removeOverrides(p.settings, globalSkillsDir());
  return cfg.manifest;
}

/** Adds a repo spec to the pool unless an equivalent one is already there. */
function withRepo(repos, spec) {
  const key = repoKey(spec);
  return repos.some((r) => repoKey(r) === key) ? repos : [...repos, spec];
}

/** Finds the pool entry equivalent to `spec`. */
function findRepo(repos, spec) {
  const key = repoKey(spec);
  return repos.find((r) => repoKey(r) === key);
}

/** The repo a skill is pinned to in the manifest; `SPM_REPO` overrides pins. */
function pinnedRepo(manifest, name) {
  return process.env.SPM_REPO ? undefined : (manifest.skills[name] ?? undefined);
}

/** Repos to fetch for `names`: those the skills are pinned to, or the whole pool when any is unpinned. */
function reposFor(manifest, names) {
  const pool = repoSpecs(manifest);
  if (process.env.SPM_REPO) return pool;
  const pins = names.map((n) => manifest.skills[n] && findRepo(pool, manifest.skills[n]));
  if (pins.some((pin) => !pin)) return pool;
  return [...new Set(pins)];
}

async function install(names, { force, from }) {
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;
  const targets = names.length ? names : Object.keys(manifest.skills);
  if (!targets.length) return console.log("Nothing to install. Usage: spm install <skill>");

  const specs = repoSpecs(manifest);
  const source = from && findRepo(specs, from);
  if (from && !source) {
    throw new Error(`${from} is not in the repo pool. Run: spm repo add ${from}`);
  }
  let fetchSpecs = specs;
  if (source) fetchSpecs = [source];
  else if (!names.length) fetchSpecs = reposFor(manifest, targets);
  const pool = await loadPool(fetchSpecs);
  const available = [...pool.keys()].sort();
  await fs.mkdir(p.skillsDir, { recursive: true });

  for (const name of targets) {
    const candidates = pool.get(name);
    // Reinstalling from spm.json keeps the repo each skill came from.
    const wanted = source ?? (names.length ? undefined : pinnedRepo(manifest, name));
    const found = pickCandidate(candidates, wanted);
    const dest = path.join(p.skillsDir, name);
    if (!found) {
      console.error(
        `✗ ${name}: not found in ${wanted ?? specs.join(", ")}${suggest(name, available)}`,
      );
      process.exitCode = 1;
      continue;
    }
    if (!wanted && candidates.length > 1) {
      const others = candidates
        .slice(1)
        .map((c) => c.repo)
        .join(", ");
      console.error(`! ${name}: also in ${others}; using ${found.repo} (--from to choose)`);
    }
    manifest.skills[name] = process.env.SPM_REPO ? (manifest.skills[name] ?? null) : found.repo;
    if ((await exists(dest)) && !force) {
      console.log(`• ${name}: already installed (use --force to overwrite)`);
      state.skills[name] ??= { hash: await hashDir(dest) };
      continue;
    }
    await copySkill(found.src, dest);
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
    if (!(await exists(dest)) && !(name in manifest.skills)) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    await fs.rm(dest, { recursive: true, force: true });
    delete manifest.skills[name];
    delete state.skills[name];
    console.log(`✓ removed ${name}`);
  }
  await save(p, cfg);
}

async function update(names) {
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;
  const targets = names.length ? names : Object.keys(manifest.skills);
  if (!targets.length) return console.log("No skills installed in this project.");
  const installed = targets.filter((n) => n in manifest.skills);
  const pool = installed.length ? await loadPool(reposFor(manifest, installed)) : new Map();
  for (const name of targets) {
    const dest = path.join(p.skillsDir, name);
    if (!(name in manifest.skills)) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    const wanted = pinnedRepo(manifest, name);
    const found = pickCandidate(pool.get(name), wanted);
    if (!found) {
      console.error(`✗ ${name}: no longer in the repo${wanted ? ` (${wanted})` : " pool"}`);
      process.exitCode = 1;
      continue;
    }
    if (!process.env.SPM_REPO) manifest.skills[name] = found.repo;
    const repoHash = await hashDir(found.src);
    const localHash = (await exists(dest)) ? await hashDir(dest) : null;
    if (repoHash === localHash) {
      state.skills[name] = { hash: repoHash };
      console.log(`• ${name}: up to date`);
      continue;
    }
    const edited = localHash && localHash !== state.skills[name]?.hash;
    await copySkill(found.src, dest);
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
  const specs = repoSpecs((await load(p)).manifest);
  const pool = await loadPool(specs);
  const rows = [...pool]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([n]) => !filter || n.includes(filter.toLowerCase()))
    .flatMap(([name, candidates]) => candidates.map((c) => ({ name, ...c })));
  if (!rows.length) {
    const where = specs.join(", ");
    return console.log(`No skills found in ${where}${filter ? ` matching "${filter}"` : ""}.`);
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  const repoWidth = Math.max(...rows.map((r) => r.repo.length));
  for (const { name, repo, src } of rows) {
    const desc = (await describe(src)).slice(0, 80);
    const origin = specs.length > 1 ? `${repo.padEnd(repoWidth)}  ` : "";
    console.log(`${name.padEnd(width)}  ${origin}${desc}`);
  }
}

async function repo(args, { force }) {
  const [sub, spec] = args;
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest } = cfg;
  switch (sub) {
    case "add": {
      if (!spec) throw new Error("usage: spm repo add <owner/repo[#ref]>");
      if (findRepo(manifest.repos, spec)) return console.log(`• ${spec}: already in the pool`);
      const count = (await loadPool([spec])).size;
      manifest.repos = withRepo(manifest.repos, spec);
      await save(p, cfg);
      return console.log(`✓ added ${spec} (${count} skills)`);
    }
    case "remove":
    case "rm": {
      if (!spec) throw new Error("usage: spm repo rm <owner/repo[#ref]>");
      const existing = findRepo(manifest.repos, spec);
      if (!existing) throw new Error(`${spec} is not in the repo pool`);
      const users = Object.keys(manifest.skills).filter((n) => manifest.skills[n] === existing);
      if (users.length && !force) {
        throw new Error(
          `${existing} is used by ${users.join(", ")} (use --force to remove anyway)`,
        );
      }
      for (const n of users) manifest.skills[n] = null;
      manifest.repos = manifest.repos.filter((r) => r !== existing);
      await save(p, cfg);
      return console.log(`✓ removed ${existing}`);
    }
    case "list":
    case "ls": {
      if (!manifest.repos.length) {
        return console.log("No repos in the pool. Run: spm repo add <owner/repo>");
      }
      for (const r of manifest.repos) {
        const n = Object.values(manifest.skills).filter((v) => v === r).length;
        console.log(`${r}  (${n} installed)`);
      }
      return;
    }
    default:
      throw new Error("usage: spm repo <add|rm|list> [owner/repo]");
  }
}

/** Pulls `--from <repo>` (or `--from=<repo>`) out of argv. */
function takeFrom(argv) {
  const args = [];
  let from;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") {
      from = argv[++i];
      if (!from || from.startsWith("-")) throw new Error("--from needs a repo");
    } else if (argv[i].startsWith("--from=")) from = argv[i].slice(7);
    else args.push(argv[i]);
  }
  return { args, from };
}

function suggest(name, available) {
  const close = available.filter((a) => a.includes(name) || name.includes(a)).slice(0, 3);
  return close.length ? `\n  did you mean: ${close.join(", ")}?` : "";
}

async function version() {
  const pkg = new URL("../package.json", import.meta.url);
  return JSON.parse(await fs.readFile(pkg, "utf8")).version;
}

/**
 * Runs the spm CLI.
 *
 * Flags (`-f`/`--force`, `-v`/`--version`, `-h`/`--help`, `--no-isolate`, `--from <repo>`) may appear anywhere; the first non-flag argument is the command.
 *
 * @param {string[]} argv Command-line arguments, without the node and script paths.
 * @returns {Promise<void>}
 * @throws {Error} If the command is unknown or the command fails.
 */
export async function run(argv) {
  const { args, from } = takeFrom(argv);
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const [cmd, ...rest] = args.filter((a) => !a.startsWith("-"));
  const force = flags.has("-f") || flags.has("--force");

  if (flags.has("-v") || flags.has("--version")) return console.log(await version());

  if (!cmd || flags.has("-h") || flags.has("--help") || cmd === "help") return console.log(HELP);

  switch (cmd) {
    case "init": {
      const isolate = !flags.has("--no-isolate");
      const p = projectPaths();
      const { repos } = await init(p, { isolate, repo: rest[0] });
      if (!repos.length && !process.env.SPM_REPO) {
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
      return install(rest, { force, from });
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
    case "repo":
    case "repos":
      return repo(rest, { force });
    case "available":
    case "search":
      return available(rest[0]);
    default:
      throw new Error(`unknown command "${cmd}". Run spm --help`);
  }
}
