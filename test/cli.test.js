import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const bin = path.resolve("bin/spm.js");

let globalDir;
let project;
let repoDir;
let cache;
const git = (...args) => run("git", args, { cwd: repoDir });
const spm = (...args) =>
  run(process.execPath, [bin, ...args], {
    cwd: project,
    env: {
      ...process.env,
      SPM_GLOBAL_DIR: globalDir,
      SPM_CACHE_DIR: cache,
      SPM_REPO: undefined,
    },
  });

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spm-cli-"));
  globalDir = path.join(root, "global");
  project = path.join(root, "project");
  repoDir = path.join(root, "repo");
  cache = path.join(root, "cache");
  await fs.mkdir(path.join(globalDir, "other"), { recursive: true });
  await fs.writeFile(path.join(globalDir, "other", "SKILL.md"), "---\ndescription: Global\n---\n");
  await fs.mkdir(path.join(repoDir, "skills", "demo"), { recursive: true });
  await fs.writeFile(
    path.join(repoDir, "skills", "demo", "SKILL.md"),
    "---\ndescription: A demo\n---\n",
  );
  await git("init", "-q");
  await git("add", ".");
  await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  await fs.mkdir(project);
});
afterEach(() => fs.rm(path.dirname(globalDir), { recursive: true, force: true }));

describe("spm cli", () => {
  it("shows help", async () => {
    const { stdout } = await spm("--help");
    expect(stdout).toContain("Usage:");
  });

  it("lists available skills from the repo", async () => {
    await spm("init", repoDir);
    const { stdout } = await spm("available");
    expect(stdout).toContain("demo");
    expect(stdout).toContain("A demo");
  });

  it("installs, lists and uninstalls a skill", async () => {
    await spm("init", repoDir);
    await spm("install", "demo");
    await fs.access(path.join(project, ".claude", "skills", "demo", "SKILL.md"));
    expect((await spm("list")).stdout).toContain("demo");
    await spm("uninstall", "demo");
    expect((await spm("list")).stdout).toContain("No skills installed");
  });

  it("records skills in spm.json at the project root and hashes inside .claude", async () => {
    await spm("init", repoDir);
    await spm("install", "demo");
    const manifest = JSON.parse(await fs.readFile(path.join(project, "spm.json"), "utf8"));
    expect(manifest).toMatchObject({ repos: [repoDir], skills: { demo: repoDir } });
    await fs.access(path.join(project, ".claude", ".spm-state.json"));
    await expect(fs.access(path.join(project, ".claude", "skills.json"))).rejects.toThrow();
  });

  it("recreates .claude/skills from spm.json after .claude is deleted", async () => {
    await spm("init", repoDir);
    await spm("install", "demo");
    await fs.rm(path.join(project, ".claude"), { recursive: true });
    await spm("install");
    await fs.access(path.join(project, ".claude", "skills", "demo", "SKILL.md"));
    expect((await spm("list")).stdout).not.toContain("untracked");
  });

  it("hides non-installed global skills via settings.json", async () => {
    await spm("init", repoDir);
    const settings = JSON.parse(
      await fs.readFile(path.join(project, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.skillOverrides.other).toBe("off");
  });

  it("fails to install when no repo is configured", async () => {
    await expect(spm("install", "demo")).rejects.toMatchObject({ code: 1 });
  });

  it("updates an installed skill when the repo changes", async () => {
    await spm("init", repoDir);
    await spm("install", "demo");
    await fs.appendFile(path.join(repoDir, "skills", "demo", "SKILL.md"), "more\n");
    await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "edit");
    expect((await spm("update")).stdout).toContain("updated");
    const text = await fs.readFile(
      path.join(project, ".claude", "skills", "demo", "SKILL.md"),
      "utf8",
    );
    expect(text).toContain("more");
  });

  it("fails on an unknown command", async () => {
    await expect(spm("nope")).rejects.toMatchObject({ code: 1 });
  });

  it("prints the package version with --version and -v", async () => {
    const { version } = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8"));
    expect((await spm("--version")).stdout.trim()).toBe(version);
    expect((await spm("-v")).stdout.trim()).toBe(version);
  });

  it("installs a skill found in a nested skills/ folder by name", async () => {
    await fs.mkdir(path.join(repoDir, "pkg", "skills", "deep"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "pkg", "skills", "deep", "SKILL.md"), "---\n---\n");
    await git("add", ".");
    await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "deep");
    await spm("init", repoDir);
    await spm("install", "deep");
    await fs.access(path.join(project, ".claude", "skills", "deep", "SKILL.md"));
  });

  it("reports an unknown skill with a suggestion and exits non-zero", async () => {
    await spm("init", repoDir);
    const err = await spm("install", "demo-extra").catch((e) => e);
    expect(err.code).toBe(1);
    expect(err.stderr).toContain("not found");
    expect(err.stderr).toContain("did you mean: demo");
    const manifest = JSON.parse(await fs.readFile(path.join(project, "spm.json"), "utf8"));
    expect(manifest.skills).not.toHaveProperty("demo-extra");
  });

  it("keeps local edits on re-install unless --force is given", async () => {
    await spm("init", repoDir);
    await spm("install", "demo");
    const file = path.join(project, ".claude", "skills", "demo", "SKILL.md");
    await fs.appendFile(file, "local\n");
    expect((await spm("install", "demo")).stdout).toContain("already installed");
    expect(await fs.readFile(file, "utf8")).toContain("local");
    expect((await spm("list")).stdout).toContain("(modified)");
    await spm("install", "demo", "--force");
    expect(await fs.readFile(file, "utf8")).not.toContain("local");
  });

  it("update reports up to date, and flags skills removed from the repo", async () => {
    await spm("init", repoDir);
    await spm("install", "demo");
    expect((await spm("update")).stdout).toContain("up to date");
    await git("rm", "-rq", "skills");
    await git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "rm");
    const err = await spm("update").catch((e) => e);
    expect(err.code).toBe(1);
    expect(err.stderr).toContain("no longer in the repo");
  });

  it("uninstall of an unknown skill fails; --no-isolate lifts global overrides", async () => {
    await spm("init", repoDir);
    await expect(spm("uninstall", "ghost")).rejects.toMatchObject({ code: 1 });
    await spm("init", "--no-isolate");
    const settings = JSON.parse(
      await fs.readFile(path.join(project, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.skillOverrides?.other).toBeUndefined();
  });

  describe("repo pool", () => {
    let second;
    beforeEach(async () => {
      second = path.join(path.dirname(repoDir), "repo2");
      for (const name of ["demo", "extra"]) {
        await fs.mkdir(path.join(second, "skills", name), { recursive: true });
        await fs.writeFile(
          path.join(second, "skills", name, "SKILL.md"),
          `---
description: Second ${name}
---
`,
        );
      }
      const g = (...args) => run("git", args, { cwd: second });
      await g("init", "-q");
      await g("add", ".");
      await g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    });

    const manifestOf = async () =>
      JSON.parse(await fs.readFile(path.join(project, "spm.json"), "utf8"));

    it("adds repos, searches all of them and pins each skill to its source", async () => {
      await spm("init", repoDir);
      expect((await spm("repo", "add", second)).stdout).toContain("added");
      expect((await spm("repo", "add", second)).stdout).toContain("already in the pool");
      await spm("install", "extra");
      expect((await manifestOf()).skills.extra).toBe(second);
      const { stdout } = await spm("available");
      expect(stdout).toContain("extra");
      expect(stdout).toContain("A demo");
      expect(stdout).toContain("Second demo");
    });

    it("takes the first repo on a clash, warns, and honors --from", async () => {
      await spm("init", repoDir);
      await spm("repo", "add", second);
      const first = await spm("install", "demo");
      expect(first.stderr).toContain("also in");
      expect((await manifestOf()).skills.demo).toBe(repoDir);
      await spm("install", "demo", "--force", "--from", second);
      expect((await manifestOf()).skills.demo).toBe(second);
      const skill = path.join(project, ".claude", "skills", "demo", "SKILL.md");
      expect(await fs.readFile(skill, "utf8")).toContain("Second demo");
      await fs.rm(path.join(project, ".claude"), { recursive: true });
      await spm("install");
      expect(await fs.readFile(skill, "utf8")).toContain("Second demo");
    });

    it("rejects --from for a repo outside the pool", async () => {
      await spm("init", repoDir);
      const err = await spm("install", "demo", "--from", second).catch((e) => e);
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("not in the repo pool");
    });

    it("refuses to remove a repo that installed skills use unless forced", async () => {
      await spm("init", repoDir);
      await spm("repo", "add", second);
      await spm("install", "extra");
      const err = await spm("repo", "rm", second).catch((e) => e);
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("extra");
      await spm("repo", "rm", second, "--force");
      const m = await manifestOf();
      expect(m.repos).toEqual([repoDir]);
      expect(m.skills.extra).toBeNull();
    });

    it("migrates a legacy spm.json and lists the pool", async () => {
      await fs.writeFile(
        path.join(project, "spm.json"),
        JSON.stringify({ repo: repoDir, skills: ["demo"], isolate: true }),
      );
      await spm("install");
      await fs.access(path.join(project, ".claude", "skills", "demo", "SKILL.md"));
      expect((await spm("repo", "list")).stdout).toContain("(1 installed)");
      const m = await manifestOf();
      expect(m).toMatchObject({ repos: [repoDir], skills: { demo: repoDir }, isolate: true });
      expect(m).not.toHaveProperty("repo");
    });
  });
});
