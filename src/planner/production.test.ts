import { describe, expect, it } from "vitest";
import { calculateProduction, type ProductionInputs } from "@/planner/production";

function inputs(overrides: Partial<ProductionInputs> = {}): ProductionInputs {
  return {
    batchInfos: [],
    factories: [],
    produced: [],
    recipeInfos: [],
    workforceConsumption: [],
    needToBuy: [],
    incomingTradeRoutes: [],
    outgoingTradeRoutes: [],
    slotsByFactoryId: new Map(),
    ...overrides,
  };
}

const factory = (id: string, buildingCode: string, efficiency = 1) => ({
  id,
  buildingCode,
  count: 1,
  slotsPerBuilding: 1,
  efficiency,
  notes: null,
});

const batch = (name: string, batchQty: number, knownBatchHours: number) => ({
  id: `b-${name}`,
  name,
  batchQty,
  knownBatchHours,
  knownEff: 1,
  notes: null,
});

const producedRow = (name: string, amount: number, factoryId: string | null, allocatedSlots: number | null = null) => ({
  id: `p-${name}`,
  name,
  amount,
  allocatedSlots,
  factoryId,
  notes: null,
});

const route = (id: string, resource: string, amountPerWeek: number, enabled = true) => ({
  id,
  fromPlanetId: "a",
  toPlanetId: "b",
  resource,
  amountPerWeek,
  enabled,
  notes: null,
});

/** One FP with 1 slot, making 200 RAT in batches of 20 taking 1h each. */
function ratSetup(): ProductionInputs {
  return inputs({
    factories: [factory("f1", "FP")],
    slotsByFactoryId: new Map([["f1", 1]]),
    batchInfos: [batch("RAT", 20, 1)],
    produced: [producedRow("RAT", 200, "f1")],
  });
}

describe("calculateProduction", () => {
  it("works out output per hour from batch size and time", () => {
    const plan = calculateProduction(ratSetup());
    const rat = plan.produced[0];

    // 200 units at 20 per 1h batch = 10 batches = 10h, in 1 slot.
    expect(rat.totalHours).toBe(10);
    expect(rat.outputPerHour).toBeCloseTo(20);
    expect(rat.outputPerWeek).toBeCloseTo(20 * 168);
  });

  it("speeds up production as factory efficiency rises", () => {
    const base = calculateProduction(ratSetup()).produced[0];
    const fast = calculateProduction({
      ...ratSetup(),
      factories: [factory("f1", "FP", 2)],
    }).produced[0];

    expect(fast.currentBatchHours).toBeCloseTo(base.currentBatchHours / 2);
    expect(fast.outputPerHour).toBeCloseTo(base.outputPerHour * 2);
  });

  it("reports overbuild when the amount is not a whole number of batches", () => {
    const plan = calculateProduction({
      ...ratSetup(),
      produced: [producedRow("RAT", 195, "f1")],
    });

    // 195 needs 10 whole batches of 20 = 200 produced.
    expect(plan.produced[0].overbuild).toBe(5);
  });

  it("splits shared slots between lines with no explicit allocation", () => {
    const plan = calculateProduction(
      inputs({
        factories: [factory("f1", "FP")],
        slotsByFactoryId: new Map([["f1", 4]]),
        batchInfos: [batch("RAT", 20, 1), batch("DW", 20, 1)],
        produced: [producedRow("RAT", 200, "f1"), producedRow("DW", 200, "f1")],
      }),
    );

    expect(plan.produced.map((row) => row.effectiveSlots)).toEqual([2, 2]);
  });

  it("warns when explicit allocations exceed the slots available", () => {
    const plan = calculateProduction(
      inputs({
        factories: [factory("f1", "FP")],
        slotsByFactoryId: new Map([["f1", 2]]),
        batchInfos: [batch("RAT", 20, 1)],
        produced: [producedRow("RAT", 200, "f1", 5)],
      }),
    );

    expect(plan.warnings.join(" ")).toContain("more than the 2 slots");
  });

  it("turns production into ingredient demand", () => {
    const plan = calculateProduction({
      ...ratSetup(),
      recipeInfos: [{ id: "r1", product: "RAT", ingredient: "GRN", qtyPerProductBatch: 2 }],
    });

    // 20 RAT/h at 20 per batch = 1 batch/h, each needing 2 GRN.
    expect(plan.recipes[0].ingredientDemandPerHour).toBeCloseTo(2);
  });

  it("ignores recipes for products that are not being made", () => {
    const plan = calculateProduction(
      inputs({
        recipeInfos: [{ id: "r1", product: "PIO", ingredient: "GRN", qtyPerProductBatch: 2 }],
      }),
    );

    expect(plan.recipes).toEqual([]);
  });

  it("balances production against recipe and workforce demand", () => {
    const plan = calculateProduction({
      ...ratSetup(),
      recipeInfos: [{ id: "r1", product: "RAT", ingredient: "GRN", qtyPerProductBatch: 2 }],
      workforceConsumption: [{ id: "w1", resource: "RAT", dailyConsumption: 48, notes: null }],
    });

    const rat = plan.balance.find((row) => row.resource === "RAT")!;
    expect(rat.producedPerHour).toBeCloseTo(20);
    expect(rat.workforceConsumedPerHour).toBeCloseTo(2);
    expect(rat.netPerHour).toBeCloseTo(18);

    const grn = plan.balance.find((row) => row.resource === "GRN")!;
    expect(grn.recipeConsumedPerHour).toBeCloseTo(2);
    expect(grn.importPerWeek).toBeCloseTo(2 * 168);
  });

  it("counts an incoming trade route as supply, so it is not also bought", () => {
    const withoutRoute = calculateProduction(
      inputs({ workforceConsumption: [{ id: "w1", resource: "DW", dailyConsumption: 24, notes: null }] }),
    );
    const withRoute = calculateProduction(
      inputs({
        workforceConsumption: [{ id: "w1", resource: "DW", dailyConsumption: 24, notes: null }],
        incomingTradeRoutes: [route("t1", "DW", 168)],
      }),
    );

    expect(withoutRoute.needToBuy.find((row) => row.resource === "DW")?.importPerWeek).toBeCloseTo(168);
    // 1/h arriving exactly covers 1/h being consumed.
    expect(withRoute.needToBuy.find((row) => row.resource === "DW")).toBeUndefined();
  });

  it("counts an outgoing trade route as demand", () => {
    const plan = calculateProduction({
      ...ratSetup(),
      outgoingTradeRoutes: [route("t1", "RAT", 168 * 25)],
    });

    const rat = plan.balance.find((row) => row.resource === "RAT")!;
    expect(rat.outgoingPerHour).toBeCloseTo(25);
    expect(rat.netPerHour).toBeCloseTo(-5);
    expect(plan.needToBuy.find((row) => row.resource === "RAT")?.importPerWeek).toBeCloseTo(5 * 168);
  });

  it("ignores a disabled trade route", () => {
    const plan = calculateProduction(
      inputs({
        workforceConsumption: [{ id: "w1", resource: "DW", dailyConsumption: 24, notes: null }],
        incomingTradeRoutes: [route("t1", "DW", 168, false)],
      }),
    );

    expect(plan.needToBuy.find((row) => row.resource === "DW")?.importPerWeek).toBeCloseTo(168);
  });

  it("keeps the local balance separate from the trade-route adjusted one", () => {
    const plan = calculateProduction(
      inputs({
        workforceConsumption: [{ id: "w1", resource: "DW", dailyConsumption: 24, notes: null }],
        incomingTradeRoutes: [route("t1", "DW", 168)],
      }),
    );

    const dw = plan.balance.find((row) => row.resource === "DW")!;
    expect(dw.localNetPerHour).toBeCloseTo(-1);
    expect(dw.netPerHour).toBeCloseTo(0);
  });

  it("adds a manual extra on top of the derived import", () => {
    const plan = calculateProduction(
      inputs({
        workforceConsumption: [{ id: "w1", resource: "DW", dailyConsumption: 24, notes: null }],
        needToBuy: [
          {
            id: "n1",
            resource: "DW",
            importPerDay: 0,
            importPerWeek: 0,
            netPerHour: 0,
            sourceReason: "",
            manualExtraPerDay: 10,
            notes: "buffer",
          },
        ],
      }),
    );

    const dw = plan.needToBuy.find((row) => row.resource === "DW")!;
    expect(dw.importPerDay).toBeCloseTo(24);
    expect(dw.totalImportPerDay).toBeCloseTo(34);
    expect(dw.totalImportPerWeek).toBeCloseTo(168 + 70);
    expect(dw.notes).toBe("buffer");
  });

  it("only lists a material as needing buying when it is actually short", () => {
    const plan = calculateProduction(ratSetup());
    expect(plan.needToBuy).toEqual([]);
  });
});
