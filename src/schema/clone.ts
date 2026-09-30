import { newId } from "@/schema/defaults";
import type { Scenario } from "@/schema/types";

/**
 * Copies a scenario into an independent draft.
 *
 * Every id is reissued so the copy shares nothing with the original, and
 * internal references are rewritten to point inside the copy. Getting this
 * wrong is silent: the clone would keep pointing at the source scenario's
 * planets and edits would appear to leak between scenarios.
 */
export function cloneScenario(source: Scenario, name = `${source.name} (copy)`): Scenario {
  const clone = structuredClone(source);
  const remap = new Map<string, string>();

  const reissue = (oldId: string): string => {
    const next = newId();
    remap.set(oldId, next);
    return next;
  };
  const remapped = (id: string | null): string | null => (id === null ? null : remap.get(id) ?? null);

  const createdAt = new Date().toISOString();
  clone.id = newId();
  clone.name = name;
  clone.kind = "DRAFT";
  clone.createdFromScenarioId = source.id;
  clone.createdAt = createdAt;
  clone.updatedAt = createdAt;

  for (const system of clone.systems) reissue(system.id);
  for (const planet of clone.planets) {
    reissue(planet.id);
    for (const factory of planet.factories) reissue(factory.id);
  }

  for (const system of clone.systems) system.id = remap.get(system.id)!;

  for (const planet of clone.planets) {
    const newPlanetId = remap.get(planet.id)!;
    planet.systemId = remapped(planet.systemId);
    for (const factory of planet.factories) factory.id = remap.get(factory.id)!;
    for (const row of planet.produced) {
      row.factoryId = remapped(row.factoryId);
      row.id = newId();
    }
    for (const row of planet.batchInfos) row.id = newId();
    for (const row of planet.recipeInfos) row.id = newId();
    for (const row of planet.needToBuy) row.id = newId();
    for (const row of planet.sellPlans) row.id = newId();
    for (const plan of planet.capacityPlans) plan.id = newId();
    planet.id = newPlanetId;
  }

  for (const route of clone.tradeRoutes) {
    route.id = newId();
    route.fromPlanetId = remap.get(route.fromPlanetId) ?? route.fromPlanetId;
    route.toPlanetId = remap.get(route.toPlanetId) ?? route.toPlanetId;
  }

  for (const pkg of clone.expansionPackages) {
    pkg.id = newId();
    pkg.systemId = remapped(pkg.systemId);
    pkg.targetPlanetId = remapped(pkg.targetPlanetId);
    for (const item of pkg.items) item.id = newId();
    for (const adjustment of pkg.adjustments) adjustment.id = newId();
    for (const entry of pkg.checklist) entry.id = newId();
  }

  for (const template of clone.baseTemplates) {
    template.id = newId();
    template.planetId = remapped(template.planetId);
    for (const result of template.results) result.id = newId();
  }

  return clone;
}
