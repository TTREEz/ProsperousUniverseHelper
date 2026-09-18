import type { PlanetInfo, PopulationCounts, RecipeCandidate } from "@/provider/types";

export type ObjectiveType = "MAXIMIZE_OUTPUT" | "CLOSEST_TO_TARGET" | "MINIMIZE_IMPORTS" | "MAXIMIZE_SELF_SUFFICIENCY";
export type TargetPeriod = "HOUR" | "DAY" | "WEEK";

export type OptimizerInput = {
  planetCode: string;
  availableArea: number;
  objectiveType: ObjectiveType;
  targetProduct: string;
  targetAmount?: number | null;
  targetPeriod?: TargetPeriod | null;
  selectedWorkforceInHouseResources: string[];
  selectedRecipeOverrides: Record<string, string>;
  lockedBuildings?: unknown[];
  excludedRecipes?: string[];
};

export type RecipeDecision = {
  product: string;
  selectedRecipeId: string | null;
  selectedRecipeLabel: string | null;
  recommendedRecipeId: string | null;
  recommendationReason: string;
  alternatives: Array<{ id: string; label: string; buildingTicker: string | null; recommendationReason?: string }>;
  overridden: boolean;
};

export type ProductionRow = {
  product: string;
  requiredPerHour: number;
  requiredPerDay: number;
  requiredPerWeek: number;
  recipeId: string | null;
  recipeLabel: string | null;
  factoryCode: string | null;
  batchQty: number | null;
  batchHours100: number | null;
  currentBatchHours: number | null;
  requiredEffectiveSlots: number | null;
  utilization: number | null;
  sourceReason: string;
  ingredients: Array<{ ticker: string; amountPerHour: number; amountPerWeek: number }>;
  status: "produced-in-house" | "available-from-planet" | "imported" | "unresolved";
};

export type BuildingPlanRow = {
  buildingCode: string;
  buildingName: string;
  count: number;
  slots: number;
  requiredSlots: number;
  areaEach: number | null;
  totalArea: number;
  workforceRequired: PopulationCounts;
  purpose: string;
  utilization: number | null;
  status: "planned" | "missing-area" | "missing-building-data";
  notes: string[];
};

export type WorkforceNeedRow = {
  workforceType: keyof PopulationCounts;
  materialTicker: string;
  materialName: string;
  isLuxury: boolean;
  amountPerDay: number;
  amountPerWeek: number;
  makeInHouse: boolean;
};

export type ImportRow = {
  resource: string;
  amountPerHour: number;
  amountPerDay: number;
  amountPerWeek: number;
  reason: string;
  source: string;
};

export type OptimizedBaseResult = {
  summary: {
    planetCode: string;
    planetName: string | null;
    availableArea: number;
    targetProduct: string;
    targetAchievedPerHour: number;
    targetAchievedPerDay: number;
    targetAchievedPerWeek: number;
    targetRequestedPerHour: number | null;
    areaUsed: number;
    areaRemaining: number;
    totalBuildingCount: number;
    totalWorkforceRequired: PopulationCounts;
    averageUtilization: number | null;
    unresolvedImportCount: number;
    score: number;
  };
  planet: PlanetInfo | null;
  finalProducts: ProductionRow[];
  buildingPlan: BuildingPlanRow[];
  productionChain: ProductionRow[];
  recipeDecisions: RecipeDecision[];
  workforcePlan: {
    totals: PopulationCounts;
    needs: WorkforceNeedRow[];
    providerSource: "provider" | "fallback";
  };
  imports: ImportRow[];
  warnings: string[];
};

export type RecipeWithScore = RecipeCandidate & { score: number; reason: string };

export type PhaseBuildingDelta = {
  buildingCode: string;
  buildingName: string;
  previousCount: number;
  nextCount: number;
  addCount: number;
  totalAreaAdded: number;
  purpose: string;
};

export type BasePhase = {
  id: string;
  index: number;
  name: string;
  areaCap: number;
  outputShareOfFinal: number | null;
  result: OptimizedBaseResult;
  buildingDeltas: PhaseBuildingDelta[];
};

export type BasePhasePlan = {
  generatedAt: string;
  finalArea: number;
  finalTargetPerWeek: number;
  phases: BasePhase[];
};
