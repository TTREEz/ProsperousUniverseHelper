import type { ExpansionChecklistItem, ExpansionPackageAdjustment, ExpansionPackageItem } from "@/schema/types";
import type { PlanetInfo, ProsperousProvider } from "@/provider/types";

/**
 * Turns a material package into a shopping list.
 *
 * Pipeline: package entries -> required materials -> what you already cover ->
 * what is actually left to buy. A building entry expands into its bill of
 * materials plus the extra materials the destination planet's environment
 * demands, which is why the target planet matters to the answer.
 */

export type RequirementSource = "Direct material" | "Building BOM" | "Environmental";

export type ShoppingRow = {
  ticker: string;
  name: string;
  requiredQty: number;
  /** Human-readable trace of where the requirement came from. */
  sources: string[];
  sourceKinds: RequirementSource[];
  adjustment: number;
  remainingToBuy: number;
  acquiredQuantity: number;
  remainingUnacquired: number;
  checkedComplete: boolean;
  weightPerUnit: number | null;
  volumePerUnit: number | null;
  totalWeight: number | null;
  totalVolume: number | null;
  missingMetadata: boolean;
};

export type MaterialPlan = {
  rows: ShoppingRow[];
  warnings: string[];
  totals: {
    distinctMaterials: number;
    unitsToBuy: number;
    weight: number | null;
    volume: number | null;
  };
};

export type PackageInput = {
  items: ExpansionPackageItem[];
  adjustments: ExpansionPackageAdjustment[];
  checklist: ExpansionChecklistItem[];
  /** FIO natural id or name. Drives the environmental construction costs. */
  targetPlanetCode: string | null;
};

/**
 * Extra materials a building needs because of where it is being built.
 *
 * These are game rules rather than anything the API reports per building, so
 * they are encoded here. Quantities scale with the building's area except where
 * the game charges a flat unit.
 */
function environmentalLines(
  areaCost: number | null,
  planet: PlanetInfo | null,
): Array<{ ticker: string; quantityPerBuilding: number; label: string }> {
  if (areaCost === null || areaCost <= 0 || !planet) return [];

  const lines: Array<{ ticker: string; quantityPerBuilding: number; label: string }> = [];

  if (planet.surface === true) {
    lines.push({ ticker: "MCG", quantityPerBuilding: areaCost * 4, label: "rocky planet area cost" });
  } else if (planet.surface === false) {
    lines.push({ ticker: "AEF", quantityPerBuilding: areaCost / 3, label: "gaseous planet area cost" });
  }

  if (planet.pressure !== null && planet.pressure < 0.25) {
    lines.push({ ticker: "SEA", quantityPerBuilding: areaCost, label: "low pressure" });
  }
  if (planet.pressure !== null && planet.pressure > 2) {
    lines.push({ ticker: "HSE", quantityPerBuilding: 1, label: "high pressure" });
  }
  if (planet.gravity !== null && planet.gravity < 0.25) {
    lines.push({ ticker: "MGC", quantityPerBuilding: 1, label: "low gravity" });
  }
  if (planet.gravity !== null && planet.gravity > 2.5) {
    lines.push({ ticker: "BL", quantityPerBuilding: 1, label: "high gravity" });
  }
  if (planet.temperature !== null && planet.temperature < -25) {
    lines.push({ ticker: "INS", quantityPerBuilding: areaCost * 10, label: "low temperature" });
  }
  if (planet.temperature !== null && planet.temperature > 75) {
    lines.push({ ticker: "TSH", quantityPerBuilding: 1, label: "high temperature" });
  }

  return lines;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
}

type Draft = {
  ticker: string;
  name: string;
  requiredQty: number;
  sources: string[];
  sourceKinds: Set<RequirementSource>;
  weightPerUnit: number | null;
  volumePerUnit: number | null;
  missingMetadata: boolean;
};

export async function derivePackagePlan(input: PackageInput, provider: ProsperousProvider): Promise<MaterialPlan> {
  const drafts = new Map<string, Draft>();
  const warnings: string[] = [];

  const planet = input.targetPlanetCode
    ? await provider.getPlanetByIdOrCode(input.targetPlanetCode).catch(() => null)
    : null;

  if (input.targetPlanetCode && !planet) {
    warnings.push(
      `Could not resolve target planet "${input.targetPlanetCode}", so environmental construction materials are not included.`,
    );
  }
  if (!input.targetPlanetCode && input.items.some((item) => item.itemType === "BUILDING")) {
    warnings.push("No target planet set — environmental construction materials (MCG, AEF, SEA…) are not included.");
  }

  const add = async (ticker: string, qty: number, source: string, kind: RequirementSource) => {
    const key = ticker.trim().toUpperCase();
    if (!key || qty <= 0) return;

    let draft = drafts.get(key);
    if (!draft) {
      const material = await provider.getMaterialByTicker(key).catch(() => null);
      draft = {
        ticker: key,
        name: material?.name ?? key,
        requiredQty: 0,
        sources: [],
        sourceKinds: new Set(),
        weightPerUnit: material?.weight ?? null,
        volumePerUnit: material?.volume ?? null,
        missingMetadata: material === null,
      };
      drafts.set(key, draft);
    }

    draft.requiredQty += qty;
    draft.sources.push(source);
    draft.sourceKinds.add(kind);
  };

  for (const item of input.items) {
    const code = item.itemCode.trim().toUpperCase();
    if (!code || item.quantity <= 0) continue;

    if (item.itemType === "MATERIAL") {
      await add(code, item.quantity, `${formatQty(item.quantity)} × ${code} (direct)`, "Direct material");
      continue;
    }

    const building = await provider.getBuildingByCode(code).catch(() => null);
    if (!building) {
      warnings.push(`Building "${code}" was not found, so its materials are missing from this list.`);
      continue;
    }

    const bom = building.recipeLines.length > 0 ? building.recipeLines : await provider.getBuildingBom(code).catch(() => null);
    if (!bom || bom.length === 0) {
      warnings.push(`No construction materials are published for ${code}, so only its environmental costs are counted.`);
    } else {
      for (const line of bom) {
        await add(
          line.materialTicker,
          line.quantity * item.quantity,
          `${item.quantity} × ${code} build cost`,
          "Building BOM",
        );
      }
    }

    for (const line of environmentalLines(building.areaCost, planet)) {
      await add(
        line.ticker,
        line.quantityPerBuilding * item.quantity,
        `${item.quantity} × ${code} (${line.label})`,
        "Environmental",
      );
    }
  }

  const adjustmentByTicker = new Map<string, number>();
  for (const adjustment of input.adjustments) {
    const key = adjustment.materialTicker.trim().toUpperCase();
    adjustmentByTicker.set(key, (adjustmentByTicker.get(key) ?? 0) + adjustment.quantityDelta);
  }

  const checklistByTicker = new Map(
    input.checklist.map((entry) => [entry.materialTicker.trim().toUpperCase(), entry]),
  );

  const rows: ShoppingRow[] = [...drafts.values()]
    .map((draft) => {
      const adjustment = adjustmentByTicker.get(draft.ticker) ?? 0;
      const remainingToBuy = Math.max(0, draft.requiredQty + adjustment);
      const checklistEntry = checklistByTicker.get(draft.ticker);
      const acquiredQuantity = checklistEntry?.acquiredQuantity ?? 0;

      return {
        ticker: draft.ticker,
        name: draft.name,
        requiredQty: draft.requiredQty,
        sources: draft.sources,
        sourceKinds: [...draft.sourceKinds],
        adjustment,
        remainingToBuy,
        acquiredQuantity,
        remainingUnacquired: Math.max(0, remainingToBuy - acquiredQuantity),
        checkedComplete: checklistEntry?.checkedComplete ?? false,
        weightPerUnit: draft.weightPerUnit,
        volumePerUnit: draft.volumePerUnit,
        totalWeight: draft.weightPerUnit === null ? null : draft.weightPerUnit * remainingToBuy,
        totalVolume: draft.volumePerUnit === null ? null : draft.volumePerUnit * remainingToBuy,
        missingMetadata: draft.missingMetadata,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const withWeight = rows.filter((row) => row.totalWeight !== null);
  const withVolume = rows.filter((row) => row.totalVolume !== null);

  return {
    rows,
    warnings,
    totals: {
      distinctMaterials: rows.length,
      unitsToBuy: rows.reduce((sum, row) => sum + row.remainingToBuy, 0),
      weight: withWeight.length ? withWeight.reduce((sum, row) => sum + (row.totalWeight ?? 0), 0) : null,
      volume: withVolume.length ? withVolume.reduce((sum, row) => sum + (row.totalVolume ?? 0), 0) : null,
    },
  };
}
