import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copySkill,
  describe as describeSkill,
  exists,
  listSkills,
  readManifest,
  removeOverrides,
  skillNames,
  syncOverrides,
  writeManifest,
} from "../src/store.js";

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "spm-helpers-"));
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

const makeSkill = async (root, name, body = "---\nname: x\n---\n") => {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, "SKILL.md"), body);
};
const read = async (f) => JSON.parse(await fs.readFile(f, "utf8"));

describe("store helpers", () => {
  it("exists reports presence", async () => {
    expect(await exists(tmp)).toBe(true);
    expect(await exists(path.join(tmp, "nope"))).toBe(false);
  });

  it("describe reads and unquotes the description, or returns empty", async () => {
    await makeSkill(tmp, "q", '---\nname: q\ndescription: "Quoted text"\n---\n');
    await makeSkill(tmp, "none", "---\nname: none\n---\n");
    expect(await describeSkill(path.join(tmp, "q"))).toBe("Quoted text");
    expect(await describeSkill(path.join(tmp, "none"))).toBe("");
  });

  it("skillNames includes folder name and front matter name", async () => {
    await makeSkill(tmp, "folder", "---\nname: 'real-name'\n---\n");
    expect([...(await skillNames(tmp, "folder"))].sort()).toEqual(["folder", "real-name"]);
  });

  it("copySkill replaces the destination entirely", async () => {
    await makeSkill(tmp, "src");
    await fs.mkdir(path.join(tmp, "dest"));
    await fs.writeFile(path.join(tmp, "dest", "stale.txt"), "old");
    await copySkill(path.join(tmp, "src"), path.join(tmp, "dest"));
    await fs.access(path.join(tmp, "dest", "SKILL.md"));
    await expect(fs.access(path.join(tmp, "dest", "stale.txt"))).rejects.toThrow();
  });

  it("listSkills ignores hidden folders and a missing directory", async () => {
    await makeSkill(tmp, ".hidden");
    await makeSkill(tmp, "shown");
    expect(await listSkills(tmp)).toEqual(["shown"]);
    expect(await listSkills(path.join(tmp, "missing"))).toEqual([]);
  });

  it("readManifest throws a descriptive error on invalid JSON", async () => {
    const file = path.join(tmp, "spm.json");
    await fs.writeFile(file, "{ not json");
    await expect(readManifest(file)).rejects.toThrow(/could not parse/);
  });

  it("manifest round-trip preserves extra fields such as isolate", async () => {
    const file = path.join(tmp, "spm.json");
    await writeManifest(file, { repo: "o/r", isolate: true, skills: [] });
    expect(await readManifest(file)).toEqual({ repo: "o/r", isolate: true, skills: [] });
  });
});

describe("overrides", () => {
  it("syncOverrides hides global skills but not ones installed locally", async () => {
    const globalDir = path.join(tmp, "g");
    const localDir = path.join(tmp, "l");
    const settingsFile = path.join(tmp, ".claude", "settings.json");
    await makeSkill(globalDir, "a");
    await makeSkill(globalDir, "b");
    await makeSkill(localDir, "b");
    await syncOverrides({ settingsFile, globalDir, localDir });
    expect((await read(settingsFile)).skillOverrides).toEqual({ a: "off" });
  });

  it("syncOverrides preserves unrelated settings and lifts stale off entries", async () => {
    const globalDir = path.join(tmp, "g");
    const localDir = path.join(tmp, "l");
    const settingsFile = path.join(tmp, "settings.json");
    await makeSkill(globalDir, "b");
    await makeSkill(localDir, "b");
    await fs.writeFile(
      settingsFile,
      JSON.stringify({ theme: "dark", skillOverrides: { b: "off", keep: "on" } }),
    );
    await syncOverrides({ settingsFile, globalDir, localDir });
    expect(await read(settingsFile)).toEqual({ theme: "dark", skillOverrides: { keep: "on" } });
  });

  it("syncOverrides rejects unparseable settings", async () => {
    const settingsFile = path.join(tmp, "settings.json");
    await fs.writeFile(settingsFile, "oops");
    await expect(syncOverrides({ settingsFile, globalDir: tmp, localDir: tmp })).rejects.toThrow(
      /could not parse/,
    );
  });

  it("removeOverrides drops off entries and the empty skillOverrides key", async () => {
    const globalDir = path.join(tmp, "g");
    const settingsFile = path.join(tmp, "settings.json");
    await makeSkill(globalDir, "a");
    await fs.writeFile(settingsFile, JSON.stringify({ x: 1, skillOverrides: { a: "off" } }));
    await removeOverrides(settingsFile, globalDir);
    expect(await read(settingsFile)).toEqual({ x: 1 });
  });

  it("removeOverrides keeps non-off entries and tolerates a missing file", async () => {
    const globalDir = path.join(tmp, "g");
    const settingsFile = path.join(tmp, "settings.json");
    await makeSkill(globalDir, "a");
    await fs.writeFile(settingsFile, JSON.stringify({ skillOverrides: { a: "off", z: "on" } }));
    await removeOverrides(settingsFile, globalDir);
    expect((await read(settingsFile)).skillOverrides).toEqual({ z: "on" });
    await expect(
      removeOverrides(path.join(tmp, "missing.json"), globalDir),
    ).resolves.toBeUndefined();
  });
});
