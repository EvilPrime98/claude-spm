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
const spm = (...args) =>
  run(process.execPath, [bin, ...args], {
    cwd: project,
    env: { ...process.env, SPM_GLOBAL_DIR: globalDir },
  });

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spm-cli-"));
  globalDir = path.join(root, "global");
  project = path.join(root, "project");
  await fs.mkdir(path.join(globalDir, "demo"), { recursive: true });
  await fs.writeFile(path.join(globalDir, "demo", "SKILL.md"), "---\ndescription: A demo\n---\n");
  await fs.mkdir(project);
});
afterEach(() => fs.rm(path.dirname(globalDir), { recursive: true, force: true }));

describe("spm cli", () => {
  it("shows help", async () => {
    const { stdout } = await spm("--help");
    expect(stdout).toContain("Usage:");
  });

  it("lists available skills", async () => {
    const { stdout } = await spm("available");
    expect(stdout).toContain("demo");
    expect(stdout).toContain("A demo");
  });

  it("installs, lists and uninstalls a skill", async () => {
    await spm("install", "demo");
    await fs.access(path.join(project, ".claude", "skills", "demo", "SKILL.md"));
    expect((await spm("list")).stdout).toContain("demo");
    await spm("uninstall", "demo");
    expect((await spm("list")).stdout).toContain("No skills installed");
  });

  it("hides non-installed global skills via settings.json", async () => {
    await spm("init");
    const settings = JSON.parse(
      await fs.readFile(path.join(project, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.skillOverrides.demo).toBe("off");
  });

  it("fails on an unknown command", async () => {
    await expect(spm("nope")).rejects.toMatchObject({ code: 1 });
  });
});
