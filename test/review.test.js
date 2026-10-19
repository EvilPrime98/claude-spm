import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirm, formatReview, inspectSkill } from "../src/review.js";

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "spm-review-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("inspectSkill", () => {
  it("lists files and reports no flags for a plain skill", async () => {
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: x\n---\nhello");
    await fs.mkdir(path.join(dir, "refs"));
    await fs.writeFile(path.join(dir, "refs", "a.md"), "abc");
    const r = await inspectSkill(dir);
    expect(r.files.map((f) => f.path)).toEqual(["refs/a.md", "SKILL.md"]);
    expect(r.size).toBe(r.files.reduce((n, f) => n + f.size, 0));
    expect(r.flags).toEqual([]);
  });

  it("flags scripts, binaries and allowed-tools", async () => {
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      "---\nname: x\nallowed-tools: Bash, Read\n---\n",
    );
    await fs.writeFile(path.join(dir, "run.sh"), "echo hi");
    await fs.mkdir(path.join(dir, "scripts"));
    await fs.writeFile(path.join(dir, "scripts", "tool"), "plain");
    await fs.writeFile(path.join(dir, "blob.dat"), Buffer.from([1, 0, 2]));
    const { flags } = await inspectSkill(dir);
    expect(flags).toEqual(
      expect.arrayContaining([
        "script or binary: run.sh",
        "script or binary: scripts/tool",
        "script or binary: blob.dat",
        "allowed-tools: Bash, Read",
      ]),
    );
  });

  it("reports symlinks instead of following them", async () => {
    await fs.writeFile(path.join(dir, "SKILL.md"), "x");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "spm-outside-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "s");
    try {
      await fs.symlink(path.join(outside, "secret.txt"), path.join(dir, "link"));
    } catch {
      return; // symlinks need privileges on some Windows setups
    }
    const r = await inspectSkill(dir);
    expect(r.symlinks).toEqual(["link"]);
    expect(r.files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });
});

describe("formatReview", () => {
  it("shows source, commit, hash, files and flags", async () => {
    const report = {
      files: [{ path: "SKILL.md", size: 2048 }],
      size: 2048,
      flags: ["script or binary: run.sh"],
      symlinks: [],
    };
    const text = formatReview(
      { name: "x", repo: "o/r/x", sha: "a".repeat(40), hash: "h1", market: "skillsmp" },
      report,
    );
    expect(text).toContain("Review x (from skillsmp)");
    expect(text).toContain("source  o/r/x");
    expect(text).toContain(`commit  ${"a".repeat(40)}`);
    expect(text).toContain("hash    h1");
    expect(text).toContain("SKILL.md  2.0 KB");
    expect(text).toContain("script or binary: run.sh");
  });

  it("shows the move between commits on update and truncates long file lists", () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ path: `f${i}`, size: 1 }));
    const text = formatReview(
      { name: "x", repo: "r", sha: "b".repeat(40), hash: "h", from: "a".repeat(40) },
      { files, size: 30, flags: [], symlinks: [] },
    );
    expect(text).toContain(`${"a".repeat(12)} -> ${"b".repeat(40)}`);
    expect(text).toContain("... 5 more");
  });
});

describe("confirm", () => {
  it("refuses to prompt when stdin is not a terminal", async () => {
    if (process.stdin.isTTY) return;
    await expect(confirm("ok?")).rejects.toThrow(/--yes/);
  });
});
