import type { PopulationClass, PopulationCounts, WorkforceNeed } from "@/provider/types";

/**
 * Who lives on a planet, and what they get through.
 *
 * Both follow from the buildings: production buildings state the workers they
 * need, and habitation, storage and the core module state none, so summing
 * every building's requirement counts only the ones that actually employ
 * people. What that population consumes is then the per-100-workers daily rate
 * the game publishes, scaled to the headcount.
 *
 * None of this needs entering by hand, which is why nothing here reads a
 * stored figure.
 */

export const POPULATION_CLASSES: PopulationClass[] = [
  "pioneers",
  "settlers",
  "technicians",
  "engineers",
  "scientists",
];

export function emptyPopulation(): PopulationCounts {
  return { pioneers: 0, settlers: 0, technicians: 0, engineers: 0, scientists: 0 };
}

export function totalPopulation(population: PopulationCounts): number {
  return POPULATION_CLASSES.reduce((sum, key) => sum + population[key], 0);
}

export function populationFromBuildings(
  buildings: Array<{ buildingCode: string; count: number }>,
  workforceByBuilding: Map<string, PopulationCounts>,
): PopulationCounts {
  const total = emptyPopulation();

  for (const building of buildings) {
    const workforce = workforceByBuilding.get(building.buildingCode.trim().toUpperCase());
    if (!workforce || building.count <= 0) continue;
    for (const key of POPULATION_CLASSES) {
      total[key] += workforce[key] * building.count;
    }
  }

  return total;
}

export type WorkforceLine = {
  materialTicker: string;
  materialName: string;
  /** Combined across worker classes that want the same material. */
  dailyConsumption: number;
  isLuxury: boolean;
};

/**
 * Luxuries are left out unless asked for: they lift worker efficiency but
 * nothing stops production without them, so counting them by default would
 * overstate what a planet has to buy.
 */
export function consumptionFromPopulation(
  population: PopulationCounts,
  needs: WorkforceNeed[],
  includeLuxuries: boolean,
): WorkforceLine[] {
  const byMaterial = new Map<string, WorkforceLine>();

  for (const need of needs) {
    if (need.isLuxury && !includeLuxuries) continue;

    const headcount = population[need.workforceType] ?? 0;
    if (headcount <= 0) continue;

    const daily = (headcount / 100) * need.amountPer100Daily;
    const existing = byMaterial.get(need.materialTicker);

    byMaterial.set(need.materialTicker, {
      materialTicker: need.materialTicker,
      materialName: existing?.materialName ?? need.materialName,
      dailyConsumption: (existing?.dailyConsumption ?? 0) + daily,
      isLuxury: (existing?.isLuxury ?? true) && need.isLuxury,
    });
  }

  return [...byMaterial.values()].sort((a, b) => a.materialTicker.localeCompare(b.materialTicker));
}
