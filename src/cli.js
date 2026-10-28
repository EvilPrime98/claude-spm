import fs from "node:fs/promises";
import path from "node:path";
import { globalSkillsDir, projectPaths } from "./paths.js";
import { getMarket, markets, parseMarketRef } from "./markets/index.js";
import { entrySpec, loadPool, pickCandidate, repoKey, repoSpecs } from "./repo.js";
import { confirm, formatReview, inspectSkill } from "./review.js";
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
  spm install <market>:<skill>  review and install a skill found on a market (e.g. skillsmp:author/name);
                                it is pinned to the reviewed commit in spm.json
  spm update [skill...]         re-copy installed skills from the repo (market skills stay on
                                their pinned commit unless --latest)
  spm list                      skills installed in this project (alias: ls)
  spm available [filter]        skills available in the pool
  spm search <term>             search the skill markets (${Object.keys(markets).join(", ")})

Options:
  -f, --force      overwrite a skill that already exists locally
  --from <repo>    with install: take the skills from this repo of the pool, or from a market id
  --market <id>    with search: only query this market
  --latest         with update: move market skills to the newest commit (asks to review it)
  -g, --global     with install: copy the skills into the global skills folder (no spm.json,
                   nothing recorded; spm-isolated projects still hide them)
  -y, --yes        skip the review confirmation of market installs and updates
  --no-isolate     with init: don't hide global skills (and stop doing so if previously on)
  -h, --help       show this help
  -v, --version    print the spm version

Env:
  SPM_REPO         single skills repo (owner/repo[#ref], git URL or path); replaces the pool
  SPM_CACHE_DIR    where repos are cloned (default: ~/.cache/spm)
  SPM_GLOBAL_DIR   global skills folder hidden by isolation (default: ~/.claude/skills)
  SKILLSMP_API_KEY optional SkillsMP API key (anonymous search is limited to 50 requests a day)
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

/** The repo spec a skill is pinned to in the manifest; `SPM_REPO` overrides pins. */
function pinnedRepo(manifest, name, opts) {
  return process.env.SPM_REPO ? undefined : entrySpec(manifest.skills[name], opts);
}

/** Market installs are recorded as `{repo, ref, market}`; pool installs as the repo string. */
const isMarketEntry = (entry) => Boolean(entry) && typeof entry === "object";

/**
 * Repos to fetch for `names`: those the skills are pinned to, or the whole pool when any is unpinned.
 *
 * Market entries carry their own repo, so a project made only of them needs no pool.
 */
function reposFor(manifest, names, opts) {
  if (process.env.SPM_REPO) return repoSpecs(manifest);
  const pins = names.map((n) => {
    const entry = manifest.skills[n];
    return isMarketEntry(entry) ? entrySpec(entry, opts) : entry && findRepo(manifest.repos, entry);
  });
  if (pins.some((pin) => !pin)) return repoSpecs(manifest);
  return [...new Set(pins)];
}

/** Shows the review screen for a market skill; `false` when it is refused or the user declines. */
async function approve(info, src, yes) {
  const report = await inspectSkill(src);
  if (report.symlinks.length) {
    console.error(
      `✗ ${info.name}: contains symlinks (${report.symlinks.join(", ")}), not installing`,
    );
    process.exitCode = 1;
    return false;
  }
  console.log(formatReview(info, report));
  if (yes || (await confirm(`Install ${info.name}?`))) return true;
  console.log(`• ${info.name}: skipped`);
  return false;
}

async function installFromMarket(p, cfg, { market, id }, { force, yes }) {
  const { manifest, state } = cfg;
  const hit = await getMarket(market).resolve(id);
  const pool = await loadPool([hit.repo]);
  const entry = pool.has(hit.name)
    ? [hit.name, pool.get(hit.name)]
    : pool.size === 1
      ? [...pool][0]
      : null;
  if (!entry) throw new Error(`${hit.name} not found in ${hit.repo}`);
  const [name, [found]] = entry;
  const dest = path.join(p.skillsDir, name);
  if ((await exists(dest)) && !force) {
    return console.log(`• ${name}: already installed (use --force to overwrite)`);
  }
  const hash = await hashDir(found.src);
  const info = { name, repo: hit.repo, sha: found.sha, hash, market };
  if (!(await approve(info, found.src, yes))) return;
  await fs.mkdir(p.skillsDir, { recursive: true });
  await copySkill(found.src, dest);
  manifest.skills[name] = { repo: hit.repo, ref: found.sha, market };
  state.skills[name] = { hash, sha: found.sha };
  console.log(`✓ ${name}`);
}

async function install(allNames, { force, from, yes }) {
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;

  const viaMarket = from && Object.hasOwn(markets, from) ? from : undefined;
  if (viaMarket) from = undefined;
  const refs = allNames.map(
    (n) => parseMarketRef(n) ?? (viaMarket && { market: viaMarket, id: n }),
  );
  for (const ref of refs.filter(Boolean)) {
    try {
      await installFromMarket(p, cfg, ref, { force, yes });
    } catch (e) {
      console.error(`✗ ${ref.market}:${ref.id}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  const names = allNames.filter((_, i) => !refs[i]);
  if (allNames.length && !names.length) return save(p, cfg);

  const targets = names.length ? names : Object.keys(manifest.skills);
  if (!targets.length) return console.log("Nothing to install. Usage: spm install <skill>");

  // A project made only of market installs has no pool, and does not need one to reinstall.
  const specs = names.length || from || process.env.SPM_REPO ? repoSpecs(manifest) : manifest.repos;
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
    const current = manifest.skills[name];
    if (process.env.SPM_REPO) manifest.skills[name] = current ?? null;
    // Reinstalling from spm.json keeps a market install's pinned entry; naming the skill replaces it.
    else if (names.length || !isMarketEntry(current)) manifest.skills[name] = found.repo;
    if ((await exists(dest)) && !force) {
      console.log(`• ${name}: already installed (use --force to overwrite)`);
      state.skills[name] ??= { hash: await hashDir(dest), sha: found.sha };
      continue;
    }
    await copySkill(found.src, dest);
    state.skills[name] = { hash: await hashDir(dest), sha: found.sha };
    console.log(`✓ ${name}`);
  }
  await save(p, cfg);
}

/**
 * Copies skills into the global skills folder without recording anything.
 *
 * The project manifest is only read, for its repo pool; nothing is written back.
 */
async function installGlobal(allNames, { force, from, yes }) {
  if (!allNames.length) throw new Error("usage: spm install -g <skill...>");
  const p = { skillsDir: globalSkillsDir() };
  const cfg = {
    manifest: await readManifest(projectPaths().manifest),
    state: { skills: {} },
  };

  const viaMarket = from && Object.hasOwn(markets, from) ? from : undefined;
  if (viaMarket) from = undefined;
  const refs = allNames.map(
    (n) => parseMarketRef(n) ?? (viaMarket && { market: viaMarket, id: n }),
  );
  for (const ref of refs.filter(Boolean)) {
    try {
      await installFromMarket(p, cfg, ref, { force, yes });
    } catch (e) {
      console.error(`✗ ${ref.market}:${ref.id}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  const names = allNames.filter((_, i) => !refs[i]);
  if (!names.length) return;

  const specs = repoSpecs(cfg.manifest);
  const source = from && findRepo(specs, from);
  if (from && !source) {
    throw new Error(`${from} is not in the repo pool. Run: spm repo add ${from}`);
  }
  const pool = await loadPool(source ? [source] : specs);
  const available = [...pool.keys()].sort();
  await fs.mkdir(p.skillsDir, { recursive: true });

  for (const name of names) {
    const candidates = pool.get(name);
    const found = pickCandidate(candidates, source);
    if (!found) {
      console.error(
        `✗ ${name}: not found in ${source ?? specs.join(", ")}${suggest(name, available)}`,
      );
      process.exitCode = 1;
      continue;
    }
    if (!source && candidates.length > 1) {
      const others = candidates
        .slice(1)
        .map((c) => c.repo)
        .join(", ");
      console.error(`! ${name}: also in ${others}; using ${found.repo} (--from to choose)`);
    }
    const dest = path.join(p.skillsDir, name);
    if ((await exists(dest)) && !force) {
      console.log(`• ${name}: already installed (use --force to overwrite)`);
      continue;
    }
    await copySkill(found.src, dest);
    console.log(`✓ ${name}`);
  }
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

async function update(names, { latest, yes }) {
  const p = projectPaths();
  const cfg = await load(p);
  const { manifest, state } = cfg;
  const targets = names.length ? names : Object.keys(manifest.skills);
  if (!targets.length) return console.log("No skills installed in this project.");
  const installed = targets.filter((n) => n in manifest.skills);
  const opts = { latest };
  const pool = installed.length ? await loadPool(reposFor(manifest, installed, opts)) : new Map();
  for (const name of targets) {
    const dest = path.join(p.skillsDir, name);
    if (!(name in manifest.skills)) {
      console.error(`✗ ${name}: not installed`);
      process.exitCode = 1;
      continue;
    }
    const wanted = pinnedRepo(manifest, name, opts);
    const found = pickCandidate(pool.get(name), wanted);
    if (!found) {
      console.error(`✗ ${name}: no longer in the repo${wanted ? ` (${wanted})` : " pool"}`);
      process.exitCode = 1;
      continue;
    }
    const entry = manifest.skills[name];
    const market = isMarketEntry(entry);
    if (!process.env.SPM_REPO && !market) manifest.skills[name] = found.repo;
    const repoHash = await hashDir(found.src);
    const localHash = (await exists(dest)) ? await hashDir(dest) : null;
    const moved = market && latest && found.sha !== entry.ref;
    if (repoHash === localHash) {
      if (moved) entry.ref = found.sha;
      state.skills[name] = { hash: repoHash, sha: found.sha };
      console.log(`• ${name}: up to date`);
      continue;
    }
    if (moved) {
      const info = { name, repo: entry.repo, sha: found.sha, hash: repoHash, market: entry.market };
      if (!(await approve({ ...info, from: entry.ref }, found.src, yes))) continue;
      entry.ref = found.sha;
    }
    const edited = localHash && localHash !== state.skills[name]?.hash;
    await copySkill(found.src, dest);
    state.skills[name] = { hash: repoHash, sha: found.sha };
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

async function search(term, { market }) {
  if (!term) throw new Error("usage: spm search <term> [--market <id>]");
  const ids = market ? [getMarket(market).id] : Object.keys(markets);
  const rows = [];
  for (const id of ids) {
    try {
      for (const hit of await markets[id].search(term)) {
        rows.push({ ref: `${id}:${hit.author ? `${hit.author}/` : ""}${hit.name}`, ...hit });
      }
    } catch (e) {
      console.error(`✗ ${id}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  if (!rows.length) {
    if (!process.exitCode) console.log(`No skills found on ${ids.join(", ")} matching "${term}".`);
    return;
  }
  const width = Math.max(...rows.map((r) => r.ref.length));
  for (const { ref, stars, description } of rows) {
    const rating = stars === undefined ? "" : `★${stars}`.padEnd(8);
    console.log(`${ref.padEnd(width)}  ${rating}${description.slice(0, 80)}`);
  }
  console.log("\nInstall one with: spm install <ref> (you review it before anything is copied)");
}

/** Pulls `--flag <value>` (or `--flag=<value>`) options out of argv; `needs` maps each flag to what it expects. */
function takeOptions(argv, needs) {
  const args = [];
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf("=");
    const flag = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    if (!Object.hasOwn(needs, flag)) {
      args.push(argv[i]);
      continue;
    }
    const value = eq === -1 ? argv[++i] : argv[i].slice(eq + 1);
    if (!value || value.startsWith("-")) throw new Error(`${flag} needs ${needs[flag]}`);
    values[flag.slice(2)] = value;
  }
  return { args, values };
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
 * Flags (`-f`/`--force`, `-y`/`--yes`, `--latest`, `-v`/`--version`, `-h`/`--help`, `--no-isolate`, `--from <repo|market>`, `--market <id>`) may appear anywhere; the first non-flag argument is the command.
 *
 * @param {string[]} argv Command-line arguments, without the node and script paths.
 * @returns {Promise<void>}
 * @throws {Error} If the command is unknown or the command fails.
 */
export async function run(argv) {
  const { args, values } = takeOptions(argv, {
    "--from": "a repo or market id",
    "--market": "a market id",
  });
  const { from, market } = values;
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const [cmd, ...rest] = args.filter((a) => !a.startsWith("-"));
  const force = flags.has("-f") || flags.has("--force");
  const yes = flags.has("-y") || flags.has("--yes");
  const latest = flags.has("--latest");
  const global = flags.has("-g") || flags.has("--global");

  if (global && !["install", "i", "add"].includes(cmd)) {
    throw new Error("-g only works with install");
  }

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
      return global
        ? installGlobal(rest, { force, from, yes })
        : install(rest, { force, from, yes });
    case "uninstall":
    case "remove":
    case "rm":
      return uninstall(rest);
    case "update":
    case "up":
      return update(rest, { latest, yes });
    case "list":
    case "ls":
      return list();
    case "repo":
    case "repos":
      return repo(rest, { force });
    case "available":
      return available(rest[0]);
    case "search":
      return search(rest.join(" "), { market });
    default:
      throw new Error(`unknown command "${cmd}". Run spm --help`);
  }
}
