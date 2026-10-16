import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cacheDir } from "./paths.js";
import { exists } from "./store.js";

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
 * Gets the configured skills repository spec.
 *
 * The `SPM_REPO` environment variable takes precedence over the manifest.
 *
 * @param {{repo?: string}} manifest Project manifest.
 * @returns {string} Repository spec.
 * @throws {Error} If no repository is configured.
 */
export function repoSpec(manifest) {
  const spec = process.env.SPM_REPO ?? manifest.repo;
  if (!spec) {
    throw new Error("no skills repo configured. Run: spm init <owner/repo>");
  }
  return spec;
}
