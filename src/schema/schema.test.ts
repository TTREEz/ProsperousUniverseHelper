import { describe, expect, it } from "vitest";
import { createEmptyFile, createPlanet, newId } from "@/schema/defaults";
import { loadAndMigrate } from "@/schema/migrate";
import { SCHEMA_VERSION, type PuDataFile } from "@/schema/types";
import { serialize } from "@/storage/adapter";

function fileWithContent(): PuDataFile {
  const file = createEmptyFile("Test Co");
  const scenario = file.scenarios[0];
  const planet = createPlanet("Montem");
  const factoryId = newId();

  planet.factories.push({ id: factoryId, name: "FP", efficiency: 1.12, slots: 5, notes: null });
  planet.produced.push({ id: newId(), name: "RAT", amount: 140, allocatedSlots: 5, factoryId, notes: null });
  scenario.planets.push(planet);

  scenario.baseTemplates.push({
    id: newId(),
    name: "RAT on Montem",
    planetId: planet.id,
    planetCode: "OT-580B",
    planetNameSnapshot: "Montem",
    availableArea: 500,
    objectiveType: "MAXIMIZE_OUTPUT",
    targetProduct: "RAT",
    targetAmount: null,
    targetPeriod: null,
    selectedWorkforceInHouseResources: ["DW", "RAT"],
    selectedRecipeOverrides: { RAT: "FP:1" },
    excludedRecipes: [],
    notes: null,
    results: [],
  });

  return file;
}

describe("save file round trip", () => {
  it("survives serialize and reload unchanged", () => {
    const original = fileWithContent();
    const result = loadAndMigrate(JSON.parse(serialize(original)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(original);
    expect(result.migratedFrom).toBeNull();
  });

  it("keeps arrays and records as real JSON values", () => {
    const result = loadAndMigrate(JSON.parse(serialize(fileWithContent())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const template = result.data.scenarios[0].baseTemplates[0];
    expect(template.selectedWorkforceInHouseResources).toEqual(["DW", "RAT"]);
    expect(template.selectedRecipeOverrides).toEqual({ RAT: "FP:1" });
  });

  it("fills in defaults for fields a hand-edited file omits", () => {
    const file = JSON.parse(serialize(createEmptyFile())) as Record<string, unknown>;
    const scenarios = file.scenarios as Array<Record<string, unknown>>;
    delete scenarios[0].tradeRoutes;
    delete scenarios[0].expansionPackages;

    const result = loadAndMigrate(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scenarios[0].tradeRoutes).toEqual([]);
    expect(result.data.scenarios[0].expansionPackages).toEqual([]);
  });

  it("rejects a file from a newer app version rather than mangling it", () => {
    const file = JSON.parse(serialize(createEmptyFile())) as Record<string, unknown>;
    file.schemaVersion = SCHEMA_VERSION + 5;

    const result = loadAndMigrate(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("newer version");
  });

  it("rejects json that is not a save file", () => {
    expect(loadAndMigrate({ hello: "world" }).ok).toBe(false);
    expect(loadAndMigrate(null).ok).toBe(false);
  });

  it("reports which field is wrong when the file is malformed", () => {
    const file = JSON.parse(serialize(fileWithContent())) as Record<string, unknown>;
    const scenarios = file.scenarios as Array<Record<string, unknown>>;
    const planets = scenarios[0].planets as Array<Record<string, unknown>>;
    const factories = planets[0].factories as Array<Record<string, unknown>>;
    factories[0].slots = "five";

    const result = loadAndMigrate(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("slots");
  });
});
