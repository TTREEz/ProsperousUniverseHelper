import type {
  BatchInfo,
  Factory,
  NeedToBuy,
  Produced,
  RecipeInfo,
  TradeRoute,
  WorkforceConsumption,
} from "@/schema/types";

/**
 * Per-planet production maths, ported from the original planner.
 *
 * The chain is: what each produced line actually outputs per hour, what that
 * output demands as ingredients, and then everything a planet makes and burns
 * in one balance — including trade routes, so a material arriving from another
 * planet is not also listed as something to buy.
 */

/** A production order can queue at most this many batches in one slot. */
const MAX_ORDER_SIZE_PER_SLOT = 20;
const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK = 168;

function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function key(value: string): string {
  return value.trim().toUpperCase();
}

export type ProductionInputs = {
  batchInfos: BatchInfo[];
  factories: Factory[];
  produced: Produced[];
  recipeInfos: RecipeInfo[];
  workforceConsumption: WorkforceConsumption[];
  needToBuy: NeedToBuy[];
  incomingTradeRoutes: TradeRoute[];
  outgoingTradeRoutes: TradeRoute[];
};

/** Each building is one production slot, so two farms give two farm slots. */
function slotsOf(factory: Factory): number {
  return factory.count;
}

export type ProducedRow = {
  id: string;
  name: string;
  amount: number;
  factoryId: string | null;
  batchQty: number;
  batchHours100: number;
  /** Batch time adjusted for the factory's efficiency. */
  currentBatchHours: number;
  effectiveSlots: number;
  totalHours: number;
  outputPerHour: number;
  outputPerWeek: number;
  /** Output above the requested amount, caused by whole-batch rounding. */
  overbuild: number;
};

export type RecipeRow = {
  id: string;
  product: string;
  ingredient: string;
  qtyPerProductBatch: number;
  ingredientDemandPerHour: number;
};

export type BalanceRow = {
  resource: string;
  producedPerHour: number;
  recipeConsumedPerHour: number;
  workforceConsumedPerHour: number;
  incomingPerHour: number;
  outgoingPerHour: number;
  totalConsumedPerHour: number;
  /** Before trade routes: what this planet makes and burns on its own. */
  localNetPerHour: number;
  /** After trade routes. Negative means it has to come from somewhere. */
  netPerHour: number;
  importPerDay: number;
  importPerWeek: number;
};

export type NeedToBuyRow = {
  resource: string;
  netPerHour: number;
  importPerDay: number;
  importPerWeek: number;
  manualExtraPerDay: number;
  totalImportPerDay: number;
  totalImportPerWeek: number;
  reason: string;
  notes: string | null;
};

export type ProductionPlan = {
  produced: ProducedRow[];
  recipes: RecipeRow[];
  balance: BalanceRow[];
  needToBuy: NeedToBuyRow[];
  warnings: string[];
};

function calculateProduced(inputs: ProductionInputs, warnings: Set<string>): ProducedRow[] {
  const batchByName = new Map(inputs.batchInfos.map((row) => [key(row.name), row]));
  const factoryById = new Map(inputs.factories.map((row) => [row.id, row]));

  // Lines without an explicit slot allocation share whatever slots are left.
  const allocatedByFactory = new Map<string, number>();
  const unallocatedByFactory = new Map<string, number>();

  for (const row of inputs.produced) {
    if (!row.factoryId || !row.name.trim() || row.amount <= 0) continue;
    if (row.allocatedSlots !== null) {
      allocatedByFactory.set(row.factoryId, (allocatedByFactory.get(row.factoryId) ?? 0) + row.allocatedSlots);
    } else {
      unallocatedByFactory.set(row.factoryId, (unallocatedByFactory.get(row.factoryId) ?? 0) + 1);
    }
  }

  for (const [factoryId, allocated] of allocatedByFactory) {
    const factory = factoryById.get(factoryId);
    if (!factory) continue;
    const available = slotsOf(factory);
    if (allocated > available) {
      warnings.add(
        `Slot allocations on ${factory.buildingCode} add up to ${allocated}, more than the ${available} slots it has.`,
      );
    }
  }

  return inputs.produced.map((row) => {
    const batch = batchByName.get(key(row.name));
    const factory = row.factoryId ? factoryById.get(row.factoryId) : undefined;

    if (row.name.trim() && !batch) {
      warnings.add(`${row.name} has no batch info on this planet, so its output cannot be worked out.`);
    }
    if (row.name.trim() && row.factoryId && !factory) {
      warnings.add(`${row.name} points at a building that is no longer here.`);
    }

    const batchQty = batch?.batchQty ?? 0;
    const batchHours100 = batch?.knownBatchHours ?? 0;
    const efficiency = factory?.efficiency ?? 0;
    const availableSlots = factory ? slotsOf(factory) : 0;
    const explicitlyAllocated = row.factoryId ? allocatedByFactory.get(row.factoryId) ?? 0 : 0;
    const sharing = row.factoryId ? unallocatedByFactory.get(row.factoryId) ?? 0 : 0;
    const sharedSlots = Math.max(0, availableSlots - explicitlyAllocated);

    const effectiveSlots =
      row.amount <= 0
        ? 0
        : row.allocatedSlots !== null
          ? row.allocatedSlots
          : sharing > 0
            ? safeDiv(sharedSlots, sharing)
            : 0;

    const currentBatchHours = safeDiv(batchHours100, efficiency);
    const maxOutputPerOrder = batchQty * MAX_ORDER_SIZE_PER_SLOT;
    const maxOrderHours = currentBatchHours * MAX_ORDER_SIZE_PER_SLOT;

    // An order runs a whole number of batches, so a part-full final order still
    // costs the time of every batch it contains.
    const fullOrders = row.amount > 0 && maxOutputPerOrder > 0 ? Math.floor(row.amount / maxOutputPerOrder) : 0;
    const remainder = maxOutputPerOrder > 0 ? row.amount % maxOutputPerOrder : 0;
    const finalOrderBatches =
      remainder > 0 && batchQty > 0
        ? Math.max(1, Math.min(MAX_ORDER_SIZE_PER_SLOT, Math.ceil(remainder / batchQty)))
        : 0;

    const totalHours =
      row.amount > 0 ? fullOrders * maxOrderHours + finalOrderBatches * currentBatchHours : 0;
    const outputPerHour = totalHours > 0 ? safeDiv(row.amount, totalHours) * effectiveSlots : 0;
    const plannedOutput =
      row.amount > 0 ? fullOrders * maxOutputPerOrder + finalOrderBatches * batchQty : 0;

    return {
      id: row.id,
      name: row.name,
      amount: row.amount,
      factoryId: row.factoryId,
      batchQty,
      batchHours100,
      currentBatchHours,
      effectiveSlots,
      totalHours,
      outputPerHour,
      outputPerWeek: outputPerHour * HOURS_PER_WEEK,
      overbuild: Math.max(0, plannedOutput - row.amount),
    };
  });
}

function calculateRecipes(inputs: ProductionInputs, produced: ProducedRow[], warnings: Set<string>): RecipeRow[] {
  const batchByName = new Map(inputs.batchInfos.map((row) => [key(row.name), row]));

  const outputByProduct = new Map<string, number>();
  for (const row of produced) {
    outputByProduct.set(key(row.name), (outputByProduct.get(key(row.name)) ?? 0) + row.outputPerHour);
  }

  // Only recipes for something actually being produced create demand.
  return inputs.recipeInfos
    .filter((row) => (outputByProduct.get(key(row.product)) ?? 0) > 0)
    .map((row) => {
      const batch = batchByName.get(key(row.product));
      if (!batch) warnings.add(`Recipe for ${row.product} has no batch info, so its ingredient demand is unknown.`);

      const productBatchQty = batch?.batchQty ?? 0;
      const productOutputPerHour = outputByProduct.get(key(row.product)) ?? 0;

      return {
        id: row.id,
        product: row.product,
        ingredient: row.ingredient,
        qtyPerProductBatch: row.qtyPerProductBatch,
        ingredientDemandPerHour:
          productBatchQty > 0 ? (productOutputPerHour / productBatchQty) * row.qtyPerProductBatch : 0,
      };
    });
}

function calculateBalance(inputs: ProductionInputs, produced: ProducedRow[], recipes: RecipeRow[]): BalanceRow[] {
  const resources = new Set<string>();
  const add = (map: Map<string, number>, name: string, amount: number) => {
    const k = key(name);
    if (!k) return;
    resources.add(k);
    map.set(k, (map.get(k) ?? 0) + amount);
  };

  const producedBy = new Map<string, number>();
  for (const row of produced) if (row.name.trim()) add(producedBy, row.name, row.outputPerHour);

  const recipeBy = new Map<string, number>();
  for (const row of recipes) add(recipeBy, row.ingredient, row.ingredientDemandPerHour);

  const workforceBy = new Map<string, number>();
  for (const row of inputs.workforceConsumption) add(workforceBy, row.resource, row.dailyConsumption / HOURS_PER_DAY);

  const incomingBy = new Map<string, number>();
  for (const row of inputs.incomingTradeRoutes) {
    if (row.enabled) add(incomingBy, row.resource, row.amountPerWeek / HOURS_PER_WEEK);
  }

  const outgoingBy = new Map<string, number>();
  for (const row of inputs.outgoingTradeRoutes) {
    if (row.enabled) add(outgoingBy, row.resource, row.amountPerWeek / HOURS_PER_WEEK);
  }

  return [...resources]
    .map((resource) => {
      const producedPerHour = producedBy.get(resource) ?? 0;
      const recipeConsumedPerHour = recipeBy.get(resource) ?? 0;
      const workforceConsumedPerHour = workforceBy.get(resource) ?? 0;
      const incomingPerHour = incomingBy.get(resource) ?? 0;
      const outgoingPerHour = outgoingBy.get(resource) ?? 0;
      const totalConsumedPerHour = recipeConsumedPerHour + workforceConsumedPerHour;
      const netPerHour = producedPerHour + incomingPerHour - totalConsumedPerHour - outgoingPerHour;

      return {
        resource,
        producedPerHour,
        recipeConsumedPerHour,
        workforceConsumedPerHour,
        incomingPerHour,
        outgoingPerHour,
        totalConsumedPerHour,
        localNetPerHour: producedPerHour - totalConsumedPerHour,
        netPerHour,
        importPerDay: Math.max(0, -netPerHour * HOURS_PER_DAY),
        importPerWeek: Math.max(0, -netPerHour * HOURS_PER_WEEK),
      };
    })
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

function reasonFor(row: BalanceRow): string {
  const helped = row.incomingPerHour > 0 ? " even after what arrives by trade route" : "";
  if (row.recipeConsumedPerHour > 0 && row.workforceConsumedPerHour > 0) {
    return `Production and workforce together need more than this planet makes${helped}`;
  }
  if (row.workforceConsumedPerHour > 0) return `Workforce needs more than this planet makes${helped}`;
  if (row.recipeConsumedPerHour > 0) return `Production needs more than this planet makes${helped}`;
  return `More goes out than comes in${helped}`;
}

function calculateNeedToBuy(inputs: ProductionInputs, balance: BalanceRow[]): NeedToBuyRow[] {
  const overrides = new Map(inputs.needToBuy.map((row) => [key(row.resource), row]));

  return balance
    .filter((row) => row.importPerWeek > 0)
    .map((row) => {
      const override = overrides.get(row.resource);
      const manualExtraPerDay = override?.manualExtraPerDay ?? 0;

      return {
        resource: row.resource,
        netPerHour: row.netPerHour,
        importPerDay: row.importPerDay,
        importPerWeek: row.importPerWeek,
        manualExtraPerDay,
        totalImportPerDay: row.importPerDay + manualExtraPerDay,
        totalImportPerWeek: row.importPerWeek + manualExtraPerDay * 7,
        reason: reasonFor(row),
        notes: override?.notes ?? null,
      };
    })
    .sort((a, b) => b.totalImportPerWeek - a.totalImportPerWeek);
}

export function calculateProduction(inputs: ProductionInputs): ProductionPlan {
  const warnings = new Set<string>();
  const produced = calculateProduced(inputs, warnings);
  const recipes = calculateRecipes(inputs, produced, warnings);
  const balance = calculateBalance(inputs, produced, recipes);
  const needToBuy = calculateNeedToBuy(inputs, balance);

  return { produced, recipes, balance, needToBuy, warnings: [...warnings] };
}
