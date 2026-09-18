/**
 * The unified data model. One of these objects IS the user's save file.
 *
 * Two deliberate departures from the Prisma schemas this replaces:
 *  - Arrays and records are stored as real JSON, not JSON-encoded strings. The
 *    old `selectedWorkforceInHouseResources String @default("[]")` shape existed
 *    only because SQLite has no array type.
 *  - Children are nested under their owner rather than held in flat tables with
 *    foreign keys. Deleting an owner drops its children with it, and each
 *    planet's collections can be passed straight into the planner calculations,
 *    which already take exactly these arrays.
 *
 * Cross-references that are not ownership (a trade route's endpoints, a
 * produced row's factory) stay as plain id strings.
 */

export const FILE_FORMAT = "pu-toolset-data" as const;
export const SCHEMA_VERSION = 2 as const;

export type IsoDate = string;

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export type PuDataFile = {
  fileFormat: typeof FILE_FORMAT;
  schemaVersion: number;
  meta: FileMeta;
  settings: AppSettings;
  scenarios: Scenario[];
};

export type FileMeta = {
  /** User-facing label for this save file, e.g. "Main company". */
  name: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  /** Version of the app that last wrote the file, for support/debugging. */
  appVersion: string;
};

export type AppSettings = {
  activeScenarioId: string | null;
  /** Exchange used when a planet does not override it, e.g. "NC1". */
  defaultExchangeCode: string | null;
};

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export type ScenarioKind = "LIVE" | "DRAFT" | "ARCHIVED";

export type Scenario = {
  id: string;
  name: string;
  kind: ScenarioKind;
  description: string | null;
  /** Set when this scenario was cloned from another, for provenance labels. */
  createdFromScenarioId: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  systems: System[];
  planets: Planet[];
  tradeRoutes: TradeRoute[];
  expansionPackages: ExpansionPackage[];
  /** Saved base-optimizer inputs. Merged in from the standalone optimizer app. */
  baseTemplates: BaseTemplate[];
};

export type System = {
  id: string;
  name: string;
  fioSystemNaturalId: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Planet and its owned planning rows
// ---------------------------------------------------------------------------

export type Planet = {
  id: string;
  name: string;
  /** Null means the planet is not grouped under a system yet. */
  systemId: string | null;
  fioPlanetNaturalId: string | null;
  defaultBuyExchangeCode: string | null;
  defaultSellExchangeCode: string | null;
  batchInfos: BatchInfo[];
  factories: Factory[];
  produced: Produced[];
  recipeInfos: RecipeInfo[];
  workforceConsumption: WorkforceConsumption[];
  needToBuy: NeedToBuy[];
  sellPlans: SellPlan[];
  capacityPlans: CapacityPlan[];
};

export type BatchInfo = {
  id: string;
  name: string;
  batchQty: number;
  knownBatchHours: number;
  knownEff: number;
  notes: string | null;
};

/**
 * A building that physically exists on the planet.
 *
 * Keyed by FIO building code rather than a free-typed name, because this is
 * what lets a shopping list subtract what you have already built from what a
 * plan says you need. Slot count and area come from the provider, so they are
 * not stored here.
 */
export type Factory = {
  id: string;
  buildingCode: string;
  count: number;
  /**
   * Production slots in one of these buildings.
   *
   * FIO publishes a building's area, workforce and recipes but not its slot
   * count, so this is entered by hand. Total slots for the row are this times
   * `count`.
   */
  slotsPerBuilding: number;
  /** Running efficiency as a fraction, e.g. 1.12 for 112%. */
  efficiency: number;
  notes: string | null;
};

export type Produced = {
  id: string;
  name: string;
  amount: number;
  allocatedSlots: number | null;
  /** Factory on the same planet, or null if unassigned. */
  factoryId: string | null;
  notes: string | null;
};

export type RecipeInfo = {
  id: string;
  product: string;
  ingredient: string;
  qtyPerProductBatch: number;
};

export type WorkforceConsumption = {
  id: string;
  resource: string;
  dailyConsumption: number;
  notes: string | null;
};

export type NeedToBuy = {
  id: string;
  resource: string;
  importPerDay: number;
  importPerWeek: number;
  netPerHour: number;
  sourceReason: string;
  manualExtraPerDay: number;
  notes: string | null;
};

export type SellPlan = {
  id: string;
  resource: string;
  amountPerWeek: number;
  sellAllAvailable: boolean;
  enabled: boolean;
  notes: string | null;
};

export type CapacityPlan = {
  id: string;
  name: string;
  description: string | null;
  /** Solver configuration. Shape owned by the capacity planner module. */
  config: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Scenario-level planning
// ---------------------------------------------------------------------------

export type TradeRoute = {
  id: string;
  fromPlanetId: string;
  toPlanetId: string;
  resource: string;
  amountPerWeek: number;
  enabled: boolean;
  notes: string | null;
};

export type ExpansionPackage = {
  id: string;
  name: string;
  description: string | null;
  systemId: string | null;
  targetPlanetId: string | null;
  exchangeCode: string | null;
  enabled: boolean;
  /**
   * Whether building quantities are a total to reach or an amount to add.
   *
   * A layout from the optimizer describes the finished base, so what to buy is
   * that minus what already stands on the target planet. A hand-written list is
   * usually "buy me this much" and must not be silently reduced, so this stays
   * off unless the list came from the optimizer or the user turns it on.
   */
  deductExistingBuildings: boolean;
  items: ExpansionPackageItem[];
  adjustments: ExpansionPackageAdjustment[];
  checklist: ExpansionChecklistItem[];
};

export type ExpansionItemType = "MATERIAL" | "BUILDING";

export type ExpansionPackageItem = {
  id: string;
  itemType: ExpansionItemType;
  itemCode: string;
  itemNameSnapshot: string | null;
  quantity: number;
  sortOrder: number;
  notes: string | null;
};

export type ExpansionPackageAdjustment = {
  id: string;
  materialTicker: string;
  quantityDelta: number;
  reason: string | null;
};

export type ExpansionChecklistItem = {
  id: string;
  materialTicker: string;
  acquiredQuantity: number;
  checkedComplete: boolean;
};

// ---------------------------------------------------------------------------
// Base optimizer
// ---------------------------------------------------------------------------

export type ObjectiveType =
  | "MAXIMIZE_OUTPUT"
  | "CLOSEST_TO_TARGET"
  | "MINIMIZE_IMPORTS"
  | "MAXIMIZE_SELF_SUFFICIENCY";

export type TargetPeriod = "HOUR" | "DAY" | "WEEK";

export type BaseTemplate = {
  id: string;
  name: string;
  /**
   * Optional link to a planet in this same scenario. This is the join the two
   * original apps could not make: optimize a layout, then apply the resulting
   * building plan onto that planet's factory and produced rows.
   */
  planetId: string | null;
  /** FIO natural id, kept even when planetId is set so results stay readable. */
  planetCode: string;
  planetNameSnapshot: string | null;
  availableArea: number;
  objectiveType: ObjectiveType;
  targetProduct: string;
  targetAmount: number | null;
  targetPeriod: TargetPeriod | null;
  selectedWorkforceInHouseResources: string[];
  selectedRecipeOverrides: Record<string, string>;
  excludedRecipes: string[];
  notes: string | null;
  results: BaseTemplateResult[];
};

export type BaseTemplateResult = {
  id: string;
  createdAt: IsoDate;
  score: number;
  targetAchieved: number;
  areaUsed: number;
  averageUtilization: number;
  warningCount: number;
  /** Full OptimizedBaseResult snapshot. Typed by the optimizer module. */
  snapshot: unknown;
};
