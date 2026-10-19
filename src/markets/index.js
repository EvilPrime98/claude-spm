import { skillsmp } from "./skillsmp.js";

/** @type {Object<string, {id: string, search(term: string): Promise<import("./skillsmp.js").MarketHit[]>, resolve(id: string): Promise<import("./skillsmp.js").MarketHit>}>} */
export const markets = { [skillsmp.id]: skillsmp };

/**
 * Looks up a market by id.
 *
 * @param {string} id Market id.
 * @returns {typeof markets[string]} The market.
 * @throws {Error} If no market has that id.
 */
export function getMarket(id) {
  if (!Object.hasOwn(markets, id)) {
    throw new Error(`unknown market "${id}" (available: ${Object.keys(markets).join(", ")})`);
  }
  return markets[id];
}

/**
 * Splits a `<market>:<id>` reference.
 *
 * @param {string} arg Command-line argument.
 * @returns {{market: string, id: string}|undefined} The parts, or `undefined` when `arg` does not start with a known market id.
 */
export function parseMarketRef(arg) {
  const i = arg.indexOf(":");
  if (i < 1 || !Object.hasOwn(markets, arg.slice(0, i)) || i === arg.length - 1) return undefined;
  return { market: arg.slice(0, i), id: arg.slice(i + 1) };
}
