import { newId } from "@/schema/defaults";
import type { Planet } from "@/schema/types";

/**
 * Everything a recipe determines about producing something on a planet.
 *
 * Extraction is expressed the same way: a day's yield as the batch, over 24
 * hours, with no inputs.
 */
export type RecipeChoice = {
  id: string | null;
  label: string | null;
  batchQty: number;
  batchHours: number;
  inputs: Array<{ ticker: string; amount: number }>;
  buildingCode: string | null;
};

/**
 * Writes a recipe choice onto a planet: batch size and time, and the
 * ingredients that recipe consumes.
 *
 * A product's ingredient rows belong to whichever recipe makes it, so they are
 * replaced rather than added to — otherwise switching recipe would leave the
 * previous one's ingredients behind and quietly overstate demand. Rows for
 * other products are untouched.
 */
export function applyRecipeToPlanet(planet: Planet, product: string, choice: RecipeChoice): void {
  const name = product.trim().toUpperCase();
  if (!name) return;

  const existing = planet.batchInfos.find((row) => row.name.toUpperCase() === name);
  if (existing) {
    existing.batchQty = choice.batchQty;
    existing.knownBatchHours = choice.batchHours;
    existing.recipeId = choice.id;
    existing.recipeLabel = choice.label;
  } else {
    planet.batchInfos.push({
      id: newId(),
      name,
      batchQty: choice.batchQty,
      knownBatchHours: choice.batchHours,
      knownEff: 1,
      recipeId: choice.id,
      recipeLabel: choice.label,
      notes: null,
    });
  }

  planet.recipeInfos = [
    ...planet.recipeInfos.filter((row) => row.product.trim().toUpperCase() !== name),
    ...choice.inputs
      .filter((input) => input.ticker.trim() && input.amount > 0)
      .map((input) => ({
        id: newId(),
        product: name,
        ingredient: input.ticker.trim().toUpperCase(),
        qtyPerProductBatch: input.amount,
      })),
  ];
}
