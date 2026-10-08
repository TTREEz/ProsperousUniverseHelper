import { calculateProduction, type ProductionPlan } from "@/planner/production";
import { consumptionFromPopulation, populationFromBuildings } from "@/planner/workforce";
import type { PopulationCounts, WorkforceNeed } from "@/provider/types";
import type { Planet, Scenario } from "@/schema/types";

/**
 * Every planet in a scenario, balanced, plus the same numbers gathered per
 * material so a shortage on one planet can be read against a surplus on
 * another. That pairing is the point: it is what says whether something has to
 * be bought or can simply be moved.
 */

export type PlanetBalance = {
  planetId: string;
  planetName: string;
  plan: ProductionPlan;
};

export type MaterialRow = {
  ticker: string;
  /** Net per week on each planet. Negative is a shortfall. */
  byPlanet: Record<string, number>;
  /** Everything the scenario makes of this, per week. */
  totalSurplus: number;
  /** Everything it falls short by, per week, as a positive number. */
  totalShortfall: number;
  /** Shortfall left after the surpluses are counted against it. */
  netShortfall: number;
};

export type ScenarioBalance = {
  planets: PlanetBalance[];
  materials: MaterialRow[];
};

export function buildPlanetPlan(
  planet: Planet,
  scenario: Scenario,
  workforceByBuilding: Map<string, PopulationCounts>,
  needs: WorkforceNeed[],
): ProductionPlan {
  const population = populationFromBuildings(planet.factories, workforceByBuilding);
  const consumption = consumptionFromPopulation(population, needs, planet.includeLuxuries);

  return calculateProduction({
    batchInfos: planet.batchInfos,
    factories: planet.factories,
    produced: planet.produced,
    recipeInfos: planet.recipeInfos,
    workforceConsumption: consumption.map((line) => ({
      resource: line.materialTicker,
      dailyConsumption: line.dailyConsumption,
    })),
    needToBuy: planet.needToBuy,
    incomingTradeRoutes: scenario.tradeRoutes.filter((route) => route.toPlanetId === planet.id),
    outgoingTradeRoutes: scenario.tradeRoutes.filter((route) => route.fromPlanetId === planet.id),
  });
}

const HOURS_PER_WEEK = 168;

export function buildScenarioBalance(
  scenario: Scenario,
  workforceByBuilding: Map<string, PopulationCounts>,
  needs: WorkforceNeed[],
): ScenarioBalance {
  const planets: PlanetBalance[] = scenario.planets.map((planet) => ({
    planetId: planet.id,
    planetName: planet.name,
    plan: buildPlanetPlan(planet, scenario, workforceByBuilding, needs),
  }));

  const byTicker = new Map<string, MaterialRow>();

  for (const entry of planets) {
    for (const row of entry.plan.balance) {
      const perWeek = row.netPerHour * HOURS_PER_WEEK;
      // A material neither made nor consumed here says nothing; leaving it out
      // keeps the table to planets that actually touch it.
      if (perWeek === 0) continue;

      const existing = byTicker.get(row.resource) ?? {
        ticker: row.resource,
        byPlanet: {},
        totalSurplus: 0,
        totalShortfall: 0,
        netShortfall: 0,
      };

      existing.byPlanet[entry.planetId] = (existing.byPlanet[entry.planetId] ?? 0) + perWeek;
      if (perWeek > 0) existing.totalSurplus += perWeek;
      else existing.totalShortfall += -perWeek;

      byTicker.set(row.resource, existing);
    }
  }

  const materials = [...byTicker.values()]
    .map((row) => ({ ...row, netShortfall: Math.max(0, row.totalShortfall - row.totalSurplus) }))
    .sort(
      (a, b) =>
        b.netShortfall - a.netShortfall || b.totalShortfall - a.totalShortfall || a.ticker.localeCompare(b.ticker),
    );

  return { planets, materials };
}
