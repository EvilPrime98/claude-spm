import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cacheDir, globalSkillsDir, projectPaths } from "../src/paths.js";

const saved = {
  SPM_GLOBAL_DIR: process.env.SPM_GLOBAL_DIR,
  SPM_CACHE_DIR: process.env.SPM_CACHE_DIR,
};
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("paths", () => {
  it("globalSkillsDir honours SPM_GLOBAL_DIR and defaults to ~/.claude/skills", () => {
    process.env.SPM_GLOBAL_DIR = "/custom/global";
    expect(globalSkillsDir()).toBe("/custom/global");
    delete process.env.SPM_GLOBAL_DIR;
    expect(globalSkillsDir()).toBe(path.join(os.homedir(), ".claude", "skills"));
  });

  it("cacheDir honours SPM_CACHE_DIR and defaults to ~/.cache/spm", () => {
    process.env.SPM_CACHE_DIR = "/custom/cache";
    expect(cacheDir()).toBe("/custom/cache");
    delete process.env.SPM_CACHE_DIR;
    expect(cacheDir()).toBe(path.join(os.homedir(), ".cache", "spm"));
  });

  it("projectPaths puts spm.json at the root and state/settings under .claude", () => {
    const root = path.join(os.tmpdir(), "proj");
    expect(projectPaths(root)).toEqual({
      claudeDir: path.join(root, ".claude"),
      skillsDir: path.join(root, ".claude", "skills"),
      manifest: path.join(root, "spm.json"),
      state: path.join(root, ".claude", ".spm-state.json"),
      settings: path.join(root, ".claude", "settings.json"),
    });
  });
});
