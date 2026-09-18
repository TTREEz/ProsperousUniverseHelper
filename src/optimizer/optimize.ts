import { normalizeTicker } from "@/lib/formats";
import { prosperousProvider } from "@/provider/fio-provider";
import type {
  PlanetInfo,
  PlanetResource,
  PopulationClass,
  PopulationCounts,
  ProsperousProvider,
  RecipeCandidate,
  WorkforceNeed,
} from "@/provider/types";
import type {
  BuildingPlanRow,
  ImportRow,
  OptimizedBaseResult,
  OptimizerInput,
  ProductionRow,
  RecipeDecision,
  RecipeWithScore,
  WorkforceNeedRow,
} from "@/optimizer/types";

const POPULATION_CLASSES: PopulationClass[] = ["pioneers", "settlers", "technicians", "engineers", "scientists"];
const MAX_CHAIN_EXPANSIONS = 160;
const MAX_WORKFORCE_ITERATIONS = 5;
const MAX_RECIPE_LOOKAHEAD_DEPTH = 7;
const DEFAULT_TARGET_PER_HOUR = 1;
const EXTRACTION_BUILDING_BY_RESOURCE_TYPE: Record<string, string> = {
  GASEOUS: "COL",
  GAS: "COL",
  LIQUID: "RIG",
  MINERAL: "EXT",
  ORE: "EXT",
};
const EXTRACTION_DAILY_MULTIPLIER_BY_RESOURCE_TYPE: Record<string, number> = {
  GASEOUS: 60,
  GAS: 60,
  LIQUID: 70,
  MINERAL: 70,
  ORE: 70,
};
const HOUSING_BUILDINGS: Array<{
  code: string;
  label: string;
  fallbackArea: number;
  capacity: PopulationCounts;
}> = [
  { code: "HB1", label: "Pioneer Housing", fallbackArea: 10, capacity: { pioneers: 100, settlers: 0, technicians: 0, engineers: 0, scientists: 0 } },
  { code: "HB2", label: "Settler Housing", fallbackArea: 12, capacity: { pioneers: 0, settlers: 100, technicians: 0, engineers: 0, scientists: 0 } },
  { code: "HB3", label: "Technician Housing", fallbackArea: 14, capacity: { pioneers: 0, settlers: 0, technicians: 100, engineers: 0, scientists: 0 } },
  { code: "HB4", label: "Engineer Housing", fallbackArea: 16, capacity: { pioneers: 0, settlers: 0, technicians: 0, engineers: 100, scientists: 0 } },
  { code: "HB5", label: "Scientist Housing", fallbackArea: 18, capacity: { pioneers: 0, settlers: 0, technicians: 0, engineers: 0, scientists: 100 } },
  { code: "HBB", label: "Habitation Barracks", fallbackArea: 14, capacity: { pioneers: 100, settlers: 100, technicians: 0, engineers: 0, scientists: 0 } },
  { code: "HBC", label: "Habitation Commune", fallbackArea: 17, capacity: { pioneers: 0, settlers: 100, technicians: 100, engineers: 0, scientists: 0 } },
  { code: "HBM", label: "Habitation Managers", fallbackArea: 20, capacity: { pioneers: 0, settlers: 0, technicians: 100, engineers: 100, scientists: 0 } },
  { code: "HBL", label: "Habitation Luxury", fallbackArea: 22, capacity: { pioneers: 0, settlers: 0, technicians: 0, engineers: 100, scientists: 100 } },
];
const HOUSING_SINGLE_BY_CLASS: Record<PopulationClass, (typeof HOUSING_BUILDINGS)[number]> = {
  pioneers: HOUSING_BUILDINGS[0],
  settlers: HOUSING_BUILDINGS[1],
  technicians: HOUSING_BUILDINGS[2],
  engineers: HOUSING_BUILDINGS[3],
  scientists: HOUSING_BUILDINGS[4],
};
const HOUSING_MIXED_BY_EDGE: Array<(typeof HOUSING_BUILDINGS)[number]> = [
  HOUSING_BUILDINGS[5],
  HOUSING_BUILDINGS[6],
  HOUSING_BUILDINGS[7],
  HOUSING_BUILDINGS[8],
];

type DemandSource = "target" | "ingredient" | "workforce-support";

type SolveContext = {
  provider: ProsperousProvider;
  planet: PlanetInfo | null;
  localResources: Set<string>;
  localResourceByTicker: Map<string, PlanetResource>;
  recipeOverrides: Record<string, string>;
  excludedRecipes: Set<string>;
  forceProduce: Set<string>;
  warnings: Set<string>;
  recipeDecisions: Map<string, RecipeDecision>;
  estimateCache: Map<string, Promise<RecipePlanEstimate>>;
};

type RecipePlanEstimate = {
  area: number;
  requiredSlots: number;
  availableSlots: number;
  buildingCount: number;
  importPerHour: number;
  missingDataPenalty: number;
  score: number;
  reason: string;
};

type RawSolve = {
  ratePerHour: number;
  productionRows: ProductionRow[];
  buildingPlan: BuildingPlanRow[];
  imports: ImportRow[];
  recipeDecisions: RecipeDecision[];
  workforceTotals: PopulationCounts;
  workforceNeeds: WorkforceNeedRow[];
  workforceSource: "provider" | "fallback";
  areaUsed: number;
  averageUtilization: number | null;
  warnings: string[];
};

function emptyPopulation(): PopulationCounts {
  return { pioneers: 0, settlers: 0, technicians: 0, engineers: 0, scientists: 0 };
}

function addPopulation(target: PopulationCounts, addition: PopulationCounts, multiplier = 1) {
  for (const key of POPULATION_CLASSES) {
    target[key] += (addition[key] ?? 0) * multiplier;
  }
}

function subtractPopulation(target: PopulationCounts, subtraction: PopulationCounts, multiplier = 1) {
  for (const key of POPULATION_CLASSES) {
    target[key] = Math.max(0, target[key] - (subtraction[key] ?? 0) * multiplier);
  }
}

function periodToHours(period: string | null | undefined) {
  if (period === "DAY") return 24;
  if (period === "WEEK") return 168;
  return 1;
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function ceilWholeSlots(requiredSlots: number) {
  if (requiredSlots <= 0) return 0;
  const rounded = Math.round(requiredSlots);
  return Math.abs(requiredSlots - rounded) < 0.000001 ? rounded : Math.ceil(requiredSlots);
}

function wholeSlotPlan(amountPerHour: number, batchHours: number, outputAmount: number) {
  const continuousSlots = outputAmount > 0 ? (amountPerHour * batchHours) / outputAmount : 0;
  const assignedSlots = ceilWholeSlots(continuousSlots);
  const plannedPerHour = batchHours > 0 ? (assignedSlots * outputAmount) / batchHours : amountPerHour;
  return { assignedSlots, plannedPerHour };
}

function round(value: number, digits = 8) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positiveEntries(map: Map<string, number>) {
  return [...map.entries()].filter(([, amount]) => amount > 0.00000001);
}

function emptyEstimate(): RecipePlanEstimate {
  return { area: 0, requiredSlots: 0, availableSlots: 0, buildingCount: 0, importPerHour: 0, missingDataPenalty: 0, score: 0, reason: "" };
}

function combineEstimates(estimates: RecipePlanEstimate[]) {
  const combined = emptyEstimate();
  for (const estimate of estimates) {
    combined.area += estimate.area;
    combined.requiredSlots += estimate.requiredSlots;
    combined.availableSlots += estimate.availableSlots;
    combined.buildingCount += estimate.buildingCount;
    combined.importPerHour += estimate.importPerHour;
    combined.missingDataPenalty += estimate.missingDataPenalty;
  }
  combined.score = estimateScore(combined);
  combined.reason = estimateReason(combined);
  return combined;
}

function estimateScore(estimate: Omit<RecipePlanEstimate, "score" | "reason">) {
  const utilization = safeDivide(estimate.requiredSlots, estimate.availableSlots) ?? 0;
  const utilizationPenalty = estimate.availableSlots > 0 ? Math.abs(1 - utilization) * 20 : 8;
  return (
    estimate.area +
    estimate.buildingCount * 0.75 +
    estimate.importPerHour * 250 +
    estimate.missingDataPenalty +
    utilizationPenalty
  );
}

function estimateReason(estimate: Omit<RecipePlanEstimate, "score" | "reason">) {
  const utilization = safeDivide(estimate.requiredSlots, estimate.availableSlots);
  return [
    `lookahead area ${round(estimate.area, 2)}`,
    `utilization ${utilization === null ? "n/a" : `${round(utilization * 100, 1)}%`}`,
    `imports ${round(estimate.importPerHour, 5)}/h`,
    `${estimate.buildingCount} building${estimate.buildingCount === 1 ? "" : "s"}`,
  ].join(", ");
}

async function estimateBuildingFootprint(
  ctx: SolveContext,
  buildingCode: string | null,
  requiredSlots: number,
): Promise<RecipePlanEstimate> {
  if (!buildingCode || requiredSlots <= 0) {
    const estimate = { ...emptyEstimate(), missingDataPenalty: buildingCode ? 0 : 40 };
    estimate.score = estimateScore(estimate);
    estimate.reason = estimateReason(estimate);
    return estimate;
  }

  const building = await ctx.provider.getBuildingByCode(buildingCode);
  const slotsPerBuilding = Math.max(1, Math.floor(building?.slots ?? 1));
  const wholeSlots = Math.ceil(requiredSlots);
  const count = Math.ceil(wholeSlots / slotsPerBuilding);
  const availableSlots = count * slotsPerBuilding;
  const area = (building?.areaCost ?? 0) * count;
  const missingDataPenalty = !building || building.areaCost === null ? 80 : 0;
  const estimate = {
    area,
    requiredSlots,
    availableSlots,
    buildingCount: count,
    importPerHour: 0,
    missingDataPenalty,
    score: 0,
    reason: "",
  };
  estimate.score = estimateScore(estimate);
  estimate.reason = estimateReason(estimate);
  return estimate;
}

async function estimateRecipeCandidate(
  ctx: SolveContext,
  recipe: RecipeCandidate,
  amountPerHour: number,
  depth: number,
  path: Set<string>,
): Promise<RecipeWithScore> {
  const ownSlots = (amountPerHour * recipe.batchHours) / recipe.outputAmount;
  const ownEstimate = await estimateBuildingFootprint(ctx, recipe.buildingTicker, ownSlots);
  const inputEstimates = await Promise.all(
    recipe.inputs.map((input) => estimateProduct(ctx, input.ticker, (amountPerHour * input.amount) / recipe.outputAmount, depth + 1, new Set(path))),
  );
  const estimate = combineEstimates([ownEstimate, ...inputEstimates]);
  const localInputCount = recipe.inputs.filter((input) => ctx.localResources.has(input.ticker)).length;
  const reason = [
    estimate.reason,
    localInputCount > 0 ? `${localInputCount} local input${localInputCount === 1 ? "" : "s"}` : "no local inputs",
    recipe.standardRecipeName ? "standard recipe" : "variant recipe",
  ].join(", ");

  return { ...recipe, score: -estimate.score, reason };
}

async function estimateProduct(
  ctx: SolveContext,
  product: string,
  amountPerHour: number,
  depth: number,
  path: Set<string>,
): Promise<RecipePlanEstimate> {
  if (amountPerHour <= 0) return emptyEstimate();
  if (depth > MAX_RECIPE_LOOKAHEAD_DEPTH || path.has(product)) {
    const estimate = { ...emptyEstimate(), importPerHour: amountPerHour, missingDataPenalty: 60 };
    estimate.score = estimateScore(estimate);
    estimate.reason = estimateReason(estimate);
    return estimate;
  }

  const key = `${product}:${round(amountPerHour, 8)}:${depth}`;
  const cached = ctx.estimateCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const extraction = resolveExtraction(ctx, product, false);
    if (extraction) {
      const requiredSlots = (amountPerHour * extraction.batchHours) / extraction.outputAmount;
      return estimateBuildingFootprint(ctx, extraction.buildingCode, requiredSlots);
    }

    const candidates = (await ctx.provider.getRecipeVariants(product)).filter((recipe) => !ctx.excludedRecipes.has(recipe.id));
    if (candidates.length === 0) {
      const estimate = { ...emptyEstimate(), importPerHour: amountPerHour };
      estimate.score = estimateScore(estimate);
      estimate.reason = estimateReason(estimate);
      return estimate;
    }

    path.add(product);
    const overrideId = ctx.recipeOverrides[product] ?? null;
    const selectedCandidates = overrideId ? candidates.filter((recipe) => recipe.id === overrideId) : candidates;
    const scored = await Promise.all(
      (selectedCandidates.length ? selectedCandidates : candidates).map((recipe) => estimateRecipeCandidate(ctx, recipe, amountPerHour, depth, new Set(path))),
    );
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    return estimateRecipeAsFootprint(ctx, best, amountPerHour, depth, new Set(path));
  })();

  ctx.estimateCache.set(key, promise);
  return promise;
}

async function estimateRecipeAsFootprint(
  ctx: SolveContext,
  recipe: RecipeCandidate,
  amountPerHour: number,
  depth: number,
  path: Set<string>,
) {
  const ownSlots = (amountPerHour * recipe.batchHours) / recipe.outputAmount;
  const ownEstimate = await estimateBuildingFootprint(ctx, recipe.buildingTicker, ownSlots);
  const inputEstimates = await Promise.all(
    recipe.inputs.map((input) => estimateProduct(ctx, input.ticker, (amountPerHour * input.amount) / recipe.outputAmount, depth + 1, new Set(path))),
  );
  return combineEstimates([ownEstimate, ...inputEstimates]);
}

async function chooseRecipe(ctx: SolveContext, product: string, amountPerHour: number) {
  const candidates = (await ctx.provider.getRecipeVariants(product)).filter((recipe) => !ctx.excludedRecipes.has(recipe.id));
  if (candidates.length === 0) return null;

  const scored = await Promise.all(candidates.map((recipe) => estimateRecipeCandidate(ctx, recipe, amountPerHour, 0, new Set([product]))));
  scored.sort((a, b) => b.score - a.score);
  const recommended = scored[0];
  const overrideId = ctx.recipeOverrides[product] ?? null;
  const selected = overrideId ? scored.find((recipe) => recipe.id === overrideId) ?? null : recommended;
  if (overrideId && !selected) {
    ctx.warnings.add(`${product} has a recipe override that no longer matches provider data; using the current recommendation.`);
  }

  const finalRecipe = selected ?? recommended;
  ctx.recipeDecisions.set(product, {
    product,
    selectedRecipeId: finalRecipe.id,
    selectedRecipeLabel: finalRecipe.label,
    recommendedRecipeId: recommended.id,
    recommendationReason: recommended.reason,
    alternatives: scored.map((recipe) => ({ id: recipe.id, label: recipe.label, buildingTicker: recipe.buildingTicker, recommendationReason: recipe.reason })),
    overridden: Boolean(overrideId && finalRecipe.id === overrideId && finalRecipe.id !== recommended.id),
  });

  return finalRecipe;
}

function addDemand(demands: Map<string, number>, product: string, amountPerHour: number) {
  demands.set(product, (demands.get(product) ?? 0) + amountPerHour);
}

function normalizedResourceType(resource: PlanetResource) {
  return (resource.resourceType ?? "").trim().toUpperCase();
}

function extractionBuildingCode(resource: PlanetResource) {
  const resourceType = normalizedResourceType(resource);
  return EXTRACTION_BUILDING_BY_RESOURCE_TYPE[resourceType] ?? null;
}

function extractionDailyYield(resource: PlanetResource) {
  const resourceType = normalizedResourceType(resource);
  const multiplier = EXTRACTION_DAILY_MULTIPLIER_BY_RESOURCE_TYPE[resourceType] ?? null;
  const factor = resource.factor ?? 0;
  if (!multiplier || factor <= 0) return null;
  return Math.round(factor * multiplier);
}

function extractionLabel(product: string, resource: PlanetResource, buildingCode: string, dailyYield: number) {
  const resourceType = (resource.resourceType ?? "").trim().toUpperCase();
  const typeLabel = resource.resourceType ? `${resource.resourceType.toLowerCase()} deposit` : "local deposit";
  const multiplier = EXTRACTION_DAILY_MULTIPLIER_BY_RESOURCE_TYPE[resourceType];
  return `${buildingCode}: extract ${round(dailyYield, 4)} ${product} / day from ${typeLabel}${multiplier ? ` (factor x ${multiplier})` : ""}`;
}

function resolveExtraction(ctx: SolveContext, product: string, emitWarnings = true) {
  const resource = ctx.localResourceByTicker.get(product);
  if (!resource) return null;

  const buildingCode = extractionBuildingCode(resource);
  const dailyYield = extractionDailyYield(resource);
  if (!buildingCode) {
    if (emitWarnings) ctx.warnings.add(`${product} is present on the planet, but resource type '${resource.resourceType ?? "unknown"}' is not mapped to an extraction building.`);
    return null;
  }
  if (!dailyYield || dailyYield <= 0) {
    if (emitWarnings) ctx.warnings.add(`${product} is present on the planet, but its extraction factor is missing, zero, or rounds to zero daily output.`);
    return null;
  }

  return {
    buildingCode,
    batchHours: 24,
    outputAmount: dailyYield,
    label: extractionLabel(product, resource, buildingCode, dailyYield),
  };
}

async function expandDemandGraph(
  ctx: SolveContext,
  initialDemands: Map<string, number>,
  sourceByProduct: Map<string, DemandSource>,
) {
  const demands = new Map(initialDemands);
  const expanded = new Map<string, number>();
  const rows = new Map<string, ProductionRow>();
  const imports = new Map<string, ImportRow>();
  const factorySlots = new Map<string, { requiredSlots: number; products: Set<string>; productSlots: Map<string, number> }>();
  let expansions = 0;

  while (expansions < MAX_CHAIN_EXPANSIONS) {
    const next = positiveEntries(demands).find(([product, amount]) => amount - (expanded.get(product) ?? 0) > 0.00000001);
    if (!next) break;
    expansions += 1;

    const [product, totalDemand] = next;
    const forced = ctx.forceProduce.has(product);
    const source = sourceByProduct.get(product) ?? "ingredient";
    const extraction = resolveExtraction(ctx, product);
    if (extraction) {
      const slotPlan = wholeSlotPlan(totalDemand, extraction.batchHours, extraction.outputAmount);
      const previousAssignedSlots = rows.get(product)?.requiredEffectiveSlots ?? 0;
      const deltaSlots = Math.max(0, slotPlan.assignedSlots - previousAssignedSlots);
      const group = factorySlots.get(extraction.buildingCode) ?? {
        requiredSlots: 0,
        products: new Set<string>(),
        productSlots: new Map<string, number>(),
      };
      group.requiredSlots += deltaSlots;
      group.products.add(product);
      group.productSlots.set(product, slotPlan.assignedSlots);
      factorySlots.set(extraction.buildingCode, group);
      expanded.set(product, Math.max(totalDemand, slotPlan.plannedPerHour));

      rows.set(product, {
        product,
        requiredPerHour: slotPlan.plannedPerHour,
        requiredPerDay: slotPlan.plannedPerHour * 24,
        requiredPerWeek: slotPlan.plannedPerHour * 168,
        recipeId: `extract:${product}:${extraction.buildingCode}`,
        recipeLabel: extraction.label,
        factoryCode: extraction.buildingCode,
        batchQty: extraction.outputAmount,
        batchHours100: extraction.batchHours,
        currentBatchHours: extraction.batchHours,
        requiredEffectiveSlots: slotPlan.assignedSlots,
        utilization: null,
        sourceReason: "Local planet resource extraction",
        ingredients: [],
        status: "produced-in-house",
      });
      continue;
    }

    const recipe = await chooseRecipe(ctx, product, totalDemand);

    if (!recipe) {
      const local = ctx.localResources.has(product);
      const status = local ? "unresolved" : forced ? "unresolved" : "imported";
      expanded.set(product, totalDemand);
      rows.set(product, {
        product,
        requiredPerHour: totalDemand,
        requiredPerDay: totalDemand * 24,
        requiredPerWeek: totalDemand * 168,
        recipeId: null,
        recipeLabel: null,
        factoryCode: null,
        batchQty: null,
        batchHours100: null,
        currentBatchHours: null,
        requiredEffectiveSlots: null,
        utilization: null,
        sourceReason: local ? "Local resource extraction metadata incomplete" : forced ? "No provider recipe found for selected in-house product" : "No local production path selected",
        ingredients: [],
        status,
      });
      imports.set(product, {
        resource: product,
        amountPerHour: totalDemand,
        amountPerDay: totalDemand * 24,
        amountPerWeek: totalDemand * 168,
        reason: local ? "Unresolved local extraction path" : status === "unresolved" ? "Unresolved production path" : "Recipe leaf material",
        source,
      });
      if (forced && !local) ctx.warnings.add(`${product} was selected for in-house production but no provider recipe was found.`);
      continue;
    }

    const currentBatchHours = recipe.batchHours;
    const slotPlan = wholeSlotPlan(totalDemand, currentBatchHours, recipe.outputAmount);
    const previousAssignedSlots = rows.get(product)?.requiredEffectiveSlots ?? 0;
    const productionDelta = Math.max(0, slotPlan.plannedPerHour - (rows.get(product)?.requiredPerHour ?? 0));
    const existing = rows.get(product);
    const ingredients = recipe.inputs.map((input) => {
      const inputPerHour = (productionDelta * input.amount) / recipe.outputAmount;
      const totalInputPerHour = (slotPlan.plannedPerHour * input.amount) / recipe.outputAmount;
      addDemand(demands, input.ticker, inputPerHour);
      return { ticker: input.ticker, amountPerHour: totalInputPerHour, amountPerWeek: totalInputPerHour * 168 };
    });
    expanded.set(product, Math.max(totalDemand, slotPlan.plannedPerHour));

    if (recipe.buildingTicker) {
      const group = factorySlots.get(recipe.buildingTicker) ?? {
        requiredSlots: 0,
        products: new Set<string>(),
        productSlots: new Map<string, number>(),
      };
      group.requiredSlots += Math.max(0, slotPlan.assignedSlots - previousAssignedSlots);
      group.products.add(product);
      group.productSlots.set(product, slotPlan.assignedSlots);
      factorySlots.set(recipe.buildingTicker, group);
    } else {
      ctx.warnings.add(`${product} recipe did not include a building ticker; area and workforce may be incomplete.`);
    }

    rows.set(product, {
      product,
      requiredPerHour: slotPlan.plannedPerHour,
      requiredPerDay: slotPlan.plannedPerHour * 24,
      requiredPerWeek: slotPlan.plannedPerHour * 168,
      recipeId: recipe.id,
      recipeLabel: recipe.label,
      factoryCode: recipe.buildingTicker,
      batchQty: recipe.outputAmount,
      batchHours100: recipe.batchHours,
      currentBatchHours,
      requiredEffectiveSlots: slotPlan.assignedSlots,
      utilization: existing?.utilization ?? null,
      sourceReason: source === "target" ? "Target output" : source === "workforce-support" ? "Selected workforce support good" : "Intermediate prerequisite",
      ingredients,
      status: "produced-in-house",
    });
  }

  if (expansions >= MAX_CHAIN_EXPANSIONS) {
    ctx.warnings.add("Recipe-chain expansion hit its safety limit; remaining requirements are surfaced as warnings/imports.");
  }

  const buildingPlan: BuildingPlanRow[] = [];
  for (const [buildingCode, group] of factorySlots.entries()) {
    const building = await ctx.provider.getBuildingByCode(buildingCode);
    const slotsPerBuilding = Math.max(1, Math.floor(building?.slots ?? 1));
    const wholeSlots = ceilWholeSlots(group.requiredSlots);
    const count = Math.ceil(wholeSlots / slotsPerBuilding);
    const totalSlots = count * slotsPerBuilding;
    const utilization = safeDivide(group.requiredSlots, totalSlots);
    const areaEach = building?.areaCost ?? null;
    const totalArea = areaEach === null ? 0 : areaEach * count;
    const workforceRequired = emptyPopulation();

    if (building) addPopulation(workforceRequired, building.workforce, count);
    if (!building) ctx.warnings.add(`${buildingCode} building metadata could not be resolved; area and workforce are incomplete.`);
    if (building && areaEach === null) ctx.warnings.add(`${buildingCode} building metadata did not include base area.`);

    for (const [product, productSlots] of group.productSlots.entries()) {
      const row = rows.get(product);
      if (row) {
        rows.set(product, { ...row, utilization: safeDivide(productSlots, ceilWholeSlots(productSlots)) });
      }
    }

    buildingPlan.push({
      buildingCode,
      buildingName: building?.name ?? buildingCode,
      count,
      slots: totalSlots,
      requiredSlots: group.requiredSlots,
      areaEach,
      totalArea,
      workforceRequired,
      purpose: [...group.products].sort().join(", "),
      utilization,
      status: !building ? "missing-building-data" : areaEach === null ? "missing-area" : "planned",
      notes: [
        `Assigned recipe slots ${round(group.requiredSlots, 4)}; whole slots ${wholeSlots}.`,
        slotsPerBuilding > 1 ? `${slotsPerBuilding} provider-backed slots per building.` : "Assuming one slot per building from provider metadata.",
      ],
    });
  }

  return {
    productionRows: [...rows.values()].sort((a, b) => a.product.localeCompare(b.product)),
    buildingPlan: buildingPlan.sort((a, b) => b.totalArea - a.totalArea || a.buildingCode.localeCompare(b.buildingCode)),
    imports: [...imports.values()].sort((a, b) => b.amountPerWeek - a.amountPerWeek || a.resource.localeCompare(b.resource)),
  };
}

function calculateWorkforceNeeds(
  needs: WorkforceNeed[],
  workforceTotals: PopulationCounts,
  selectedInHouse: Set<string>,
  produceAll: boolean,
): WorkforceNeedRow[] {
  const rows = new Map<string, WorkforceNeedRow>();
  for (const need of needs) {
    const count = workforceTotals[need.workforceType] ?? 0;
    if (count <= 0) continue;
    const amountPerDay = (count / 100) * need.amountPer100Daily;
    const key = `${need.workforceType}:${need.materialTicker}`;
    const existing = rows.get(key);
    rows.set(key, {
      workforceType: need.workforceType,
      materialTicker: need.materialTicker,
      materialName: need.materialName,
      isLuxury: need.isLuxury,
      amountPerDay: (existing?.amountPerDay ?? 0) + amountPerDay,
      amountPerWeek: (existing?.amountPerWeek ?? 0) + amountPerDay * 7,
      makeInHouse: produceAll || selectedInHouse.has(need.materialTicker),
    });
  }
  return [...rows.values()].sort((a, b) => a.materialTicker.localeCompare(b.materialTicker) || a.workforceType.localeCompare(b.workforceType));
}

function aggregateWorkforce(buildingPlan: BuildingPlanRow[]) {
  const totals = emptyPopulation();
  for (const row of buildingPlan) addPopulation(totals, row.workforceRequired);
  return totals;
}

async function getHousingAreas(provider: ProsperousProvider, warnings: Set<string>) {
  const areas = new Map<string, number>();
  for (const housing of HOUSING_BUILDINGS) {
    const building = await provider.getBuildingByCode(housing.code);
    if (!building?.areaCost) {
      warnings.add(`${housing.code} housing area was not available from the provider; using fallback area ${housing.fallbackArea}.`);
    }
    areas.set(housing.code, building?.areaCost ?? housing.fallbackArea);
  }
  return areas;
}

function housingCapacityForCount(housing: (typeof HOUSING_BUILDINGS)[number], count: number) {
  const capacity = emptyPopulation();
  addPopulation(capacity, housing.capacity, count);
  return capacity;
}

function housingCapacitySummary(capacity: PopulationCounts) {
  return POPULATION_CLASSES
    .filter((key) => capacity[key] > 0)
    .map((key) => `${capacity[key]} ${key}`)
    .join(", ");
}

function housingCostForCounts(counts: Record<string, number>, areas: Map<string, number>) {
  return Object.entries(counts).reduce((sum, [code, count]) => sum + (areas.get(code) ?? 0) * count, 0);
}

function optimizeHousingCounts(workforceTotals: PopulationCounts, areas: Map<string, number>) {
  const requiredBlocks = POPULATION_CLASSES.map((key) => Math.ceil(Math.max(0, workforceTotals[key]) / 100));
  const singles = POPULATION_CLASSES.map((key) => HOUSING_SINGLE_BY_CLASS[key]);
  const memo = new Map<string, { cost: number; counts: Record<string, number> }>();

  function search(index: number, previousMixedCount: number): { cost: number; counts: Record<string, number> } {
    const key = `${index}:${previousMixedCount}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const remainingAtCurrent = Math.max(0, requiredBlocks[index] - previousMixedCount);
    if (index === POPULATION_CLASSES.length - 1) {
      const single = singles[index];
      const counts = remainingAtCurrent > 0 ? { [single.code]: remainingAtCurrent } : {};
      const result = { cost: housingCostForCounts(counts, areas), counts };
      memo.set(key, result);
      return result;
    }

    const mixed = HOUSING_MIXED_BY_EDGE[index];
    const maxMixedCount = Math.min(remainingAtCurrent, requiredBlocks[index + 1]);
    let best: { cost: number; counts: Record<string, number> } | null = null;

    for (let mixedCount = 0; mixedCount <= maxMixedCount; mixedCount += 1) {
      const single = singles[index];
      const singleCount = remainingAtCurrent - mixedCount;
      const rest = search(index + 1, mixedCount);
      const counts = { ...rest.counts };
      if (singleCount > 0) counts[single.code] = (counts[single.code] ?? 0) + singleCount;
      if (mixedCount > 0) counts[mixed.code] = (counts[mixed.code] ?? 0) + mixedCount;
      const cost = housingCostForCounts(counts, areas);
      if (!best || cost < best.cost || (cost === best.cost && Object.values(counts).reduce((sum, count) => sum + count, 0) < Object.values(best.counts).reduce((sum, count) => sum + count, 0))) {
        best = { cost, counts };
      }
    }

    const result = best ?? { cost: 0, counts: {} };
    memo.set(key, result);
    return result;
  }

  return search(0, 0).counts;
}

async function planHousing(provider: ProsperousProvider, workforceTotals: PopulationCounts, warnings: Set<string>): Promise<BuildingPlanRow[]> {
  const workforceCount = POPULATION_CLASSES.reduce((sum, key) => sum + workforceTotals[key], 0);
  if (workforceCount <= 0) return [];

  const areas = await getHousingAreas(provider, warnings);
  const counts = optimizeHousingCounts(workforceTotals, areas);
  const remainingResidents = { ...workforceTotals };
  const rows: BuildingPlanRow[] = [];

  for (const housing of HOUSING_BUILDINGS) {
    const count = counts[housing.code] ?? 0;
    if (count <= 0) continue;

    const building = await provider.getBuildingByCode(housing.code);
    const areaEach = building?.areaCost ?? housing.fallbackArea;
    const totalCapacity = housingCapacityForCount(housing, count);
    const requiredForThisHousing = emptyPopulation();
    for (const key of POPULATION_CLASSES) {
      requiredForThisHousing[key] = Math.min(remainingResidents[key], totalCapacity[key]);
    }
    const requiredResidents = POPULATION_CLASSES.reduce((sum, key) => sum + requiredForThisHousing[key], 0);
    const totalResidents = POPULATION_CLASSES.reduce((sum, key) => sum + totalCapacity[key], 0);
    subtractPopulation(remainingResidents, totalCapacity);

    rows.push({
      buildingCode: housing.code,
      buildingName: building?.name ?? housing.label,
      count,
      slots: totalResidents,
      requiredSlots: requiredResidents,
      areaEach,
      totalArea: areaEach * count,
      workforceRequired: emptyPopulation(),
      purpose: `Housing: ${housingCapacitySummary(totalCapacity)}`,
      utilization: safeDivide(requiredResidents, totalResidents),
      status: building ? "planned" : "missing-building-data",
      notes: [
        `Required housing covered: ${housingCapacitySummary(requiredForThisHousing) || "0 residents"}.`,
        `Total housing capacity: ${housingCapacitySummary(totalCapacity)}.`,
      ],
    });
  }

  return rows;
}

async function solveForRate(
  input: OptimizerInput,
  provider: ProsperousProvider,
  planet: PlanetInfo | null,
  ratePerHour: number,
): Promise<RawSolve> {
  const selectedInHouse = new Set(input.selectedWorkforceInHouseResources.map(normalizeTicker).filter(Boolean));
  const warnings = new Set<string>();
  const localResourceByTicker = new Map(
    (planet?.resources ?? [])
      .filter((resource): resource is PlanetResource & { ticker: string } => Boolean(resource.ticker))
      .map((resource) => [resource.ticker, resource]),
  );
  const localResources = new Set(localResourceByTicker.keys());
  const recipeDecisions = new Map<string, RecipeDecision>();
  const { needs, source } = await provider.getWorkforceNeeds();
  if (source === "fallback") warnings.add("Workforce needs provider request failed or returned no rows; using a small built-in fallback set and marking the result as provider-limited.");

  let supportTargets = new Map<string, number>();
  let lastSignature = "";
  let finalGraph: Awaited<ReturnType<typeof expandDemandGraph>> | null = null;
  let finalWorkforceTotals = emptyPopulation();
  let finalWorkforceNeeds: WorkforceNeedRow[] = [];

  for (let iteration = 0; iteration < MAX_WORKFORCE_ITERATIONS; iteration += 1) {
    const forceProduce = new Set<string>([normalizeTicker(input.targetProduct), ...selectedInHouse, ...supportTargets.keys()]);
    const sourceByProduct = new Map<string, DemandSource>([[normalizeTicker(input.targetProduct), "target"]]);
    const demands = new Map<string, number>([[normalizeTicker(input.targetProduct), ratePerHour]]);
    for (const [resource, amount] of supportTargets.entries()) {
      addDemand(demands, resource, amount);
      sourceByProduct.set(resource, "workforce-support");
    }

    const ctx: SolveContext = {
      provider,
      planet,
      localResources,
      localResourceByTicker,
      recipeOverrides: Object.fromEntries(Object.entries(input.selectedRecipeOverrides ?? {}).map(([key, value]) => [normalizeTicker(key), value])),
      excludedRecipes: new Set(input.excludedRecipes ?? []),
      forceProduce,
      warnings,
      recipeDecisions,
      estimateCache: new Map(),
    };

    finalGraph = await expandDemandGraph(ctx, demands, sourceByProduct);
    const productionWorkforceTotals = aggregateWorkforce(finalGraph.buildingPlan);
    const housingPlan = await planHousing(provider, productionWorkforceTotals, warnings);
    finalGraph = { ...finalGraph, buildingPlan: [...finalGraph.buildingPlan, ...housingPlan] };
    finalWorkforceTotals = aggregateWorkforce(finalGraph.buildingPlan);
    finalWorkforceNeeds = calculateWorkforceNeeds(needs, finalWorkforceTotals, selectedInHouse, input.objectiveType === "MAXIMIZE_SELF_SUFFICIENCY");

    const nextSupportTargets = new Map<string, number>();
    for (const row of finalWorkforceNeeds) {
      if (row.makeInHouse) nextSupportTargets.set(row.materialTicker, (nextSupportTargets.get(row.materialTicker) ?? 0) + row.amountPerDay / 24);
    }
    const signature = JSON.stringify([...nextSupportTargets.entries()].sort());
    supportTargets = nextSupportTargets;
    if (signature === lastSignature) break;
    lastSignature = signature;
    if (iteration === MAX_WORKFORCE_ITERATIONS - 1) warnings.add("Workforce support recursion reached its iteration limit before fully stabilizing.");
  }

  const graph = finalGraph ?? { productionRows: [], buildingPlan: [], imports: [] };
  const targetProduct = normalizeTicker(input.targetProduct);
  const actualTargetRate = graph.productionRows.find((row) => row.product === targetProduct)?.requiredPerHour ?? ratePerHour;
  const areaUsed = graph.buildingPlan.reduce((sum, row) => sum + row.totalArea, 0);
  const utilizations = graph.buildingPlan.map((row) => row.utilization).filter((value): value is number => value !== null && Number.isFinite(value));
  const averageUtilization = utilizations.length ? utilizations.reduce((sum, value) => sum + value, 0) / utilizations.length : null;

  return {
    ratePerHour: actualTargetRate,
    productionRows: graph.productionRows,
    buildingPlan: graph.buildingPlan,
    imports: graph.imports,
    recipeDecisions: [...recipeDecisions.values()].sort((a, b) => a.product.localeCompare(b.product)),
    workforceTotals: finalWorkforceTotals,
    workforceNeeds: finalWorkforceNeeds,
    workforceSource: source,
    areaUsed,
    averageUtilization,
    warnings: [...warnings],
  };
}

function targetAmountPerHour(input: OptimizerInput) {
  if (!input.targetAmount || input.targetAmount <= 0) return null;
  return input.targetAmount / periodToHours(input.targetPeriod);
}

function scoreResult(input: OptimizerInput, solve: RawSolve, requestedPerHour: number | null) {
  const outputRatio = requestedPerHour ? Math.min(1, solve.ratePerHour / requestedPerHour) : 1;
  const areaEfficiency = input.availableArea > 0 ? Math.min(1, solve.areaUsed / input.availableArea) : 0;
  const utilizationScore = solve.averageUtilization === null ? 0.4 : 1 - Math.min(1, Math.abs(1 - solve.averageUtilization));
  const importPenalty = Math.min(0.3, solve.imports.filter((row) => row.reason !== "Planet resource leaf").length * 0.03);
  const warningPenalty = Math.min(0.25, solve.warnings.length * 0.025);
  return round(outputRatio * 55 + areaEfficiency * 15 + utilizationScore * 25 - importPenalty * 100 - warningPenalty * 100, 4);
}

function toResult(input: OptimizerInput, planet: PlanetInfo | null, solve: RawSolve, requestedPerHour: number | null): OptimizedBaseResult {
  const score = scoreResult(input, solve, requestedPerHour);
  const targetRows = solve.productionRows.filter((row) => row.product === normalizeTicker(input.targetProduct));
  const warnings = new Set(solve.warnings);
  if (solve.areaUsed > input.availableArea) warnings.add(`Area exceeds available base area by ${round(solve.areaUsed - input.availableArea, 4)}.`);
  if (!planet && input.planetCode.trim()) warnings.add(`Planet '${input.planetCode}' could not be resolved from the provider.`);

  return {
    summary: {
      planetCode: planet?.naturalId ?? input.planetCode,
      planetName: planet?.name ?? null,
      availableArea: input.availableArea,
      targetProduct: normalizeTicker(input.targetProduct),
      targetAchievedPerHour: solve.ratePerHour,
      targetAchievedPerDay: solve.ratePerHour * 24,
      targetAchievedPerWeek: solve.ratePerHour * 168,
      targetRequestedPerHour: requestedPerHour,
      areaUsed: solve.areaUsed,
      areaRemaining: input.availableArea - solve.areaUsed,
      totalBuildingCount: solve.buildingPlan.reduce((sum, row) => sum + row.count, 0),
      totalWorkforceRequired: solve.workforceTotals,
      averageUtilization: solve.averageUtilization,
      unresolvedImportCount: solve.imports.filter((row) => row.reason !== "Planet resource leaf").length,
      score,
    },
    planet,
    finalProducts: targetRows.length ? targetRows : solve.productionRows.slice(0, 1),
    buildingPlan: solve.buildingPlan,
    productionChain: solve.productionRows,
    recipeDecisions: solve.recipeDecisions,
    workforcePlan: {
      totals: solve.workforceTotals,
      needs: solve.workforceNeeds,
      providerSource: solve.workforceSource,
    },
    imports: solve.imports,
    warnings: [...warnings],
  };
}

export async function optimizeBase(input: OptimizerInput, provider: ProsperousProvider = prosperousProvider): Promise<OptimizedBaseResult> {
  const normalizedInput: OptimizerInput = {
    ...input,
    targetProduct: normalizeTicker(input.targetProduct),
    planetCode: input.planetCode.trim(),
    selectedWorkforceInHouseResources: input.selectedWorkforceInHouseResources.map(normalizeTicker).filter(Boolean),
  };

  const planet = normalizedInput.planetCode ? await provider.getPlanetByIdOrCode(normalizedInput.planetCode) : null;
  const requestedPerHour = targetAmountPerHour(normalizedInput);

  if (normalizedInput.objectiveType === "CLOSEST_TO_TARGET" && requestedPerHour) {
    const full = await solveForRate(normalizedInput, provider, planet, requestedPerHour);
    if (full.areaUsed <= normalizedInput.availableArea) return toResult(normalizedInput, planet, full, requestedPerHour);

    let low = 0;
    let high = requestedPerHour;
    let best = await solveForRate(normalizedInput, provider, planet, low);
    for (let index = 0; index < 18; index += 1) {
      const mid = (low + high) / 2;
      const candidate = await solveForRate(normalizedInput, provider, planet, mid);
      if (candidate.areaUsed <= normalizedInput.availableArea) {
        low = mid;
        best = candidate;
      } else {
        high = mid;
      }
    }
    const result = toResult(normalizedInput, planet, best, requestedPerHour);
    result.warnings.push("Requested target does not fit in the available area; showing the closest feasible scaled output.");
    return result;
  }

  let high = requestedPerHour ?? DEFAULT_TARGET_PER_HOUR;
  let highSolve = await solveForRate(normalizedInput, provider, planet, high);
  let guard = 0;
  while (highSolve.areaUsed <= normalizedInput.availableArea && high > 0 && guard < 18) {
    high *= 2;
    highSolve = await solveForRate(normalizedInput, provider, planet, high);
    guard += 1;
    if (highSolve.areaUsed === 0 && guard > 8) break;
  }

  let low = 0;
  let best = await solveForRate(normalizedInput, provider, planet, requestedPerHour ?? DEFAULT_TARGET_PER_HOUR);
  if (best.areaUsed > normalizedInput.availableArea) best = await solveForRate(normalizedInput, provider, planet, 0);

  for (let index = 0; index < 20; index += 1) {
    const mid = (low + high) / 2;
    const candidate = await solveForRate(normalizedInput, provider, planet, mid);
    if (candidate.areaUsed <= normalizedInput.availableArea) {
      low = mid;
      best = candidate;
    } else {
      high = mid;
    }
  }

  if (best.areaUsed === 0 && best.ratePerHour > 0) {
    best.warnings.push("The optimizer could not bind output to area because recipe/building area data was missing; the displayed output is capped by the search guard.");
  }

  return toResult(normalizedInput, planet, best, requestedPerHour);
}
