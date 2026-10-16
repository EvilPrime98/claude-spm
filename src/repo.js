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
    await git("git", args, { cwd });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("git is required but was not found in PATH");
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message).trim()}`);
  }
}

/**
 * Clones the repository into the cache, or updates the cached clone, and returns the directory to scan for skills.
 *
 * If updating an existing clone fails, logs a warning and uses the cached copy.
 *
 * @param {string} spec Repository spec, as accepted by `parseRepo`.
 * @returns {Promise<string>} Absolute path to the repository root, or to its subdirectory when the spec includes one.
 * @throws {Error} If `git` is missing, a clone fails, or the requested subdirectory does not exist.
 */
export async function fetchRepo(spec) {
  const repo = parseRepo(spec);
  const dir = cachePath(repo);
  if (await exists(path.join(dir, ".git"))) {
    try {
      await run(["fetch", "--depth", "1", "origin", repo.ref ?? "HEAD"], dir);
      await run(["reset", "--hard", "FETCH_HEAD"], dir);
    } catch (e) {
      console.error(`! could not update ${spec}, using cached copy (${e.message})`);
    }
  } else {
    await fs.mkdir(path.dirname(dir), { recursive: true });
    const branch = repo.ref ? ["--branch", repo.ref] : [];
    await run(["clone", "--depth", "1", ...branch, "--", repo.url, dir]);
  }
  const root = repo.subdir ? path.join(dir, repo.subdir) : dir;
  if (repo.subdir && !(await exists(root))) {
    throw new Error(`path "${repo.subdir}" not found in ${repo.url}`);
  }
  return root;
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

/**
 * Fetches every repo and indexes their skills by name.
 *
 * @param {string[]} specs Repository specs, in search order.
 * @returns {Promise<Map<string, {repo: string, src: string}[]>>} Candidates per skill name, in repo order.
 * @throws {Error} If any repo cannot be fetched.
 */
export async function loadPool(specs) {
  const pool = new Map();
  const indexed = await Promise.all(specs.map(async (repo) => findSkills(await fetchRepo(repo))));
  for (const [i, skills] of indexed.entries()) {
    const repo = specs[i];
    for (const [name, src] of skills) {
      if (!pool.has(name)) pool.set(name, []);
      pool.get(name).push({ repo, src });
    }
  }
  return pool;
}

/**
 * Picks the candidate for a skill, preferring a specific repo when one is requested.
 *
 * @param {{repo: string, src: string}[]|undefined} candidates Candidates from `loadPool`.
 * @param {string} [wanted] Repo spec the skill must come from.
 * @returns {{repo: string, src: string}|undefined} The chosen candidate, if any.
 */
export function pickCandidate(candidates, wanted) {
  if (!candidates?.length) return undefined;
  if (!wanted) return candidates[0];
  const key = repoKey(wanted);
  return candidates.find((c) => repoKey(c.repo) === key);
}
