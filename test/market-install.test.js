import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";

const exec = promisify(execFile);
const HIT_URL = "https://github.com/acme/tools/tree/main/skills/testing";

let root;
let upstream;
let project;
let cwd;
let out;
let err;
const saved = {};
const git = (...args) =>
  exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: upstream });
const commit = async (msg) => {
  await git("add", ".");
  await git("commit", "-qm", msg);
  return (await git("rev-parse", "HEAD")).stdout.trim();
};
const manifest = async () => JSON.parse(await fs.readFile(path.join(project, "spm.json"), "utf8"));
const skillFile = path.join(".claude", "skills", "testing", "SKILL.md");
const read = (rel) => fs.readFile(path.join(project, rel), "utf8");

function stubMarket(skills) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: { skills } }))),
  );
}
const hit = {
  name: "testing",
  author: "acme",
  description: "Run tests",
  githubUrl: HIT_URL,
  stars: 5,
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spm-market-"));
  upstream = path.join(root, "gh", "acme", "tools.git");
  project = path.join(root, "project");
  await fs.mkdir(path.join(upstream, "skills", "testing"), { recursive: true });
  await fs.writeFile(
    path.join(upstream, "skills", "testing", "SKILL.md"),
    "---\nname: testing\ndescription: Run tests\n---\nv1\n",
  );
  await exec("git", ["init", "-q", "-b", "main"], { cwd: upstream });
  await commit("v1");
  await fs.mkdir(project);

  // Serve https://github.com/ from the local folder, so "GitHub" clones work offline.
  const env = {
    SPM_CACHE_DIR: path.join(root, "cache"),
    SPM_GLOBAL_DIR: path.join(root, "global"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${path.join(root, "gh").replaceAll("\\", "/")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
  };
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  delete process.env.SPM_REPO;
  cwd = process.cwd();
  process.chdir(project);
  out = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
  stubMarket([hit]);
});
afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllGlobals();
  out.mockRestore();
  err.mockRestore();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.exitCode = undefined;
  await fs.rm(root, { recursive: true, force: true });
});

const printed = (spy) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

describe("spm search", () => {
  it("lists market hits with an installable reference", async () => {
    await run(["search", "test"]);
    expect(printed(out)).toContain("skillsmp:acme/testing");
    expect(printed(out)).toContain("Run tests");
    expect(printed(out)).toContain("spm install <ref>");
  });

  it("reports an empty result, a missing term and an unknown market", async () => {
    stubMarket([]);
    await run(["search", "zzz"]);
    expect(printed(out)).toContain('No skills found on skillsmp matching "zzz"');
    await expect(run(["search"])).rejects.toThrow("usage: spm search");
    await expect(run(["search", "x", "--market", "nope"])).rejects.toThrow("unknown market");
  });
});

describe("spm install <market>:<skill>", () => {
  it("shows the review, installs, and pins the reviewed commit", async () => {
    const sha = (await git("rev-parse", "HEAD")).stdout.trim();
    await run(["install", "skillsmp:acme/testing", "--yes"]);
    expect(printed(out)).toContain("Review testing (from skillsmp)");
    expect(printed(out)).toContain(sha);
    expect(await read(skillFile)).toContain("v1");
    expect((await manifest()).skills.testing).toEqual({
      repo: HIT_URL,
      ref: sha,
      market: "skillsmp",
    });
    const state = JSON.parse(await read(path.join(".claude", ".spm-state.json")));
    expect(state.skills.testing.sha).toBe(sha);
  });

  it("works with --from <market> for a bare name", async () => {
    await run(["install", "testing", "--from", "skillsmp", "--yes"]);
    expect((await manifest()).skills.testing.market).toBe("skillsmp");
  });

  it("asks for confirmation when stdin is not a terminal, and installs nothing", async () => {
    if (process.stdin.isTTY) return;
    await run(["install", "skillsmp:acme/testing"]);
    expect(printed(err)).toContain("--yes");
    expect(process.exitCode).toBe(1);
    await expect(fs.access(path.join(project, skillFile))).rejects.toThrow();
    expect((await manifest()).skills).toEqual({});
  });

  it.skipIf(process.platform === "win32")("refuses a skill that contains a symlink", async () => {
    try {
      await fs.symlink(path.join(root, "gh"), path.join(upstream, "skills", "testing", "escape"));
    } catch {
      return; // symlinks need privileges on some Windows setups
    }
    await commit("link");
    await run(["install", "skillsmp:acme/testing", "--yes"]);
    expect(printed(err)).toContain("contains symlinks");
    await expect(fs.access(path.join(project, skillFile))).rejects.toThrow();
  });

  it("does not use the pool, and does not need one", async () => {
    await run(["install", "skillsmp:acme/testing", "--yes"]);
    expect((await manifest()).repos).toEqual([]);
  });

  it("reinstalls from spm.json at the pinned commit even if upstream moved", async () => {
    await run(["install", "skillsmp:acme/testing", "--yes"]);
    await fs.writeFile(path.join(upstream, "skills", "testing", "SKILL.md"), "---\n---\nv2\n");
    await commit("v2");
    await fs.rm(path.join(project, ".claude"), { recursive: true });
    await run(["install"]);
    expect(await read(skillFile)).toContain("v1");
    expect((await manifest()).skills.testing.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports an ambiguous or missing reference and keeps going", async () => {
    stubMarket([hit, { ...hit, author: "other" }]);
    await run(["install", "skillsmp:testing", "skillsmp:acme/testing", "--yes"]);
    expect(printed(err)).toContain("ambiguous");
    expect(process.exitCode).toBe(1);
    expect((await manifest()).skills.testing.market).toBe("skillsmp");
  });
});

describe("spm update with market installs", () => {
  beforeEach(async () => {
    await run(["install", "skillsmp:acme/testing", "--yes"]);
    await fs.writeFile(
      path.join(upstream, "skills", "testing", "SKILL.md"),
      "---\nname: testing\n---\nv2\n",
    );
    await commit("v2");
    out.mockClear();
  });

  it("stays on the pinned commit by default", async () => {
    const before = (await manifest()).skills.testing.ref;
    await run(["update"]);
    expect(printed(out)).toContain("up to date");
    expect(await read(skillFile)).toContain("v1");
    expect((await manifest()).skills.testing.ref).toBe(before);
  });

  it("moves to the newest commit with --latest after a review", async () => {
    const before = (await manifest()).skills.testing.ref;
    const next = (await git("rev-parse", "HEAD")).stdout.trim();
    await run(["update", "--latest", "--yes"]);
    expect(printed(out)).toContain(`${before.slice(0, 12)} -> ${next}`);
    expect(await read(skillFile)).toContain("v2");
    expect((await manifest()).skills.testing).toMatchObject({ ref: next, market: "skillsmp" });
  });

  it("does not move without confirmation when not interactive", async () => {
    if (process.stdin.isTTY) return;
    const before = (await manifest()).skills.testing.ref;
    await expect(run(["update", "--latest"])).rejects.toThrow("--yes");
    expect(await read(skillFile)).toContain("v1");
    expect((await manifest()).skills.testing.ref).toBe(before);
  });
});
