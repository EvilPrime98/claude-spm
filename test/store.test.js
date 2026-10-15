import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashDir,
  listSkills,
  readManifest,
  readState,
  writeManifest,
  writeState,
} from "../src/store.js";

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "spm-store-"));
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

const makeSkill = async (root, name, body = "---\nname: x\n---\n") => {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, "SKILL.md"), body);
};

describe("store", () => {
  it("lists only folders containing SKILL.md, sorted", async () => {
    await makeSkill(tmp, "b");
    await makeSkill(tmp, "a");
    await fs.mkdir(path.join(tmp, "empty"));
    expect(await listSkills(tmp)).toEqual(["a", "b"]);
  });

  it("hashes content deterministically and detects changes", async () => {
    await makeSkill(tmp, "a");
    const before = await hashDir(path.join(tmp, "a"));
    expect(await hashDir(path.join(tmp, "a"))).toBe(before);
    await fs.writeFile(path.join(tmp, "a", "SKILL.md"), "changed");
    expect(await hashDir(path.join(tmp, "a"))).not.toBe(before);
  });

  it("returns an empty manifest when the file is missing and round-trips sorted", async () => {
    const file = path.join(tmp, "spm.json");
    expect(await readManifest(file)).toEqual({ skills: [] });
    await writeManifest(file, { repo: "o/r", skills: ["b", "a", "b"] });
    expect(await readManifest(file)).toEqual({ repo: "o/r", skills: ["a", "b"] });
  });

  it("round-trips the install state", async () => {
    const file = path.join(tmp, ".claude", ".spm-state.json");
    expect(await readState(file)).toEqual({ skills: {} });
    await writeState(file, { skills: { b: { hash: "2" }, a: { hash: "1" } } });
    expect(Object.keys((await readState(file)).skills)).toEqual(["a", "b"]);
  });
});
