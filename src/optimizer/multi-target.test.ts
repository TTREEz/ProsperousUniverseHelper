import { describe, expect, it } from "vitest";
import { optimizeBase } from "@/optimizer/optimize";
import type { OptimizerInput } from "@/optimizer/types";
import type { BuildingInfo, MaterialInfo, PlanetInfo, ProsperousProvider, RecipeCandidate } from "@/provider/types";

/**
 * A tiny world where two products share an ingredient, so a plan that makes
 * both should build one supplier rather than one per product.
 *
 *   ALPHA  <- 1 SHARED   (made in PLA)
 *   BETA   <- 1 SHARED   (made in PLB)
 *   SHARED <- nothing    (made in SRC)
 */
const BUILDINGS: Record<string, BuildingInfo> = {
  PLA: { code: "PLA", name: "Alpha Plant", areaCost: 10, slots: 1, workforce: pop(), recipeLines: [] },
  PLB: { code: "PLB", name: "Beta Plant", areaCost: 10, slots: 1, workforce: pop(), recipeLines: [] },
  SRC: { code: "SRC", name: "Shared Source", areaCost: 10, slots: 1, workforce: pop(), recipeLines: [] },
};

function pop() {
  return { pioneers: 0, settlers: 0, technicians: 0, engineers: 0, scientists: 0 };
}

function recipe(building: string, output: string, inputs: string[]): RecipeCandidate {
  return {
    id: `${building}:${output}`,
    label: `${building}: 1 ${output}`,
    buildingTicker: building,
    recipeName: `${output}-recipe`,
    standardRecipeName: `${output}-recipe`,
    durationMs: 3600000,
    batchHours: 1,
    outputTicker: output,
    outputAmount: 1,
    inputs: inputs.map((ticker) => ({ ticker, name: ticker, amount: 1, weight: 0, volume: 0 })),
    outputs: [{ ticker: output, name: output, amount: 1, weight: 0, volume: 0 }],
  };
}

const RECIPES: Record<string, RecipeCandidate[]> = {
  ALPHA: [recipe("PLA", "ALPHA", ["SHARED"])],
  BETA: [recipe("PLB", "BETA", ["SHARED"])],
  SHARED: [recipe("SRC", "SHARED", [])],
};

const PLANET: PlanetInfo = {
  id: null,
  naturalId: "TT-000a",
  name: "Testworld",
  systemId: null,
  resources: [],
  gravity: 1,
  pressure: 1,
  temperature: 20,
  fertility: null,
  surface: true,
  hasLocalMarket: null,
};

function provider(): ProsperousProvider {
  const material = (ticker: string): MaterialInfo => ({
    id: ticker,
    ticker,
    name: ticker,
    categoryName: null,
    weight: 1,
    volume: 1,
  });

  return {
    getAllMaterials: async () => ["ALPHA", "BETA", "SHARED"].map(material),
    getMaterialByTicker: async (ticker) => material(ticker.toUpperCase()),
    searchMaterials: async () => [],
    getAllBuildings: async () => Object.values(BUILDINGS),
    // The core module is looked up too; it is not part of this world.
    getBuildingByCode: async (code) => BUILDINGS[code.toUpperCase()] ?? null,
    searchBuildings: async () => [],
    getBuildingBom: async () => [],
    getRecipesForProduct: async (ticker) => RECIPES[ticker.toUpperCase()] ?? [],
    getRecipeVariants: async (ticker) => RECIPES[ticker.toUpperCase()] ?? [],
    getPlanetByIdOrCode: async () => PLANET,
    getPlanetResources: async () => [],
    getWorkforceNeeds: async () => ({ needs: [], source: "provider" as const }),
    getBuildingWorkforceRequirements: async () => pop(),
    getBuildingArea: async (code) => BUILDINGS[code.toUpperCase()]?.areaCost ?? null,
  };
}

function input(overrides: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    planetCode: "TT-000a",
    availableArea: 500,
    objectiveType: "CLOSEST_TO_TARGET",
    targetProduct: "ALPHA",
    targetAmount: 1,
    targetPeriod: "HOUR",
    additionalTargets: [],
    selectedWorkforceInHouseResources: [],
    selectedRecipeOverrides: {},
    excludedRecipes: [],
    ...overrides,
  };
}

const countOf = (plan: Awaited<ReturnType<typeof optimizeBase>>, code: string) =>
  plan.buildingPlan.filter((row) => row.buildingCode === code).reduce((sum, row) => sum + row.count, 0);

describe("additional targets", () => {
  it("makes a second product alongside the first", async () => {
    const result = await optimizeBase(
      input({ additionalTargets: [{ product: "BETA", amount: 1, period: "HOUR" }] }),
      provider(),
    );

    expect(countOf(result, "PLA")).toBeGreaterThan(0);
    expect(countOf(result, "PLB")).toBeGreaterThan(0);
  });

  it("reports every target in the final products, not just the main one", async () => {
    const result = await optimizeBase(
      input({ additionalTargets: [{ product: "BETA", amount: 1, period: "HOUR" }] }),
      provider(),
    );

    expect(result.finalProducts.map((row) => row.product).sort()).toEqual(["ALPHA", "BETA"]);
  });

  it("builds one shared supplier for both products rather than one each", async () => {
    const alone = await optimizeBase(input(), provider());
    const both = await optimizeBase(
      input({ additionalTargets: [{ product: "BETA", amount: 1, period: "HOUR" }] }),
      provider(),
    );

    // Demand for SHARED doubles, so its slots do — but it stays one chain,
    // not a duplicate source per product.
    const sharedRows = both.buildingPlan.filter((row) => row.buildingCode === "SRC");
    expect(sharedRows).toHaveLength(1);
    expect(countOf(both, "SRC")).toBeGreaterThanOrEqual(countOf(alone, "SRC"));
  });

  it("converts the stated period into the right hourly demand", async () => {
    const perHour = await optimizeBase(
      input({ additionalTargets: [{ product: "BETA", amount: 24, period: "DAY" }] }),
      provider(),
    );
    const beta = perHour.finalProducts.find((row) => row.product === "BETA");

    expect(beta?.requiredPerHour).toBeCloseTo(1);
  });

  it("ignores blank and zero rows instead of planning for nothing", async () => {
    const result = await optimizeBase(
      input({
        additionalTargets: [
          { product: "", amount: 10, period: "HOUR" },
          { product: "BETA", amount: 0, period: "HOUR" },
        ],
      }),
      provider(),
    );

    expect(countOf(result, "PLB")).toBe(0);
    expect(result.finalProducts.map((row) => row.product)).toEqual(["ALPHA"]);
  });
});
