import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRepo, parseRepo } from "../src/repo.js";

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
    const dir = await fetchRepo(src);
    expect(await fs.readFile(path.join(dir, "pkg", "f.txt"), "utf8")).toBe("one");
    expect(dir.startsWith(process.env.SPM_CACHE_DIR)).toBe(true);
  });

  it("refreshes an existing cached clone", async () => {
    await fetchRepo(src);
    await fs.writeFile(path.join(src, "pkg", "f.txt"), "two");
    await git(src, "commit", "-qam", "edit");
    const dir = await fetchRepo(src);
    expect(await fs.readFile(path.join(dir, "pkg", "f.txt"), "utf8")).toBe("two");
  });

  it("falls back to the cached copy when the origin disappears", async () => {
    await fetchRepo(src);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.rename(src, path.join(root, "moved"));
    const dir = await fetchRepo(src);
    expect(await fs.readFile(path.join(dir, "pkg", "f.txt"), "utf8")).toBe("one");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("using cached copy"));
    spy.mockRestore();
  });

  it("fails when the clone source does not exist", async () => {
    await expect(fetchRepo(path.join(root, "absent"))).rejects.toThrow(/git clone failed/);
  });
});
