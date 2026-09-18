import { cachedFetch } from "@/provider/cache";

/**
 * Commodity exchange prices from FIO.
 *
 * `/exchange/all` returns every material on every exchange in one response, so
 * pricing a whole shopping list costs a single request rather than one per
 * material. Prices move, so this is cached for minutes rather than the day-long
 * TTL used for material and building definitions.
 */

const BASE_URL = import.meta.env.VITE_FIO_REST_BASE_URL ?? "https://rest.fnar.net";
const PRICE_TTL_MS = 30 * 60 * 1000;

export const EXCHANGES = ["AI1", "CI1", "CI2", "IC1", "NC1", "NC2"] as const;
export type ExchangeCode = (typeof EXCHANGES)[number];

export type MarketPrice = {
  ticker: string;
  exchange: string;
  /** Lowest sell order: what buying right now actually costs. */
  ask: number | null;
  /** Highest buy order: what selling right now actually pays. */
  bid: number | null;
  average: number | null;
  /** Units currently listed for sale. */
  supply: number | null;
};

type RawEntry = {
  MaterialTicker?: unknown;
  ExchangeCode?: unknown;
  Ask?: unknown;
  Bid?: unknown;
  PriceAverage?: unknown;
  Supply?: unknown;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchAll(): Promise<RawEntry[]> {
  return cachedFetch(
    `market:${BASE_URL}/exchange/all`,
    async () => {
      const response = await fetch(`${BASE_URL}/exchange/all`, { headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error(`FIO exchange request failed (${response.status})`);
      return (await response.json()) as RawEntry[];
    },
    PRICE_TTL_MS,
  );
}

/** Prices for one exchange, keyed by material ticker. */
export async function getExchangePrices(exchange: string): Promise<Map<string, MarketPrice>> {
  const wanted = exchange.trim().toUpperCase();
  const entries = await fetchAll();
  const prices = new Map<string, MarketPrice>();

  for (const entry of entries) {
    const ticker = typeof entry.MaterialTicker === "string" ? entry.MaterialTicker.toUpperCase() : null;
    const code = typeof entry.ExchangeCode === "string" ? entry.ExchangeCode.toUpperCase() : null;
    if (!ticker || code !== wanted) continue;

    prices.set(ticker, {
      ticker,
      exchange: code,
      ask: num(entry.Ask),
      bid: num(entry.Bid),
      average: num(entry.PriceAverage),
      supply: num(entry.Supply),
    });
  }

  return prices;
}
