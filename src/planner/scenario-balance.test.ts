import { describe, expect, it } from "vitest";
import { buildScenarioBalance } from "@/planner/scenario-balance";
import { createPlanet, createScenario, newId } from "@/schema/defaults";
import type { Planet, Scenario } from "@/schema/types";
import type { PopulationCounts, WorkforceNeed } from "@/provider/types";

function pop(overrides: Partial<PopulationCounts> = {}): PopulationCounts {
  return { pioneers: 0, settlers: 0, technicians: 0, engineers: 0, scientists: 0, ...overrides };
}

const WORKFORCE = new Map<string, PopulationCounts>([
  ["FP", pop({ pioneers: 100 })],
  ["HB1", pop()],
]);

const NEEDS: WorkforceNeed[] = [
  { workforceType: "pioneers", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 4, isLuxury: false },
];

/** A planet making `amount` of `product` per order, in one FP. */
function producingPlanet(name: string, product: string, amount: number): Planet {
  const planet = createPlanet(name);
  const factoryId = newId();
  planet.factories.push({ id: factoryId, buildingCode: "FP", count: 1, efficiency: 1, notes: null });
  planet.batchInfos.push({
    id: newId(),
    name: product,
    batchQty: 10,
    knownBatchHours: 1,
    knownEff: 1,
    recipeId: null,
    recipeLabel: null,
    notes: null,
  });
  planet.produced.push({ id: newId(), name: product, amount, allocatedSlots: null, factoryId, notes: null });
  return planet;
}

function scenarioWith(planets: Planet[]): Scenario {
  const scenario = createScenario("Live", "LIVE");
  scenario.planets = planets;
  return scenario;
}

describe("buildScenarioBalance", () => {
  it("balances every planet in the scenario", () => {
    const balance = buildScenarioBalance(
      scenarioWith([producingPlanet("Montem", "RAT", 100), producingPlanet("Katoa", "DW", 100)]),
      WORKFORCE,
      NEEDS,
    );

    expect(balance.planets.map((entry) => entry.planetName)).toEqual(["Montem", "Katoa"]);
  });

  it("shows a material's position on each planet side by side", () => {
    const maker = producingPlanet("Montem", "DW", 1000);
    const consumer = createPlanet("Katoa");
    const factoryId = newId();
    // A plant with workers but making nothing: pure demand for water.
    consumer.factories.push({ id: factoryId, buildingCode: "FP", count: 1, efficiency: 1, notes: null });

    const balance = buildScenarioBalance(scenarioWith([maker, consumer]), WORKFORCE, NEEDS);
    const water = balance.materials.find((row) => row.ticker === "DW")!;

    expect(water.byPlanet[maker.id]).toBeGreaterThan(0);
    expect(water.byPlanet[consumer.id]).toBeLessThan(0);
  });

  it("counts a surplus on one planet against a shortfall on another", () => {
    const maker = producingPlanet("Montem", "DW", 1000);
    const consumer = createPlanet("Katoa");
    consumer.factories.push({ id: newId(), buildingCode: "FP", count: 1, efficiency: 1, notes: null });

    const balance = buildScenarioBalance(scenarioWith([maker, consumer]), WORKFORCE, NEEDS);
    const water = balance.materials.find((row) => row.ticker === "DW")!;

    expect(water.totalSurplus).toBeGreaterThan(water.totalShortfall);
    // Covered from within the scenario, so nothing has to be bought.
    expect(water.netShortfall).toBe(0);
  });

  it("reports what is left over when the scenario cannot cover itself", () => {
    const consumer = createPlanet("Katoa");
    consumer.factories.push({ id: newId(), buildingCode: "FP", count: 1, efficiency: 1, notes: null });

    const balance = buildScenarioBalance(scenarioWith([consumer]), WORKFORCE, NEEDS);
    const water = balance.materials.find((row) => row.ticker === "DW")!;

    // 100 pioneers drink 4 a day.
    expect(water.totalShortfall).toBeCloseTo(28);
    expect(water.netShortfall).toBeCloseTo(28);
  });

  it("puts what the scenario cannot cover first", () => {
    const short = createPlanet("Katoa");
    short.factories.push({ id: newId(), buildingCode: "FP", count: 1, efficiency: 1, notes: null });

    const balance = buildScenarioBalance(
      scenarioWith([producingPlanet("Montem", "RAT", 100), short]),
      WORKFORCE,
      NEEDS,
    );

    expect(balance.materials[0].ticker).toBe("DW");
    expect(balance.materials[0].netShortfall).toBeGreaterThan(0);
  });

  it("leaves out a material no planet makes or consumes", () => {
    const balance = buildScenarioBalance(
      scenarioWith([producingPlanet("Montem", "RAT", 100)]),
      WORKFORCE,
      NEEDS,
    );

    expect(balance.materials.map((row) => row.ticker)).not.toContain("BSE");
  });

  it("handles a scenario with no planets", () => {
    const balance = buildScenarioBalance(scenarioWith([]), WORKFORCE, NEEDS);
    expect(balance.planets).toEqual([]);
    expect(balance.materials).toEqual([]);
  });
});
