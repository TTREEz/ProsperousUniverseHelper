import { describe, expect, it } from "vitest";
import { derivePackagePlan, type PackageInput } from "@/planner/materials";
import type { BuildingInfo, MaterialInfo, PlanetInfo, ProsperousProvider } from "@/provider/types";

const MATERIALS: Record<string, MaterialInfo> = {
  BSE: { id: null, ticker: "BSE", name: "Basic Structural Elements", categoryName: null, weight: 0.3, volume: 0.5 },
  BDE: { id: null, ticker: "BDE", name: "Basic Deck Elements", categoryName: null, weight: 1, volume: 1 },
  MCG: { id: null, ticker: "MCG", name: "Mineral Construction Granulate", categoryName: null, weight: 0.24, volume: 0.1 },
  AEF: { id: null, ticker: "AEF", name: "Aerostat Foundation", categoryName: null, weight: 1, volume: 6 },
  INS: { id: null, ticker: "INS", name: "Insulation", categoryName: null, weight: 0.1, volume: 1 },
};

const FRM: BuildingInfo = {
  code: "FRM",
  name: "Farmstead",
  areaCost: 30,
  slots: 1,
  workforce: { pioneers: 60, settlers: 0, technicians: 0, engineers: 0, scientists: 0 },
  recipeLines: [
    { materialTicker: "BSE", quantity: 8 },
    { materialTicker: "BDE", quantity: 4 },
  ],
};

function planet(overrides: Partial<PlanetInfo>): PlanetInfo {
  return {
    id: null,
    naturalId: "XX-000a",
    name: "Testworld",
    systemId: null,
    resources: [],
    gravity: 1,
    pressure: 1,
    temperature: 20,
    fertility: null,
    surface: true,
    hasLocalMarket: null,
    ...overrides,
  };
}

function stubProvider(target: PlanetInfo | null): ProsperousProvider {
  const notUsed = () => Promise.reject(new Error("not used in these tests"));
  return {
    getAllMaterials: notUsed,
    getMaterialByTicker: (ticker) => Promise.resolve(MATERIALS[ticker.toUpperCase()] ?? null),
    searchMaterials: notUsed,
    getAllBuildings: notUsed,
    getBuildingByCode: (code) => Promise.resolve(code.toUpperCase() === "FRM" ? FRM : null),
    searchBuildings: notUsed,
    getBuildingBom: (code) => Promise.resolve(code.toUpperCase() === "FRM" ? FRM.recipeLines : null),
    getRecipesForProduct: notUsed,
    getRecipeVariants: notUsed,
    getPlanetByIdOrCode: () => Promise.resolve(target),
    getPlanetResources: notUsed,
    getWorkforceNeeds: notUsed,
    getBuildingWorkforceRequirements: notUsed,
    getBuildingArea: notUsed,
  } as ProsperousProvider;
}

function input(overrides: Partial<PackageInput>): PackageInput {
  return { items: [], adjustments: [], checklist: [], targetPlanetCode: null, ...overrides };
}

const materialItem = (code: string, quantity: number) => ({
  id: code,
  itemType: "MATERIAL" as const,
  itemCode: code,
  itemNameSnapshot: null,
  quantity,
  sortOrder: 0,
  notes: null,
});

const buildingItem = (code: string, quantity: number) => ({
  id: code,
  itemType: "BUILDING" as const,
  itemCode: code,
  itemNameSnapshot: null,
  quantity,
  sortOrder: 0,
  notes: null,
});

function row(plan: Awaited<ReturnType<typeof derivePackagePlan>>, ticker: string) {
  return plan.rows.find((entry) => entry.ticker === ticker);
}

describe("derivePackagePlan", () => {
  it("expands a building into its bill of materials", async () => {
    const plan = await derivePackagePlan(input({ items: [buildingItem("FRM", 3)] }), stubProvider(null));

    expect(row(plan, "BSE")?.requiredQty).toBe(24);
    expect(row(plan, "BDE")?.requiredQty).toBe(12);
  });

  it("adds rocky-planet area cost at four units per area", async () => {
    const plan = await derivePackagePlan(
      input({ items: [buildingItem("FRM", 2)], targetPlanetCode: "XX-000a" }),
      stubProvider(planet({ surface: true })),
    );

    // 30 area x 4 per area x 2 buildings
    expect(row(plan, "MCG")?.requiredQty).toBe(240);
    expect(row(plan, "AEF")).toBeUndefined();
  });

  it("uses aerostat foundations instead on a gaseous planet", async () => {
    const plan = await derivePackagePlan(
      input({ items: [buildingItem("FRM", 3)], targetPlanetCode: "XX-000a" }),
      stubProvider(planet({ surface: false })),
    );

    expect(row(plan, "AEF")?.requiredQty).toBe(30); // 30 area / 3 x 3 buildings
    expect(row(plan, "MCG")).toBeUndefined();
  });

  it("adds insulation on a cold planet", async () => {
    const plan = await derivePackagePlan(
      input({ items: [buildingItem("FRM", 1)], targetPlanetCode: "XX-000a" }),
      stubProvider(planet({ temperature: -40 })),
    );

    expect(row(plan, "INS")?.requiredQty).toBe(300); // 30 area x 10
  });

  it("leaves environmental materials out when no planet is set, and says so", async () => {
    const plan = await derivePackagePlan(input({ items: [buildingItem("FRM", 1)] }), stubProvider(null));

    expect(row(plan, "MCG")).toBeUndefined();
    expect(plan.warnings.join(" ")).toContain("No target planet set");
  });

  it("combines direct materials with building requirements for the same ticker", async () => {
    const plan = await derivePackagePlan(
      input({ items: [buildingItem("FRM", 1), materialItem("BSE", 10)] }),
      stubProvider(null),
    );

    const bse = row(plan, "BSE");
    expect(bse?.requiredQty).toBe(18);
    expect(bse?.sourceKinds.sort()).toEqual(["Building BOM", "Direct material"]);
  });

  it("subtracts what you already have via adjustments", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [materialItem("BSE", 100)],
        adjustments: [{ id: "a", materialTicker: "BSE", quantityDelta: -30, reason: "in stock" }],
      }),
      stubProvider(null),
    );

    expect(row(plan, "BSE")?.remainingToBuy).toBe(70);
  });

  it("never reports a negative amount to buy", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [materialItem("BSE", 10)],
        adjustments: [{ id: "a", materialTicker: "BSE", quantityDelta: -999, reason: "plenty" }],
      }),
      stubProvider(null),
    );

    expect(row(plan, "BSE")?.remainingToBuy).toBe(0);
  });

  it("tracks what is still outstanding against the checklist", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [materialItem("BSE", 50)],
        checklist: [{ id: "c", materialTicker: "BSE", acquiredQuantity: 20, checkedComplete: false }],
      }),
      stubProvider(null),
    );

    const bse = row(plan, "BSE");
    expect(bse?.acquiredQuantity).toBe(20);
    expect(bse?.remainingUnacquired).toBe(30);
  });

  it("computes weight and volume from what is left to buy", async () => {
    const plan = await derivePackagePlan(input({ items: [materialItem("BSE", 100)] }), stubProvider(null));

    const bse = row(plan, "BSE");
    expect(bse?.totalWeight).toBeCloseTo(30);
    expect(bse?.totalVolume).toBeCloseTo(50);
    expect(plan.totals.weight).toBeCloseTo(30);
  });

  it("only counts buildings still to be built when deducting", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [buildingItem("FRM", 5)],
        existingBuildings: [{ buildingCode: "FRM", count: 2 }],
        deductExisting: true,
      }),
      stubProvider(null),
    );

    // 3 left to build, not 5.
    expect(row(plan, "BSE")?.requiredQty).toBe(24);
    expect(plan.deductions).toEqual([
      { buildingCode: "FRM", requested: 5, alreadyBuilt: 2, stillToBuild: 3 },
    ]);
  });

  it("leaves quantities alone when deduction is off", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [buildingItem("FRM", 5)],
        existingBuildings: [{ buildingCode: "FRM", count: 2 }],
        deductExisting: false,
      }),
      stubProvider(null),
    );

    expect(row(plan, "BSE")?.requiredQty).toBe(40);
    expect(plan.deductions).toEqual([]);
  });

  it("drops a building entirely when enough are already built", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [buildingItem("FRM", 2)],
        existingBuildings: [{ buildingCode: "FRM", count: 6 }],
        deductExisting: true,
      }),
      stubProvider(null),
    );

    expect(plan.rows).toEqual([]);
    expect(plan.deductions[0].stillToBuild).toBe(0);
  });

  it("does not let two entries claim the same existing buildings", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [buildingItem("FRM", 2), buildingItem("FRM", 3)],
        existingBuildings: [{ buildingCode: "FRM", count: 3 }],
        deductExisting: true,
      }),
      stubProvider(null),
    );

    // 3 existing cover the first entry entirely and one of the second, so 2 remain.
    expect(row(plan, "BSE")?.requiredQty).toBe(16);
  });

  it("deducts environmental costs too, not just the bill of materials", async () => {
    const plan = await derivePackagePlan(
      input({
        items: [buildingItem("FRM", 4)],
        existingBuildings: [{ buildingCode: "FRM", count: 3 }],
        deductExisting: true,
        targetPlanetCode: "XX-000a",
      }),
      stubProvider(planet({ surface: true })),
    );

    // Only the single remaining building pays the 30 area x 4 rocky cost.
    expect(row(plan, "MCG")?.requiredQty).toBe(120);
  });

  it("warns instead of silently dropping an unknown building", async () => {
    const plan = await derivePackagePlan(input({ items: [buildingItem("NOPE", 1)] }), stubProvider(null));

    expect(plan.rows).toEqual([]);
    expect(plan.warnings.join(" ")).toContain("NOPE");
  });
});
