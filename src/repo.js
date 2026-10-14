import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cacheDir } from "./paths.js";
import { exists } from "./store.js";

const git = promisify(execFile);

export function parseRepo(spec) {
  const hash = spec.lastIndexOf("#");
  const base = hash === -1 ? spec : spec.slice(0, hash);
  const ref = hash === -1 ? undefined : spec.slice(hash + 1) || undefined;
  const url = /^[\w.-]+\/[\w.-]+$/.test(base) ? `https://github.com/${base}.git` : base;
  return { url, ref };
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
  const skills = path.join(dir, "skills");
  return (await exists(skills)) ? skills : dir;
}

export function repoSpec(manifest) {
  const spec = process.env.SPM_REPO ?? manifest.repo;
  if (!spec) {
    throw new Error("no skills repo configured. Run: spm init <owner/repo>");
  }
  return spec;
}
