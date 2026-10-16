import { afterEach, describe, expect, it } from "vitest";
import { parseRepo, repoSpec } from "../src/repo.js";

const original = process.env.SPM_REPO;
afterEach(() => {
  if (original === undefined) delete process.env.SPM_REPO;
  else process.env.SPM_REPO = original;
});

describe("parseRepo", () => {
  it("expands owner/repo to a GitHub URL", () => {
    expect(parseRepo("owner/repo")).toEqual({
      url: "https://github.com/owner/repo.git",
      ref: undefined,
    });
  });

  it("splits an optional #ref", () => {
    expect(parseRepo("owner/repo#v2")).toEqual({
      url: "https://github.com/owner/repo.git",
      ref: "v2",
    });
  });

  it("ignores an empty ref and keeps URLs and paths untouched", () => {
    expect(parseRepo("owner/repo#").ref).toBeUndefined();
    expect(parseRepo("https://example.com/a/b.git").url).toBe("https://example.com/a/b.git");
    expect(parseRepo("/tmp/some/path").url).toBe("/tmp/some/path");
  });
});

describe("repoSpec", () => {
  it("prefers SPM_REPO over the manifest", () => {
    process.env.SPM_REPO = "env/repo";
    expect(repoSpec({ repo: "manifest/repo" })).toBe("env/repo");
  });

  it("falls back to the manifest", () => {
    delete process.env.SPM_REPO;
    expect(repoSpec({ repo: "manifest/repo" })).toBe("manifest/repo");
  });

  it("throws when nothing is configured", () => {
    delete process.env.SPM_REPO;
    expect(() => repoSpec({})).toThrow(/spm init/);
  });
});

describe("parseRepo subpaths", () => {
  it("parses GitHub tree URLs", () => {
    expect(parseRepo("https://github.com/cursor/plugins/tree/main/pstack")).toEqual({
      url: "https://github.com/cursor/plugins.git",
      ref: "main",
      subdir: "pstack",
    });
  });

  it("parses owner/repo/subdir", () => {
    const r = parseRepo("cursor/plugins/pstack#dev");
    expect(r).toEqual({
      url: "https://github.com/cursor/plugins.git",
      ref: "dev",
      subdir: "pstack",
    });
  });

  it("rejects '..' segments in the subdirectory", () => {
    expect(() => parseRepo("owner/repo/../../x")).toThrow(/\.\./);
    expect(() => parseRepo("https://github.com/o/r/tree/main/a/../b")).toThrow(/\.\./);
  });

  it("treats an existing relative directory as a local path", () => {
    const r = parseRepo("test/../src");
    expect(r.subdir).toBeUndefined();
    expect(r.url).toBe("test/../src");
  });

  it("leaves local paths alone", () => {
    expect(parseRepo("/tmp/some/path").subdir).toBeUndefined();
  });
});
