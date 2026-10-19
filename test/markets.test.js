import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMarket, parseMarketRef } from "../src/markets/index.js";
import { skillsmp } from "../src/markets/skillsmp.js";

const skill = (over = {}) => ({
  name: "testing",
  author: "acme",
  description: "Run tests",
  githubUrl: "https://github.com/acme/tools/tree/main/skills/testing",
  stars: 10,
  ...over,
});
const ok = (skills) =>
  new Response(JSON.stringify({ success: true, data: { skills } }), { status: 200 });

describe("market registry", () => {
  it("parses <market>:<id> references and ignores everything else", () => {
    expect(parseMarketRef("skillsmp:acme/testing")).toEqual({
      market: "skillsmp",
      id: "acme/testing",
    });
    expect(parseMarketRef("testing")).toBeUndefined();
    expect(parseMarketRef("https://github.com/o/r")).toBeUndefined();
    expect(parseMarketRef("skillsmp:")).toBeUndefined();
    expect(parseMarketRef("C:\\skills")).toBeUndefined();
  });

  it("rejects an unknown market", () => {
    expect(() => getMarket("nope")).toThrow(/unknown market "nope" \(available: skillsmp\)/);
    expect(getMarket("skillsmp")).toBe(skillsmp);
  });
});

describe("skillsmp", () => {
  const fetchMock = vi.fn();
  const savedKey = process.env.SKILLSMP_API_KEY;
  beforeEach(() => {
    delete process.env.SKILLSMP_API_KEY;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey !== undefined) process.env.SKILLSMP_API_KEY = savedKey;
  });

  it("searches by keyword and maps hits to a repo spec", async () => {
    fetchMock.mockImplementation(async () => ok([skill()]));
    const hits = await skillsmp.search("test runner");
    expect(hits).toEqual([
      {
        name: "testing",
        author: "acme",
        description: "Run tests",
        repo: "https://github.com/acme/tools/tree/main/skills/testing",
        stars: 10,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get("q")).toBe("test runner");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers["User-Agent"]).toContain("spm");
  });

  it("sends the API key as a bearer token when set", async () => {
    process.env.SKILLSMP_API_KEY = "sk_live_x";
    fetchMock.mockImplementation(async () => ok([]));
    await skillsmp.search("x");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk_live_x");
  });

  it("drops hits that are not on GitHub", async () => {
    fetchMock.mockImplementation(async () =>
      ok([skill({ githubUrl: "https://evil.example/acme/tools" }), skill({ githubUrl: null })]),
    );
    expect(await skillsmp.search("testing")).toEqual([]);
  });

  it("surfaces the rate limit with the retry delay", async () => {
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 429, headers: { "Retry-After": "30" } }),
    );
    await expect(skillsmp.search("x")).rejects.toThrow(/rate limit.*30s.*SKILLSMP_API_KEY/);
  });

  it("surfaces API errors", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ success: false, error: { message: "bad key" } }), {
          status: 401,
        }),
    );
    await expect(skillsmp.search("x")).rejects.toThrow("skillsmp: bad key");
  });

  it("resolves an exact name, and author/name when several authors publish it", async () => {
    fetchMock.mockImplementation(async () =>
      ok([skill(), skill({ author: "other" }), skill({ name: "testing-extra" })]),
    );
    await expect(skillsmp.resolve("testing")).rejects.toThrow(
      /ambiguous.*skillsmp:acme\/testing.*skillsmp:other\/testing/,
    );
    expect((await skillsmp.resolve("other/testing")).author).toBe("other");
    await expect(skillsmp.resolve("ghost/testing")).rejects.toThrow('no skill "ghost/testing"');
  });

  it("collapses translated copies that share a source", async () => {
    fetchMock.mockImplementation(async () =>
      ok([skill(), skill({ description: "Ejecuta pruebas", contentLanguage: "es" })]),
    );
    expect(await skillsmp.search("testing")).toHaveLength(1);
    expect((await skillsmp.resolve("acme/testing")).description).toBe("Run tests");
  });

  it("resolves a unique name without an author", async () => {
    fetchMock.mockImplementation(async () => ok([skill(), skill({ name: "testing-extra" })]));
    expect((await skillsmp.resolve("testing")).name).toBe("testing");
  });
});
