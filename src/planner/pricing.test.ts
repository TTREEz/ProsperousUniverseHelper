import { describe, expect, it } from "vitest";
import { applyPrices } from "@/planner/pricing";
import type { ShoppingRow } from "@/planner/materials";
import type { MarketPrice } from "@/provider/market";

function shoppingRow(ticker: string, remainingToBuy: number): ShoppingRow {
  return {
    ticker,
    name: ticker,
    requiredQty: remainingToBuy,
    sources: [],
    sourceKinds: ["Direct material"],
    adjustment: 0,
    remainingToBuy,
    acquiredQuantity: 0,
    remainingUnacquired: remainingToBuy,
    checkedComplete: false,
    weightPerUnit: null,
    volumePerUnit: null,
    totalWeight: null,
    totalVolume: null,
    missingMetadata: false,
  };
}

function price(ticker: string, overrides: Partial<MarketPrice>): MarketPrice {
  return { ticker, exchange: "NC1", ask: null, bid: null, average: null, supply: null, ...overrides };
}

describe("applyPrices", () => {
  it("costs a row at the ask price", () => {
    const plan = applyPrices(
      [shoppingRow("RAT", 100)],
      new Map([["RAT", price("RAT", { ask: 235, bid: 225, average: 235, supply: 1000 })]]),
      "NC1",
    );

    expect(plan.rows[0].estimatedCost).toBe(23500);
    expect(plan.estimatedTotal).toBe(23500);
  });

  it("leaves a row unpriced rather than substituting the average when nobody is selling", () => {
    const plan = applyPrices(
      [shoppingRow("XYZ", 10)],
      new Map([["XYZ", price("XYZ", { ask: null, average: 500, bid: 400 })]]),
      "NC1",
    );

    expect(plan.rows[0].estimatedCost).toBeNull();
    expect(plan.rows[0].average).toBe(500);
    expect(plan.unpricedTickers).toEqual(["XYZ"]);
  });

  it("excludes unpriced rows from the total instead of treating them as free", () => {
    const plan = applyPrices(
      [shoppingRow("RAT", 10), shoppingRow("XYZ", 10)],
      new Map([
        ["RAT", price("RAT", { ask: 200 })],
        ["XYZ", price("XYZ", { ask: null })],
      ]),
      "NC1",
    );

    expect(plan.estimatedTotal).toBe(2000);
    expect(plan.unpricedTickers).toEqual(["XYZ"]);
  });

  it("handles a material the exchange does not list at all", () => {
    const plan = applyPrices([shoppingRow("NOPE", 5)], new Map(), "NC1");

    expect(plan.rows[0].ask).toBeNull();
    expect(plan.rows[0].estimatedCost).toBeNull();
    expect(plan.unpricedTickers).toEqual(["NOPE"]);
  });

  it("flags a material the exchange cannot supply in the quantity needed", () => {
    const plan = applyPrices(
      [shoppingRow("MCG", 2000)],
      new Map([["MCG", price("MCG", { ask: 60, supply: 500 })]]),
      "NC1",
    );

    expect(plan.rows[0].shortSupply).toBe(true);
    expect(plan.shortSupplyTickers).toEqual(["MCG"]);
    // Still costed, since the shortfall is about availability rather than price.
    expect(plan.rows[0].estimatedCost).toBe(120000);
  });

  it("does not flag short supply when there is enough listed", () => {
    const plan = applyPrices(
      [shoppingRow("MCG", 100)],
      new Map([["MCG", price("MCG", { ask: 60, supply: 5000 })]]),
      "NC1",
    );

    expect(plan.rows[0].shortSupply).toBe(false);
    expect(plan.shortSupplyTickers).toEqual([]);
  });

  it("does not report a fully covered row as unpriced", () => {
    const row = shoppingRow("BSE", 0);
    const plan = applyPrices([row], new Map([["BSE", price("BSE", { ask: null })]]), "NC1");

    expect(plan.unpricedTickers).toEqual([]);
  });
});
