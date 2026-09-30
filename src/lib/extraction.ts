/**
 * How much a planet yields from its own resources.
 *
 * A resource's "factor" is a concentration, not an amount, and on its own tells
 * you nothing you can plan with. What matters is the units one extraction
 * building pulls in a day at full efficiency, which is the factor times a rate
 * fixed per resource type.
 *
 * Checked against Katoa: 0.21 liquid, 0.28 and 0.11 gaseous, 0.23 mineral give
 * 15 H2O, 17 O, 7 AMM and 16 GAL, matching the game.
 */

export const EXTRACTION_BUILDING_BY_RESOURCE_TYPE: Record<string, string> = {
  GASEOUS: "COL",
  GAS: "COL",
  LIQUID: "RIG",
  MINERAL: "EXT",
  ORE: "EXT",
};

export const EXTRACTION_DAILY_MULTIPLIER_BY_RESOURCE_TYPE: Record<string, number> = {
  GASEOUS: 60,
  GAS: 60,
  LIQUID: 70,
  MINERAL: 70,
  ORE: 70,
};

export function normalizeResourceType(resourceType: string | null | undefined): string {
  return (resourceType ?? "").trim().toUpperCase();
}

export function extractionBuildingFor(resourceType: string | null | undefined): string | null {
  return EXTRACTION_BUILDING_BY_RESOURCE_TYPE[normalizeResourceType(resourceType)] ?? null;
}

/** Units one extraction building pulls per day at 100% efficiency. */
export function extractionPerDay(resourceType: string | null | undefined, factor: number | null): number | null {
  const multiplier = EXTRACTION_DAILY_MULTIPLIER_BY_RESOURCE_TYPE[normalizeResourceType(resourceType)] ?? null;
  if (!multiplier || factor === null || factor <= 0) return null;
  return Math.round(factor * multiplier);
}
