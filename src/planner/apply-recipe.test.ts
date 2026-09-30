import { describe, expect, it } from "vitest";
import { applyRecipeToPlanet, type RecipeChoice } from "@/planner/apply-recipe";
import { createPlanet } from "@/schema/defaults";

const ratViaNutrients: RecipeChoice = {
  id: "FP:RAT:1",
  label: "FP: 10 RAT / 6h from 1 NUT + 1 GRN + 1 MUS",
  batchQty: 10,
  batchHours: 6,
  buildingCode: "FP",
  inputs: [
    { ticker: "NUT", amount: 1 },
    { ticker: "GRN", amount: 1 },
    { ticker: "MUS", amount: 1 },
  ],
};

const ratViaBeans: RecipeChoice = {
  id: "FP:RAT:2",
  label: "FP: 10 RAT / 6h from 1 GRN + 1 BEA + 1 NUT",
  batchQty: 10,
  batchHours: 6,
  buildingCode: "FP",
  inputs: [
    { ticker: "GRN", amount: 1 },
    { ticker: "BEA", amount: 1 },
    { ticker: "NUT", amount: 1 },
  ],
};

const waterExtraction: RecipeChoice = {
  id: null,
  label: "RIG: 15 H2O / day",
  batchQty: 15,
  batchHours: 24,
  buildingCode: "RIG",
  inputs: [],
};

describe("applyRecipeToPlanet", () => {
  it("records the batch numbers and the recipe behind them", () => {
    const planet = createPlanet("Montem");
    applyRecipeToPlanet(planet, "RAT", ratViaNutrients);

    const batch = planet.batchInfos[0];
    expect(batch.name).toBe("RAT");
    expect(batch.batchQty).toBe(10);
    expect(batch.knownBatchHours).toBe(6);
    expect(batch.recipeId).toBe("FP:RAT:1");
  });

  it("fills in the ingredients so they do not have to be typed", () => {
    const planet = createPlanet("Montem");
    applyRecipeToPlanet(planet, "RAT", ratViaNutrients);

    expect(planet.recipeInfos.map((row) => row.ingredient).sort()).toEqual(["GRN", "MUS", "NUT"]);
    expect(planet.recipeInfos.every((row) => row.product === "RAT")).toBe(true);
  });

  it("replaces the old ingredients when the recipe changes", () => {
    const planet = createPlanet("Montem");
    applyRecipeToPlanet(planet, "RAT", ratViaNutrients);
    applyRecipeToPlanet(planet, "RAT", ratViaBeans);

    // MUS belonged to the previous recipe and must not linger as demand.
    expect(planet.recipeInfos.map((row) => row.ingredient).sort()).toEqual(["BEA", "GRN", "NUT"]);
    expect(planet.batchInfos).toHaveLength(1);
    expect(planet.batchInfos[0].recipeId).toBe("FP:RAT:2");
  });

  it("leaves other products' ingredients alone", () => {
    const planet = createPlanet("Montem");
    applyRecipeToPlanet(planet, "DW", { ...waterExtraction, inputs: [{ ticker: "H2O", amount: 10 }] });
    applyRecipeToPlanet(planet, "RAT", ratViaNutrients);
    applyRecipeToPlanet(planet, "RAT", ratViaBeans);

    const dwRows = planet.recipeInfos.filter((row) => row.product === "DW");
    expect(dwRows.map((row) => row.ingredient)).toEqual(["H2O"]);
  });

  it("handles extraction, which has no inputs", () => {
    const planet = createPlanet("Katoa");
    applyRecipeToPlanet(planet, "H2O", waterExtraction);

    expect(planet.batchInfos[0].batchQty).toBe(15);
    expect(planet.batchInfos[0].knownBatchHours).toBe(24);
    expect(planet.recipeInfos).toEqual([]);
  });

  it("normalises the product ticker", () => {
    const planet = createPlanet("Montem");
    applyRecipeToPlanet(planet, " rat ", ratViaNutrients);

    expect(planet.batchInfos[0].name).toBe("RAT");
    expect(planet.recipeInfos.every((row) => row.product === "RAT")).toBe(true);
  });

  it("ignores a blank product rather than creating an empty row", () => {
    const planet = createPlanet("Montem");
    applyRecipeToPlanet(planet, "   ", ratViaNutrients);

    expect(planet.batchInfos).toEqual([]);
    expect(planet.recipeInfos).toEqual([]);
  });
});
