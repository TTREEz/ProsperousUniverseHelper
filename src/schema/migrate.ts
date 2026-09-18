import { SCHEMA_VERSION, type PuDataFile } from "@/schema/types";
import { parseDataFile } from "@/schema/validate";

/**
 * Upgrades an older save file to the current schema, one version step at a
 * time. Each entry migrates FROM its key version TO the next one.
 *
 * Adding a field with a sensible default needs no migration: the zod schema
 * fills it in on load. Write one here only for changes that move or reinterpret
 * existing data.
 */
const steps: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {
  /**
   * Factories were a free-typed name with a hand-entered slot count. They are
   * now keyed by FIO building code with a building count, so a shopping list
   * can tell what is already built. The old name was in practice either the
   * building code or a label starting with one, so it is the best available
   * source for the code.
   */
  1: (file) => {
    for (const scenario of asArray(file.scenarios)) {
      for (const planet of asArray(scenario.planets)) {
        planet.factories = asArray(planet.factories).map((factory) => ({
          id: factory.id,
          buildingCode: String(factory.buildingCode ?? factory.name ?? "").trim().toUpperCase(),
          count: typeof factory.count === "number" ? factory.count : Number(factory.slots) || 1,
          efficiency: typeof factory.efficiency === "number" ? factory.efficiency : 1,
          notes: factory.notes ?? null,
        }));
      }
      for (const pkg of asArray(scenario.expansionPackages)) {
        pkg.deductExistingBuildings = pkg.deductExistingBuildings ?? false;
      }
    }
    return file;
  },
};

function asArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? (value as Array<Record<string, any>>) : [];
}

export type LoadResult =
  | { ok: true; data: PuDataFile; migratedFrom: number | null }
  | { ok: false; error: string };

export function loadAndMigrate(raw: unknown): LoadResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "File is not a JSON object." };
  }

  const record = raw as Record<string, unknown>;
  const incoming = typeof record.schemaVersion === "number" ? record.schemaVersion : null;

  if (incoming === null) {
    return { ok: false, error: "File is missing schemaVersion — not a PU Toolset save file." };
  }
  if (incoming > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `File was written by a newer version of PU Toolset (schema ${incoming}, this app reads up to ${SCHEMA_VERSION}). Update the app to open it.`,
    };
  }

  let working = record;
  for (let version = incoming; version < SCHEMA_VERSION; version += 1) {
    const step = steps[version];
    if (!step) {
      return { ok: false, error: `No migration path from schema version ${version}.` };
    }
    working = step(working);
    working.schemaVersion = version + 1;
  }

  const parsed = parseDataFile(working);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return { ok: true, data: parsed.data, migratedFrom: incoming < SCHEMA_VERSION ? incoming : null };
}
