import { describe, expect, it } from "vitest";
import {
  consumptionFromPopulation,
  emptyPopulation,
  populationFromBuildings,
  totalPopulation,
} from "@/planner/workforce";
import type { PopulationCounts, WorkforceNeed } from "@/provider/types";

function pop(overrides: Partial<PopulationCounts> = {}): PopulationCounts {
  return { ...emptyPopulation(), ...overrides };
}

/** What FIO reports: production buildings employ people, the rest do not. */
const WORKFORCE = new Map<string, PopulationCounts>([
  ["FP", pop({ pioneers: 40 })],
  ["FRM", pop({ pioneers: 50 })],
  ["HB1", pop()], // habitation houses people, it does not employ them
  ["HBB", pop()],
  ["CM", pop()], // core module
  ["STO", pop()],
]);

const NEEDS: WorkforceNeed[] = [
  { workforceType: "pioneers", materialTicker: "RAT", materialName: "Rations", amountPer100Daily: 4, isLuxury: false },
  { workforceType: "pioneers", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 4, isLuxury: false },
  { workforceType: "pioneers", materialTicker: "COF", materialName: "Coffee", amountPer100Daily: 0.5, isLuxury: true },
  { workforceType: "settlers", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 5, isLuxury: false },
];

describe("populationFromBuildings", () => {
  it("counts the workers production buildings need", () => {
    const population = populationFromBuildings(
      [
        { buildingCode: "FP", count: 2 },
        { buildingCode: "FRM", count: 1 },
      ],
      WORKFORCE,
    );

    expect(population.pioneers).toBe(130); // 2x40 + 50
    expect(totalPopulation(population)).toBe(130);
  });

  it("counts nobody for habitation, storage or the core module", () => {
    const population = populationFromBuildings(
      [
        { buildingCode: "HB1", count: 10 },
        { buildingCode: "HBB", count: 2 },
        { buildingCode: "CM", count: 1 },
        { buildingCode: "STO", count: 3 },
      ],
      WORKFORCE,
    );

    expect(totalPopulation(population)).toBe(0);
  });

  it("scales with how many of a building there are", () => {
    const one = populationFromBuildings([{ buildingCode: "FRM", count: 1 }], WORKFORCE);
    const four = populationFromBuildings([{ buildingCode: "FRM", count: 4 }], WORKFORCE);

    expect(four.pioneers).toBe(one.pioneers * 4);
  });

  it("ignores a building it has no workforce data for", () => {
    const population = populationFromBuildings([{ buildingCode: "XYZ", count: 5 }], WORKFORCE);
    expect(totalPopulation(population)).toBe(0);
  });

  it("ignores casing in the building code", () => {
    expect(populationFromBuildings([{ buildingCode: "fp", count: 1 }], WORKFORCE).pioneers).toBe(40);
  });
});

describe("consumptionFromPopulation", () => {
  it("scales daily consumption to the headcount", () => {
    // 200 pioneers eat twice the per-100 rate.
    const lines = consumptionFromPopulation(pop({ pioneers: 200 }), NEEDS, false);
    const rations = lines.find((line) => line.materialTicker === "RAT");

    expect(rations?.dailyConsumption).toBeCloseTo(8);
  });

  it("adds up a material wanted by more than one worker class", () => {
    const lines = consumptionFromPopulation(pop({ pioneers: 100, settlers: 100 }), NEEDS, false);
    const water = lines.find((line) => line.materialTicker === "DW");

    expect(water?.dailyConsumption).toBeCloseTo(9); // 4 for pioneers + 5 for settlers
  });

  it("leaves luxuries out by default", () => {
    const lines = consumptionFromPopulation(pop({ pioneers: 100 }), NEEDS, false);
    expect(lines.map((line) => line.materialTicker)).not.toContain("COF");
  });

  it("includes luxuries when asked", () => {
    const lines = consumptionFromPopulation(pop({ pioneers: 100 }), NEEDS, true);
    const coffee = lines.find((line) => line.materialTicker === "COF");

    expect(coffee?.dailyConsumption).toBeCloseTo(0.5);
    expect(coffee?.isLuxury).toBe(true);
  });

  it("consumes nothing when nobody lives there", () => {
    expect(consumptionFromPopulation(emptyPopulation(), NEEDS, true)).toEqual([]);
  });

  it("does not mark a material a luxury when any class needs it outright", () => {
    const needs: WorkforceNeed[] = [
      ...NEEDS,
      { workforceType: "settlers", materialTicker: "COF", materialName: "Coffee", amountPer100Daily: 1, isLuxury: false },
    ];
    const lines = consumptionFromPopulation(pop({ pioneers: 100, settlers: 100 }), needs, true);

    expect(lines.find((line) => line.materialTicker === "COF")?.isLuxury).toBe(false);
  });
});
