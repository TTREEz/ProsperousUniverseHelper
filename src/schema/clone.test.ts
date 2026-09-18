import { describe, expect, it } from "vitest";
import { cloneScenario } from "@/schema/clone";
import { createPlanet, createScenario, newId } from "@/schema/defaults";
import type { Scenario } from "@/schema/types";

function populatedScenario(): Scenario {
  const scenario = createScenario("Live", "LIVE");
  const systemId = newId();
  scenario.systems.push({ id: systemId, name: "Moria", fioSystemNaturalId: null, notes: null });

  const origin = createPlanet("Montem");
  const destination = createPlanet("Promitor");
  origin.systemId = systemId;

  const factoryId = newId();
  origin.factories.push({ id: factoryId, name: "FP", efficiency: 1, slots: 5, notes: null });
  origin.produced.push({ id: newId(), name: "RAT", amount: 140, allocatedSlots: 5, factoryId, notes: null });

  scenario.planets.push(origin, destination);
  scenario.tradeRoutes.push({
    id: newId(),
    fromPlanetId: origin.id,
    toPlanetId: destination.id,
    resource: "RAT",
    amountPerWeek: 700,
    enabled: true,
    notes: null,
  });
  scenario.baseTemplates.push({
    id: newId(),
    name: "RAT base",
    planetId: origin.id,
    planetCode: "OT-580B",
    planetNameSnapshot: "Montem",
    availableArea: 500,
    objectiveType: "MAXIMIZE_OUTPUT",
    targetProduct: "RAT",
    targetAmount: null,
    targetPeriod: null,
    selectedWorkforceInHouseResources: [],
    selectedRecipeOverrides: {},
    excludedRecipes: [],
    notes: null,
    results: [],
  });

  return scenario;
}

describe("cloneScenario", () => {
  it("reissues every id so nothing is shared with the source", () => {
    const source = populatedScenario();
    const clone = cloneScenario(source);

    const sourceIds = collectIds(source);
    const cloneIds = collectIds(clone);
    const shared = cloneIds.filter((id) => sourceIds.includes(id));
    expect(shared).toEqual([]);
  });

  it("rewrites internal references to point inside the clone", () => {
    const clone = cloneScenario(populatedScenario());

    const [origin, destination] = clone.planets;
    const route = clone.tradeRoutes[0];
    expect(route.fromPlanetId).toBe(origin.id);
    expect(route.toPlanetId).toBe(destination.id);

    expect(origin.produced[0].factoryId).toBe(origin.factories[0].id);
    expect(origin.systemId).toBe(clone.systems[0].id);
    expect(clone.baseTemplates[0].planetId).toBe(origin.id);
  });

  it("records provenance and demotes the copy to a draft", () => {
    const source = populatedScenario();
    const clone = cloneScenario(source);

    expect(clone.kind).toBe("DRAFT");
    expect(clone.createdFromScenarioId).toBe(source.id);
    expect(clone.name).toBe("Live (copy)");
  });

  it("leaves the source scenario untouched", () => {
    const source = populatedScenario();
    const before = structuredClone(source);
    cloneScenario(source);
    expect(source).toEqual(before);
  });

  it("does not leave a reference pointing at a planet that is not in the clone", () => {
    const clone = cloneScenario(populatedScenario());
    const planetIds = clone.planets.map((planet) => planet.id);

    for (const route of clone.tradeRoutes) {
      expect(planetIds).toContain(route.fromPlanetId);
      expect(planetIds).toContain(route.toPlanetId);
    }
    for (const template of clone.baseTemplates) {
      if (template.planetId !== null) expect(planetIds).toContain(template.planetId);
    }
  });
});

function collectIds(scenario: Scenario): string[] {
  const ids = [scenario.id];
  for (const system of scenario.systems) ids.push(system.id);
  for (const planet of scenario.planets) {
    ids.push(planet.id);
    for (const factory of planet.factories) ids.push(factory.id);
    for (const row of planet.produced) ids.push(row.id);
  }
  for (const route of scenario.tradeRoutes) ids.push(route.id);
  for (const template of scenario.baseTemplates) ids.push(template.id);
  return ids;
}
