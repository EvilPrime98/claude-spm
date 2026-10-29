import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entrySpec, fetchRepo, parseRepo, pinSpec } from "../src/repo.js";

describe("parseRepo edge cases", () => {
  it("lets an explicit #ref override the ref in a tree URL", () => {
    expect(parseRepo("https://github.com/o/r/tree/main/sub#dev")).toEqual({
      url: "https://github.com/o/r.git",
      ref: "dev",
      subdir: "sub",
    });
  });

  it("parses a tree URL without a subdir and tolerates a trailing slash", () => {
    expect(parseRepo("https://github.com/o/r/tree/v1")).toMatchObject({
      url: "https://github.com/o/r.git",
      ref: "v1",
      subdir: undefined,
    });
    expect(parseRepo("o/r/a/b/").subdir).toBe("a/b");
  });

  it("does not treat relative paths as owner/repo/subdir", () => {
    expect(parseRepo("./a/b/c").subdir).toBeUndefined();
  });
});

describe("pinSpec and entrySpec", () => {
  const sha = "a".repeat(40);

  it("replaces an existing ref", () => {
    expect(pinSpec("o/r/sub", sha)).toBe(`o/r/sub#${sha}`);
    expect(pinSpec("o/r#main", sha)).toBe(`o/r#${sha}`);
    expect(parseRepo(pinSpec("https://github.com/o/r/tree/main/sub", sha))).toMatchObject({
      ref: sha,
      subdir: "sub",
    });
  });

  it("uses a string entry as is and pins an object entry unless latest", () => {
    expect(entrySpec("o/r")).toBe("o/r");
    expect(entrySpec(null)).toBeUndefined();
    const entry = { repo: "o/r/sub", ref: sha, market: "skillsmp" };
    expect(entrySpec(entry)).toBe(`o/r/sub#${sha}`);
    expect(entrySpec(entry, { latest: true })).toBe("o/r/sub");
  });
});

describe("fetchRepo", () => {
  let root;
  let src;
  const savedCache = process.env.SPM_CACHE_DIR;
  const git = (cwd, ...args) =>
    promisify(execFile)("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "spm-fetch-"));
    src = path.join(root, "src");
    process.env.SPM_CACHE_DIR = path.join(root, "cache");
    await fs.mkdir(path.join(src, "pkg"), { recursive: true });
    await fs.writeFile(path.join(src, "pkg", "f.txt"), "one");
    await git(src, "init", "-q");
    await git(src, "add", ".");
    await git(src, "commit", "-qm", "init");
  });
  afterEach(async () => {
    if (savedCache === undefined) delete process.env.SPM_CACHE_DIR;
    else process.env.SPM_CACHE_DIR = savedCache;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("clones a local repo into the cache", async () => {
    const { root: dir } = await fetchRepo(src);
    expect(await fs.readFile(path.join(dir, "pkg", "f.txt"), "utf8")).toBe("one");
    expect(dir.startsWith(process.env.SPM_CACHE_DIR)).toBe(true);
  });

  it("refreshes an existing cached clone", async () => {
    await fetchRepo(src);
    await fs.writeFile(path.join(src, "pkg", "f.txt"), "two");
    await git(src, "commit", "-qam", "edit");
    const { root: dir } = await fetchRepo(src);
    expect(await fs.readFile(path.join(dir, "pkg", "f.txt"), "utf8")).toBe("two");
  });

  it("serializes concurrent fetches that share a clone", async () => {
    const [first, second] = await Promise.all([fetchRepo(src), fetchRepo(src)]);
    expect(second).toEqual(first);
    expect(await fs.readFile(path.join(second.root, "pkg", "f.txt"), "utf8")).toBe("one");
  });

  it("keeps serving later fetches after one fails", async () => {
    const bad = fetchRepo(path.join(root, "absent"));
    const good = fetchRepo(src);
    await expect(bad).rejects.toThrow(/git clone failed/);
    await expect(good).resolves.toHaveProperty("sha");
  });

  it("falls back to the cached copy when the origin disappears", async () => {
    await fetchRepo(src);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.rename(src, path.join(root, "moved"));
    const { root: dir } = await fetchRepo(src);
    expect(await fs.readFile(path.join(dir, "pkg", "f.txt"), "utf8")).toBe("one");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("using cached copy"));
    spy.mockRestore();
  });

  it("reports the commit it is at", async () => {
    const { sha } = await fetchRepo(src);
    const { stdout } = await git(src, "rev-parse", "HEAD");
    expect(sha).toBe(stdout.trim());
  });

  it("fetches an exact commit when the ref is a SHA, even after the repo moved on", async () => {
    const { sha: first } = await fetchRepo(src);
    await fs.writeFile(path.join(src, "pkg", "f.txt"), "two");
    await git(src, "commit", "-qam", "edit");
    await fs.rm(process.env.SPM_CACHE_DIR, { recursive: true });

    const pinned = await fetchRepo(pinSpec(src, first));
    expect(pinned.sha).toBe(first);
    expect(await fs.readFile(path.join(pinned.root, "pkg", "f.txt"), "utf8")).toBe("one");
  });

  it("reuses a cached clone already at the pinned commit without the origin", async () => {
    const { sha } = await fetchRepo(src);
    await fs.rm(process.env.SPM_CACHE_DIR, { recursive: true });
    await fetchRepo(pinSpec(src, sha));
    await fs.rename(src, path.join(root, "moved"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await fetchRepo(pinSpec(src, sha));
    expect(again.sha).toBe(sha);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("leaves no half-made cache entry when a pinned fetch fails", async () => {
    const bogus = "0".repeat(40);
    await expect(fetchRepo(pinSpec(src, bogus))).rejects.toThrow(/git fetch failed/);
    await expect(fetchRepo(pinSpec(src, bogus))).rejects.toThrow(/git fetch failed/);
  });

  it("fails when the clone source does not exist", async () => {
    await expect(fetchRepo(path.join(root, "absent"))).rejects.toThrow(/git clone failed/);
  });
});
