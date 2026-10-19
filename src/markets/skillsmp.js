/**
 * @typedef {Object} MarketHit
 * @property {string} name Skill name.
 * @property {string} [author] Who published it on the market.
 * @property {string} description
 * @property {string} repo Repo spec accepted by `parseRepo`, including the subdirectory.
 * @property {number} [stars] Stars of the source repo.
 */

const ENDPOINT = "https://skillsmp.com/api/v1/skills/search";
const GITHUB = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/|$)/;

async function query(q, limit) {
  const headers = { "User-Agent": "spm (claude-spm)", Accept: "application/json" };
  if (process.env.SKILLSMP_API_KEY)
    headers.Authorization = `Bearer ${process.env.SKILLSMP_API_KEY}`;
  const url = `${ENDPOINT}?${new URLSearchParams({ q, limit })}`;
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const wait = res.headers.get("retry-after");
    throw new Error(
      `skillsmp rate limit reached${wait ? `, retry in ${wait}s` : ""} (set SKILLSMP_API_KEY for a higher quota)`,
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(`skillsmp: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return body.data.skills;
}

// Only GitHub sources are accepted: anything else would not go through the normal clone path.
const toHit = (s) => ({
  name: s.name,
  author: s.author,
  description: s.description ?? "",
  repo: s.githubUrl,
  stars: s.stars,
});

/**
 * SkillsMP (https://skillsmp.com), through its public keyword-search REST API.
 *
 * Works anonymously (50 requests a day); `SKILLSMP_API_KEY` raises the quota.
 */
export const skillsmp = {
  id: "skillsmp",

  /**
   * Searches the market by keyword.
   *
   * @param {string} term Search term.
   * @returns {Promise<MarketHit[]>} Hits that live in a GitHub repo, most starred first.
   * @throws {Error} If the request fails or the rate limit is hit.
   */
  async search(term) {
    const hits = (await query(term, 20)).filter((s) => GITHUB.test(s.githubUrl ?? "")).map(toHit);
    // The market lists translated copies of one skill as separate entries; keep the first.
    const seen = new Set();
    return hits.filter((h) => {
      const key = `${h.author}/${h.name}/${h.repo}`;
      return !seen.has(key) && seen.add(key);
    });
  },

  /**
   * Resolves a market reference to a single hit.
   *
   * @param {string} id Skill name, or `author/name` to tell apart skills with the same name.
   * @returns {Promise<MarketHit>} The matching hit.
   * @throws {Error} If nothing matches, or several authors publish the name.
   */
  async resolve(id) {
    const [author, name] = id.includes("/") ? id.split("/") : [undefined, id];
    const hits = (await this.search(name)).filter(
      (h) => h.name === name && (!author || h.author === author),
    );
    if (!hits.length) throw new Error(`skillsmp: no skill "${id}" found`);
    if (hits.length > 1) {
      const options = hits.map((h) => `skillsmp:${h.author}/${h.name}`).join(", ");
      throw new Error(`skillsmp: "${id}" is ambiguous, pick one of: ${options}`);
    }
    return hits[0];
  },
};
