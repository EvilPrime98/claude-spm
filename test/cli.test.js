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
});
