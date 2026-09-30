import {
  FILE_FORMAT,
  SCHEMA_VERSION,
  type Planet,
  type PuDataFile,
  type Scenario,
} from "@/schema/types";

/** Injected from package.json at build time, so there is one version to bump. */
declare const __APP_VERSION__: string;

export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

export function newId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export function createScenario(name: string, kind: Scenario["kind"] = "DRAFT"): Scenario {
  const timestamp = now();
  return {
    id: newId(),
    name,
    kind,
    description: null,
    createdFromScenarioId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    systems: [],
    planets: [],
    tradeRoutes: [],
    expansionPackages: [],
    baseTemplates: [],
  };
}

export function createPlanet(name: string): Planet {
  return {
    id: newId(),
    name,
    systemId: null,
    fioPlanetNaturalId: null,
    defaultBuyExchangeCode: null,
    defaultSellExchangeCode: null,
    batchInfos: [],
    factories: [],
    produced: [],
    recipeInfos: [],
    workforceConsumption: [],
    needToBuy: [],
    sellPlans: [],
    capacityPlans: [],
  };
}

export function createEmptyFile(name = "My Company"): PuDataFile {
  const timestamp = now();
  const live = createScenario("Live", "LIVE");
  return {
    fileFormat: FILE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    meta: { name, createdAt: timestamp, updatedAt: timestamp, appVersion: APP_VERSION },
    settings: { activeScenarioId: live.id, defaultExchangeCode: null },
    scenarios: [live],
  };
}
