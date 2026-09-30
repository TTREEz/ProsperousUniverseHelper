import { z } from "zod";
import { FILE_FORMAT, type PuDataFile } from "@/schema/types";

/**
 * Runtime validation for anything entering the app from outside: a file the
 * user picked, or a working copy restored from browser storage. `types.ts`
 * stays the source of truth for the shape; this mirrors it for the boundary.
 */

const nullableString = z.string().nullable().default(null);

const batchInfo = z.object({
  id: z.string(),
  name: z.string(),
  batchQty: z.number(),
  knownBatchHours: z.number(),
  knownEff: z.number(),
  notes: nullableString,
});

const factory = z.object({
  id: z.string(),
  buildingCode: z.string(),
  count: z.number().default(1),
  efficiency: z.number().default(1),
  notes: nullableString,
});

const produced = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
  allocatedSlots: z.number().nullable().default(null),
  factoryId: z.string().nullable().default(null),
  notes: nullableString,
});

const recipeInfo = z.object({
  id: z.string(),
  product: z.string(),
  ingredient: z.string(),
  qtyPerProductBatch: z.number(),
});

const workforceConsumption = z.object({
  id: z.string(),
  resource: z.string(),
  dailyConsumption: z.number(),
  notes: nullableString,
});

const needToBuy = z.object({
  id: z.string(),
  resource: z.string(),
  importPerDay: z.number().default(0),
  importPerWeek: z.number().default(0),
  netPerHour: z.number().default(0),
  sourceReason: z.string().default(""),
  manualExtraPerDay: z.number().default(0),
  notes: nullableString,
});

const sellPlan = z.object({
  id: z.string(),
  resource: z.string(),
  amountPerWeek: z.number(),
  sellAllAvailable: z.boolean().default(false),
  enabled: z.boolean().default(true),
  notes: nullableString,
});

const capacityPlan = z.object({
  id: z.string(),
  name: z.string(),
  description: nullableString,
  config: z.record(z.unknown()).default({}),
});

const planet = z.object({
  id: z.string(),
  name: z.string(),
  systemId: z.string().nullable().default(null),
  fioPlanetNaturalId: z.string().nullable().default(null),
  defaultBuyExchangeCode: z.string().nullable().default(null),
  defaultSellExchangeCode: z.string().nullable().default(null),
  batchInfos: z.array(batchInfo).default([]),
  factories: z.array(factory).default([]),
  produced: z.array(produced).default([]),
  recipeInfos: z.array(recipeInfo).default([]),
  workforceConsumption: z.array(workforceConsumption).default([]),
  needToBuy: z.array(needToBuy).default([]),
  sellPlans: z.array(sellPlan).default([]),
  capacityPlans: z.array(capacityPlan).default([]),
});

const system = z.object({
  id: z.string(),
  name: z.string(),
  fioSystemNaturalId: z.string().nullable().default(null),
  notes: nullableString,
});

const tradeRoute = z.object({
  id: z.string(),
  fromPlanetId: z.string(),
  toPlanetId: z.string(),
  resource: z.string(),
  amountPerWeek: z.number(),
  enabled: z.boolean().default(true),
  notes: nullableString,
});

const expansionPackage = z.object({
  id: z.string(),
  name: z.string(),
  description: nullableString,
  systemId: z.string().nullable().default(null),
  targetPlanetId: z.string().nullable().default(null),
  exchangeCode: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  deductExistingBuildings: z.boolean().default(false),
  items: z
    .array(
      z.object({
        id: z.string(),
        itemType: z.enum(["MATERIAL", "BUILDING"]),
        itemCode: z.string(),
        itemNameSnapshot: z.string().nullable().default(null),
        quantity: z.number(),
        sortOrder: z.number().default(0),
        notes: nullableString,
      }),
    )
    .default([]),
  adjustments: z
    .array(
      z.object({
        id: z.string(),
        materialTicker: z.string(),
        quantityDelta: z.number(),
        reason: nullableString,
      }),
    )
    .default([]),
  checklist: z
    .array(
      z.object({
        id: z.string(),
        materialTicker: z.string(),
        acquiredQuantity: z.number().default(0),
        checkedComplete: z.boolean().default(false),
      }),
    )
    .default([]),
});

const baseTemplate = z.object({
  id: z.string(),
  name: z.string(),
  planetId: z.string().nullable().default(null),
  planetCode: z.string().default(""),
  planetNameSnapshot: z.string().nullable().default(null),
  availableArea: z.number().default(500),
  objectiveType: z
    .enum(["MAXIMIZE_OUTPUT", "CLOSEST_TO_TARGET", "MINIMIZE_IMPORTS", "MAXIMIZE_SELF_SUFFICIENCY"])
    .default("MAXIMIZE_OUTPUT"),
  targetProduct: z.string().default(""),
  targetAmount: z.number().nullable().default(null),
  targetPeriod: z.enum(["HOUR", "DAY", "WEEK"]).nullable().default(null),
  additionalTargets: z
    .array(
      z.object({
        product: z.string(),
        amount: z.number(),
        period: z.enum(["HOUR", "DAY", "WEEK"]).default("WEEK"),
      }),
    )
    .default([]),
  selectedWorkforceInHouseResources: z.array(z.string()).default([]),
  selectedRecipeOverrides: z.record(z.string()).default({}),
  excludedRecipes: z.array(z.string()).default([]),
  notes: nullableString,
  results: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.string(),
        score: z.number().default(0),
        targetAchieved: z.number().default(0),
        areaUsed: z.number().default(0),
        averageUtilization: z.number().default(0),
        warningCount: z.number().default(0),
        snapshot: z.unknown(),
      }),
    )
    .default([]),
});

const scenario = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["LIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),
  description: nullableString,
  createdFromScenarioId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  systems: z.array(system).default([]),
  planets: z.array(planet).default([]),
  tradeRoutes: z.array(tradeRoute).default([]),
  expansionPackages: z.array(expansionPackage).default([]),
  baseTemplates: z.array(baseTemplate).default([]),
});

export const puDataFileSchema = z.object({
  fileFormat: z.literal(FILE_FORMAT),
  schemaVersion: z.number().int().positive(),
  meta: z.object({
    name: z.string().default("Untitled"),
    createdAt: z.string(),
    updatedAt: z.string(),
    appVersion: z.string().default("unknown"),
  }),
  settings: z.object({
    activeScenarioId: z.string().nullable().default(null),
    defaultExchangeCode: z.string().nullable().default(null),
  }),
  scenarios: z.array(scenario).default([]),
});

export type ParseResult =
  | { ok: true; data: PuDataFile }
  | { ok: false; error: string };

export function parseDataFile(raw: unknown): ParseResult {
  const result = puDataFileSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "(root)";
    return { ok: false, error: `${path}: ${first?.message ?? "invalid file"}` };
  }
  return { ok: true, data: result.data as PuDataFile };
}
