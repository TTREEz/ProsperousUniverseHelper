import type { MarketPrice } from "@/provider/market";
import type { ShoppingRow } from "@/planner/materials";

/**
 * Puts prices against a shopping list.
 *
 * The ask is what buying right now actually costs, so it is the price used. A
 * quarter of FIO's exchange records have no ask at all — nobody is selling —
 * and quietly substituting the recent average there would invent a price the
 * user cannot trade at. Those rows are reported as unpriced instead, and the
 * estimated total says how much of the list it could not cover.
 */

export type PricedRow = ShoppingRow & {
  ask: number | null;
  bid: number | null;
  average: number | null;
  supply: number | null;
  /** remainingToBuy × ask, or null when there is no ask. */
  estimatedCost: number | null;
  /** True when the exchange lists fewer units than the list needs. */
  shortSupply: boolean;
};

export type PricedPlan = {
  rows: PricedRow[];
  exchange: string;
  /** Sum of the rows that could be priced. */
  estimatedTotal: number;
  /** Rows with something to buy but no ask price. */
  unpricedTickers: string[];
  shortSupplyTickers: string[];
};

export function applyPrices(
  rows: ShoppingRow[],
  prices: Map<string, MarketPrice>,
  exchange: string,
): PricedPlan {
  const priced: PricedRow[] = rows.map((row) => {
    const price = prices.get(row.ticker) ?? null;
    const ask = price?.ask ?? null;
    const supply = price?.supply ?? null;

    return {
      ...row,
      ask,
      bid: price?.bid ?? null,
      average: price?.average ?? null,
      supply,
      estimatedCost: ask === null ? null : ask * row.remainingToBuy,
      shortSupply: supply !== null && row.remainingToBuy > supply,
    };
  });

  return {
    rows: priced,
    exchange,
    estimatedTotal: priced.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0),
    unpricedTickers: priced.filter((row) => row.remainingToBuy > 0 && row.ask === null).map((row) => row.ticker),
    shortSupplyTickers: priced.filter((row) => row.shortSupply).map((row) => row.ticker),
  };
}
