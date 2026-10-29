import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cacheDir } from "./paths.js";
import { exists, findSkills } from "./store.js";

const git = promisify(execFile);

/**
 * Parses a repository spec into a clone URL, git ref and optional subdirectory.
 *
 * Accepts `owner/repo`, `owner/repo/sub/dir`, a GitHub `/tree/<ref>/<subdir>` URL, or any other git URL, each optionally suffixed with `#ref`.
 *
 * @param {string} spec Repository spec.
 * @returns {{url: string, ref: (string|undefined), subdir: (string|undefined)}} Parsed repository location.
 * @throws {Error} If the subdirectory contains a `..` segment.
 */
export function parseRepo(spec) {
  const hash = spec.lastIndexOf("#");
  let base = hash === -1 ? spec : spec.slice(0, hash);
  let ref = hash === -1 ? undefined : spec.slice(hash + 1) || undefined;
  let subdir;

  // https://github.com/owner/repo/tree/<ref>/<subdir>
  const tree = base.match(
    /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.+?))?\/?$/,
  );
  if (tree) {
    base = tree[1];
    ref ??= tree[2];
    subdir = tree[3];
  } else {
    // owner/repo/sub/dir shorthand
    const short = base.match(/^([\w.-]+\/[\w.-]+)\/([\w./-]+?)\/?$/);
    if (short && !path.isAbsolute(base) && !base.startsWith(".") && !existsSync(base)) {
      base = short[1];
      subdir = short[2];
    }
  }

  if (subdir?.split("/").includes("..")) {
    throw new Error(`invalid subdirectory "${subdir}": ".." is not allowed`);
  }

  const url = /^[\w.-]+\/[\w.-]+$/.test(base) ? `https://github.com/${base}.git` : base;
  return { url, ref, subdir };
}

function cachePath({ url, ref }) {
  const id = crypto
    .createHash("sha1")
    .update(`${url}#${ref ?? ""}`)
    .digest("hex")
    .slice(0, 8);
  const name = path.basename(url, ".git").replace(/[^\w.-]/g, "_");
  return path.join(cacheDir(), `${name}-${id}`);
}

async function run(args, cwd) {
  try {
    return (await git("git", args, { cwd })).stdout.trim();
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("git is required but was not found in PATH");
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message).trim()}`);
  }
}

const isSha = (ref) => /^[0-9a-f]{40}$/i.test(ref ?? "");

// Specs sharing a clone (same repo and ref, different subdir) must not clone concurrently.
const locks = new Map();

/**
 * Clones the repository into the cache, or updates the cached clone, and returns the directory to scan for skills.
 *
 * A ref that is a full commit SHA is fetched exactly; a cached clone already at that commit is reused without touching the network.
 *
 * If updating an existing clone fails, logs a warning and uses the cached copy.
 *
 * @param {string} spec Repository spec, as accepted by `parseRepo`.
 * @returns {Promise<{root: string, sha: string}>} Absolute path to the repository root (or to its subdirectory when the spec includes one) and the commit it is at.
 * @throws {Error} If `git` is missing, a clone fails, or the requested subdirectory does not exist.
 */
export async function fetchRepo(spec) {
  const repo = parseRepo(spec);
  const dir = cachePath(repo);
  const previous = locks.get(dir) ?? Promise.resolve();
  const current = previous.then(() => fetchInto(repo, dir, spec));
  locks.set(
    dir,
    current.catch(() => {}),
  );
  return current;
}

async function fetchInto(repo, dir, spec) {
  const pinned = isSha(repo.ref);
  if (await exists(path.join(dir, ".git"))) {
    try {
      if (!pinned || (await run(["rev-parse", "HEAD"], dir)) !== repo.ref.toLowerCase()) {
        await run(["fetch", "--depth", "1", "origin", repo.ref ?? "HEAD"], dir);
        await run(["reset", "--hard", "FETCH_HEAD"], dir);
      }
    } catch (e) {
      console.error(`! could not update ${spec}, using cached copy (${e.message})`);
    }
  } else {
    await fs.mkdir(path.dirname(dir), { recursive: true });
    if (pinned) await cloneAt(repo, dir);
    else {
      const branch = repo.ref ? ["--branch", repo.ref] : [];
      await run(["clone", "--depth", "1", ...branch, "--", repo.url, dir]);
    }
  }
  const root = repo.subdir ? path.join(dir, repo.subdir) : dir;
  if (repo.subdir && !(await exists(root))) {
    throw new Error(`path "${repo.subdir}" not found in ${repo.url}`);
  }
  return { root, sha: await run(["rev-parse", "HEAD"], dir) };
}

// `git clone --branch` cannot take a commit SHA, so fetch it into a fresh repo.
async function cloneAt({ url, ref }, dir) {
  try {
    await fs.mkdir(dir);
    await run(["init", "-q"], dir);
    await run(["fetch", "--depth", "1", "--", url, ref], dir);
    await run(["checkout", "-q", "--detach", "FETCH_HEAD"], dir);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Pins a repository spec to a commit by replacing any `#ref` suffix.
 *
 * @param {string} spec Repository spec, as accepted by `parseRepo`.
 * @param {string} sha Commit SHA to pin to.
 * @returns {string} The spec ending in `#<sha>`.
 */
export function pinSpec(spec, sha) {
  const hash = spec.lastIndexOf("#");
  return `${hash === -1 ? spec : spec.slice(0, hash)}#${sha}`;
}

/**
 * Gets the spec to fetch for a manifest `skills` entry.
 *
 * A string entry is the repo itself. An object entry (installed from a market) is fetched at its recorded commit unless `latest` is set.
 *
 * @param {string|{repo: string, ref?: string}|null|undefined} entry Manifest entry.
 * @param {{latest?: boolean}} [options] Options.
 * @returns {string|undefined} Repository spec, or `undefined` for an unpinned skill.
 */
export function entrySpec(entry, { latest = false } = {}) {
  if (!entry) return undefined;
  if (typeof entry === "string") return entry;
  return entry.ref && !latest ? pinSpec(entry.repo, entry.ref) : entry.repo;
}

/**
 * Builds a stable identity for a repository spec so equivalent spellings compare equal.
 *
 * @param {string} spec Repository spec, as accepted by `parseRepo`.
 * @returns {string} Key combining clone URL, ref and subdirectory.
 */
export function repoKey(spec) {
  const { url, ref, subdir } = parseRepo(spec);
  return `${url}#${ref ?? ""}/${subdir ?? ""}`;
}

/**
 * Gets the configured pool of skills repository specs.
 *
 * The `SPM_REPO` environment variable replaces the manifest's pool with a single repo.
 *
 * @param {{repos?: string[]}} manifest Project manifest.
 * @returns {string[]} Repository specs, in search order.
 * @throws {Error} If no repository is configured.
 */
export function repoSpecs(manifest) {
  const specs = process.env.SPM_REPO ? [process.env.SPM_REPO] : (manifest.repos ?? []);
  if (!specs.length) {
    throw new Error("no skills repo configured. Run: spm repo add <owner/repo>");
  }
  return specs;
}

function defaultName(spec) {
  const { url, subdir } = parseRepo(spec);
  return path.basename(subdir ?? url, ".git").replace(/[^\w.-]/g, "_");
}

/**
 * Fetches every repo and indexes their skills by name.
 *
 * @param {string[]} specs Repository specs, in search order.
 * @returns {Promise<Map<string, {repo: string, src: string, sha: string}[]>>} Candidates per skill name, in repo order; `sha` is the commit each was read at.
 * @throws {Error} If any repo cannot be fetched.
 */
export async function loadPool(specs) {
  const pool = new Map();
  const indexed = await Promise.all(
    specs.map(async (repo) => {
      const { root, sha } = await fetchRepo(repo);
      return { skills: await findSkills(root, defaultName(repo)), sha };
    }),
  );
  for (const [i, { skills, sha }] of indexed.entries()) {
    const repo = specs[i];
    for (const [name, src] of skills) {
      if (!pool.has(name)) pool.set(name, []);
      pool.get(name).push({ repo, src, sha });
    }
  }
  return pool;
}

/**
 * Picks the candidate for a skill, preferring a specific repo when one is requested.
 *
 * @param {{repo: string, src: string, sha: string}[]|undefined} candidates Candidates from `loadPool`.
 * @param {string} [wanted] Repo spec the skill must come from.
 * @returns {{repo: string, src: string, sha: string}|undefined} The chosen candidate, if any.
 */
export function pickCandidate(candidates, wanted) {
  if (!candidates?.length) return undefined;
  if (!wanted) return candidates[0];
  const key = repoKey(wanted);
  return candidates.find((c) => repoKey(c.repo) === key);
}
