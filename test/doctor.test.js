import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildReport,
  disableGlobal,
  estimateTokens,
  findOverlaps,
  parseSkill,
  transcriptFolder,
  usageCounts,
} from "../src/doctor.js";

const run = promisify(execFile);
const bin = path.resolve("bin/spm.js");

let root;
let project;
let globalDir;
let claudeDir;

const skill = (dir, name, description, body = "body") =>
  fs
    .mkdir(path.join(dir, name), { recursive: true })
    .then(() =>
      fs.writeFile(
        path.join(dir, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
      ),
    );

const transcript = (lines) => {
  const dir = path.join(claudeDir, "projects", transcriptFolder(project));
  return fs
    .mkdir(dir, { recursive: true })
    .then(() =>
      fs.writeFile(path.join(dir, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n")),
    );
};

const skillCall = (skill, timestamp = new Date().toISOString()) => ({
  type: "assistant",
  timestamp,
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

const spm = (...args) =>
  run(process.execPath, [bin, ...args], {
    cwd: project,
    env: { ...process.env, SPM_GLOBAL_DIR: globalDir, SPM_CLAUDE_DIR: claudeDir },
  });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spm-doctor-"));
  project = path.join(root, "project");
  globalDir = path.join(root, "global");
  claudeDir = path.join(root, "claude");
  await fs.mkdir(path.join(project, ".claude", "skills"), { recursive: true });
  await fs.mkdir(globalDir);
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe("helpers", () => {
  it("estimates tokens as chars/4", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("parses front matter and body", () => {
    expect(parseSkill('---\nname: x\ndescription: "Does x"\n---\nhello')).toEqual({
      name: "x",
      description: "Does x",
      body: "hello",
    });
  });

  it("reads multi-line descriptions", () => {
    expect(parseSkill("---\nname: x\ndescription: >\n  one\n  two\nother: y\n---\nbody")).toEqual({
      name: "x",
      description: "one two",
      body: "body",
    });
  });

  it("finds descriptions that say the same thing", () => {
    const pairs = findOverlaps([
      { name: "a", text: "Review pull requests and write review comments on the diff" },
      { name: "b", text: "Review pull requests, writing review comments on a diff" },
      { name: "c", text: "Generate release notes from the changelog" },
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a, pairs[0].b]).toEqual(["a", "b"]);
  });
});

describe("usageCounts", () => {
  it("counts Skill calls and slash commands inside the window", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    await transcript([
      skillCall("alpha"),
      skillCall("plugin:alpha"),
      skillCall("alpha", old),
      {
        type: "user",
        timestamp: new Date().toISOString(),
        message: { content: "<command-name>/beta</command-name>\n<command-args></command-args>" },
      },
    ]);
    const { counts, files } = await usageCounts(project, {
      projectsDir: path.join(claudeDir, "projects"),
    });
    expect(files).toBe(1);
    expect(counts.get("alpha")).toBe(2);
    expect(counts.get("beta")).toBe(1);
  });

  it("returns nothing when the project has no transcripts", async () => {
    const { counts, files } = await usageCounts(project, {
      projectsDir: path.join(claudeDir, "projects"),
    });
    expect(files).toBe(0);
    expect(counts.size).toBe(0);
  });
});

describe("buildReport", () => {
  const input = (extra) => ({
    manifest: { skills: { managed: "o/r" } },
    skillsDir: path.join(project, ".claude", "skills"),
    globalDir,
    counts: new Map(),
    hasUsage: true,
    ...extra,
  });

  it("covers spm, hand-written and global skills, skipping those turned off or shadowed", async () => {
    const local = path.join(project, ".claude", "skills");
    await skill(local, "managed", "Manages things");
    await skill(local, "mine", "Hand written");
    await skill(globalDir, "visible", "Global one");
    await skill(globalDir, "hidden", "Global off");
    await skill(globalDir, "mine", "Shadowed");
    const report = await buildReport(input({ overrides: { hidden: "off" } }));
    const sources = Object.fromEntries(report.skills.map((s) => [s.name, s.source]));
    expect(sources).toEqual({ managed: "spm", mine: "project", visible: "global" });
  });

  it("flags unused skills only when usage is known", async () => {
    await skill(path.join(project, ".claude", "skills"), "managed", "Manages things");
    expect((await buildReport(input({ hasUsage: false }))).skills[0].flagged).toBe(false);
    const used = await buildReport(input({ counts: new Map([["managed", 3]]) }));
    expect(used.skills[0]).toMatchObject({ uses: 3, flagged: false });
    expect((await buildReport(input())).skills[0].reasons).toEqual(["unused"]);
  });

  it("flags the less used of two overlapping skills", async () => {
    const local = path.join(project, ".claude", "skills");
    const text = "Review pull requests and write review comments on the diff";
    await skill(local, "one", text);
    await skill(local, "two", text);
    const report = await buildReport(
      input({
        counts: new Map([
          ["one", 5],
          ["two", 1],
        ]),
      }),
    );
    const two = report.skills.find((s) => s.name === "two");
    expect(two.reasons).toEqual([expect.stringMatching(/^overlaps one \(\d+%\)$/)]);
    expect(report.skills.find((s) => s.name === "one").flagged).toBe(false);
  });

  it("advises isolation when global descriptions dominate", async () => {
    await skill(globalDir, "big", "x ".repeat(1500));
    const report = await buildReport(input({ counts: new Map([["big", 1]]) }));
    expect(report.advice[0]).toContain("spm init");
    const isolated = await buildReport(
      input({ manifest: { skills: {}, isolate: true }, counts: new Map([["big", 1]]) }),
    );
    expect(isolated.advice).toEqual([]);
  });
});

describe("disableGlobal", () => {
  it("adds off overrides and keeps existing settings", async () => {
    const file = path.join(project, ".claude", "settings.json");
    await fs.writeFile(file, JSON.stringify({ model: "x", skillOverrides: { a: "off" } }));
    await disableGlobal(file, ["b"]);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
      model: "x",
      skillOverrides: { a: "off", b: "off" },
    });
  });
});

describe("spm doctor", () => {
  it("prints JSON and changes nothing", async () => {
    await skill(path.join(project, ".claude", "skills"), "mine", "Hand written");
    await transcript([skillCall("mine")]);
    const { stdout } = await spm("doctor", "--json");
    const report = JSON.parse(stdout);
    expect(report.transcripts).toBe(1);
    expect(report.skills[0]).toMatchObject({ name: "mine", uses: 1, flagged: false });
  });

  it("removes flagged skills with --yes and turns off flagged global ones", async () => {
    await skill(path.join(project, ".claude", "skills"), "stale", "Does stale things");
    await skill(globalDir, "idle", "Global idle thing");
    await skill(path.join(project, ".claude", "skills"), "used", "Used for other work");
    await transcript([skillCall("used")]);
    const { stdout } = await spm("doctor", "--yes");
    expect(stdout).toContain("removed stale");
    await expect(fs.access(path.join(project, ".claude", "skills", "stale"))).rejects.toThrow();
    await fs.access(path.join(project, ".claude", "skills", "used"));
    const settings = JSON.parse(
      await fs.readFile(path.join(project, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.skillOverrides).toEqual({ idle: "off" });
  });

  it("only reports without a terminal and without --yes", async () => {
    await skill(path.join(project, ".claude", "skills"), "stale", "Does stale things");
    await transcript([]);
    const { stdout } = await spm("doctor");
    expect(stdout).toContain("unused");
    await fs.access(path.join(project, ".claude", "skills", "stale"));
  });

  it("rejects a bad --days", async () => {
    await expect(spm("doctor", "--days", "abc")).rejects.toThrow();
  });
});
