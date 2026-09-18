import { cachedFetch } from "@/provider/cache";
import { formatNumber, normalizeTicker, titleize } from "@/lib/formats";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  normalizeCommodity,
  parseCsvRecords,
  pickField,
} from "@/provider/parse";
import type {
  BuildingInfo,
  MaterialInfo,
  PlanetInfo,
  PlanetResource,
  PopulationClass,
  ProsperousProvider,
  RecipeCandidate,
  SystemInfo,
  SystemPlanet,
  WorkforceNeed,
} from "@/provider/types";

const DEFAULT_BASE_URL = "https://rest.fnar.net";

const workforceTypeMap: Record<string, PopulationClass> = {
  PIONEER: "pioneers",
  SETTLER: "settlers",
  TECHNICIAN: "technicians",
  ENGINEER: "engineers",
  SCIENTIST: "scientists",
};

const fallbackWorkforceNeeds: WorkforceNeed[] = [
  { workforceType: "pioneers", materialTicker: "RAT", materialName: "Rations", amountPer100Daily: 4, isLuxury: false },
  { workforceType: "pioneers", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 4, isLuxury: false },
  { workforceType: "settlers", materialTicker: "RAT", materialName: "Rations", amountPer100Daily: 6, isLuxury: false },
  { workforceType: "settlers", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 5, isLuxury: false },
  { workforceType: "technicians", materialTicker: "RAT", materialName: "Rations", amountPer100Daily: 7, isLuxury: false },
  { workforceType: "technicians", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 7.5, isLuxury: false },
  { workforceType: "engineers", materialTicker: "FIM", materialName: "Engineer Food", amountPer100Daily: 7, isLuxury: false },
  { workforceType: "engineers", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 10, isLuxury: false },
  { workforceType: "scientists", materialTicker: "MEA", materialName: "Scientist Food", amountPer100Daily: 7, isLuxury: false },
  { workforceType: "scientists", materialTicker: "DW", materialName: "Drinking Water", amountPer100Daily: 10, isLuxury: false },
];

function recipeId(recipe: Omit<RecipeCandidate, "id" | "label">) {
  const inputs = recipe.inputs.map((input) => `${input.ticker}:${input.amount}`).sort().join(",");
  return [recipe.buildingTicker ?? "", recipe.recipeName ?? "", recipe.durationMs, recipe.outputAmount, inputs].join("|");
}

function recipeLabel(recipe: Pick<RecipeCandidate, "buildingTicker" | "outputAmount" | "outputTicker" | "batchHours" | "inputs">) {
  const inputs = recipe.inputs.map((input) => `${formatNumber(input.amount, 3)} ${input.ticker}`).join(" + ") || "no inputs";
  return `${recipe.buildingTicker ?? "Unknown"}: ${formatNumber(recipe.outputAmount, 3)} ${recipe.outputTicker} / ${formatNumber(recipe.batchHours, 3)}h from ${inputs}`;
}

async function firstSuccessful<T>(attempts: Array<() => Promise<T>>): Promise<T | null> {
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch {
      // Endpoint variants differ between FIO/FNAR versions. Try the next known shape.
    }
  }
  return null;
}

export class FioProvider implements ProsperousProvider {
  private readonly baseUrl: string;
  private materialsCache: Promise<MaterialInfo[]> | null = null;
  private buildingsCache: Promise<BuildingInfo[]> | null = null;
  private readonly materialCache = new Map<string, Promise<MaterialInfo | null>>();
  private readonly buildingCache = new Map<string, Promise<BuildingInfo | null>>();
  private readonly recipeCache = new Map<string, Promise<RecipeCandidate[]>>();
  private readonly planetCache = new Map<string, Promise<PlanetInfo | null>>();
  private planetIndexCache: Promise<Array<{ naturalId: string; name: string }>> | null = null;
  private systemsCache: Promise<SystemInfo[]> | null = null;

  constructor(baseUrl = import.meta.env.VITE_FIO_REST_BASE_URL ?? DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getAllMaterials() {
    if (!this.materialsCache) {
      this.materialsCache = this.fetchJson("/material/allmaterials")
        .then((json) =>
          asArray(json)
            .map((entry) => this.normalizeMaterial(entry))
            .filter((entry): entry is MaterialInfo => Boolean(entry)),
        )
        .catch(() => []);
    }
    return this.materialsCache;
  }

  async getMaterialByTicker(ticker: string) {
    const key = normalizeTicker(ticker);
    if (!key) return null;
    if (!this.materialCache.has(key)) {
      this.materialCache.set(
        key,
        this.fetchJson(`/material/${encodeURIComponent(key)}`)
          .then((json) => this.normalizeMaterial(json))
          .catch(async () => (await this.getAllMaterials()).find((material) => material.ticker === key) ?? null),
      );
    }
    return this.materialCache.get(key)!;
  }

  async searchMaterials(query: string) {
    const normalized = normalizeTicker(query);
    const materials = await this.getAllMaterials();
    return materials
      .filter((material) => !normalized || material.ticker.includes(normalized) || (material.name ?? "").toUpperCase().includes(normalized))
      .slice(0, 40);
  }

  async getAllBuildings() {
    if (!this.buildingsCache) {
      this.buildingsCache = firstSuccessful([
        async () => {
          const csv = await this.fetchText("/csv/buildings");
          return parseCsvRecords(csv).map((row) => this.normalizeBuilding(row)).filter((entry): entry is BuildingInfo => Boolean(entry));
        },
        async () => {
          const json = await this.fetchJson("/building/full");
          return asArray(json).map((row) => this.normalizeBuilding(row)).filter((entry): entry is BuildingInfo => Boolean(entry));
        },
        async () => {
          const json = await this.fetchJson("/building/all");
          return asArray(json).map((row) => this.normalizeBuilding(row)).filter((entry): entry is BuildingInfo => Boolean(entry));
        },
      ]).then((rows) => {
        const deduped = new Map<string, BuildingInfo>();
        for (const row of rows ?? []) deduped.set(row.code, row);
        return [...deduped.values()].sort((a, b) => a.code.localeCompare(b.code));
      });
    }
    return this.buildingsCache;
  }

  async getBuildingByCode(code: string) {
    const key = normalizeTicker(code);
    if (!key) return null;
    if (!this.buildingCache.has(key)) {
      this.buildingCache.set(
        key,
        firstSuccessful([
          async () => this.normalizeBuilding(await this.fetchJson(`/building/${encodeURIComponent(key)}`)),
          async () => this.normalizeBuilding(await this.fetchJson(`/building/${encodeURIComponent(key)}/full`)),
          async () => (await this.getAllBuildings()).find((building) => building.code === key) ?? null,
        ]),
      );
    }
    return this.buildingCache.get(key)!;
  }

  async searchBuildings(query: string) {
    const normalized = normalizeTicker(query);
    const buildings = await this.getAllBuildings();
    return buildings
      .filter((building) => !normalized || building.code.includes(normalized) || building.name.toUpperCase().includes(normalized))
      .slice(0, 40);
  }

  async getBuildingBom(buildingCode: string) {
    const building = await this.getBuildingByCode(buildingCode);
    return building?.recipeLines ?? null;
  }

  async getRecipesForProduct(productTicker: string) {
    const key = normalizeTicker(productTicker);
    if (!key) return [];
    if (!this.recipeCache.has(key)) {
      this.recipeCache.set(
        key,
        this.fetchJson(`/recipes/${encodeURIComponent(key)}`)
          .then((json) =>
            asArray(json)
              .map((entry) => this.normalizeRecipe(entry, key))
              .filter((entry): entry is RecipeCandidate => Boolean(entry))
              .sort((a, b) => a.batchHours - b.batchHours),
          )
          .catch(() => []),
      );
    }
    return this.recipeCache.get(key)!;
  }

  getRecipeVariants(productTicker: string) {
    return this.getRecipesForProduct(productTicker);
  }

  async getPlanetByIdOrCode(planetCode: string) {
    const key = planetCode.trim();
    if (!key) return null;
    const cacheKey = key.toUpperCase();
    if (!this.planetCache.has(cacheKey)) {
      this.planetCache.set(cacheKey, this.fetchPlanet(key));
    }
    return this.planetCache.get(cacheKey)!;
  }

  async getPlanetResources(planetCode: string) {
    return (await this.getPlanetByIdOrCode(planetCode))?.resources ?? [];
  }

  async getWorkforceNeeds(): Promise<{ needs: WorkforceNeed[]; source: "provider" | "fallback" }> {
    try {
      const json = await this.fetchJson("/global/workforceneeds");
      const needs = asArray(json).flatMap((rowValue) => {
        const row = asRecord(rowValue);
        const workforceType = row ? workforceTypeMap[(asString(row.WorkforceType) ?? "").toUpperCase()] : undefined;
        if (!workforceType) return [];
        return asArray(row?.Needs).flatMap((needValue) => {
          const need = asRecord(needValue);
          const ticker = normalizeTicker(asString(need?.MaterialTicker));
          const materialName = asString(need?.MaterialName);
          const amount = asNumber(need?.Amount);
          if (!ticker || amount === null) return [];
          return [
            {
              workforceType,
              materialTicker: ticker,
              materialName: titleize(materialName ?? ticker),
              amountPer100Daily: amount,
              isLuxury: (materialName ?? "").toLowerCase().includes("luxury"),
            },
          ];
        });
      });
      if (needs.length > 0) return { needs, source: "provider" };
    } catch {
      // Keep workforce visible with a warning in the optimizer result.
    }
    return { needs: fallbackWorkforceNeeds, source: "fallback" };
  }

  async getBuildingWorkforceRequirements(buildingCode: string) {
    return (await this.getBuildingByCode(buildingCode))?.workforce ?? null;
  }

  async getBuildingArea(buildingCode: string) {
    return (await this.getBuildingByCode(buildingCode))?.areaCost ?? null;
  }

  /**
   * Finds a system by natural id (OT-580) or name (Moria).
   */
  async getSystem(query: string): Promise<SystemInfo | null> {
    const normalized = query.trim().toUpperCase();
    if (!normalized) return null;

    if (!this.systemsCache) {
      this.systemsCache = this.fetchJson("/systemstars")
        .then((json) =>
          asArray(json)
            .map((entry) => {
              const record = asRecord(entry);
              const naturalId = asString(pickField(record ?? {}, ["NaturalId", "SystemNaturalId"]));
              if (!naturalId) return null;
              return {
                systemId: asString(pickField(record ?? {}, ["SystemId"])),
                naturalId,
                name: asString(pickField(record ?? {}, ["Name"])) ?? naturalId,
              };
            })
            .filter((entry): entry is SystemInfo => Boolean(entry)),
        )
        .catch(() => []);
    }

    const systems = await this.systemsCache;
    return (
      systems.find(
        (system) => system.naturalId.toUpperCase() === normalized || system.name.toUpperCase() === normalized,
      ) ?? null
    );
  }

  /**
   * Every planet in a system.
   *
   * A planet's natural id is its system's natural id plus a letter — OT-580b is
   * the second planet of OT-580 — so the system's planets are the entries with
   * that prefix. FIO has no endpoint that lists them directly, and the one
   * response that carries system ids is 35MB.
   */
  async getSystemPlanets(query: string): Promise<{ system: SystemInfo; planets: SystemPlanet[] } | null> {
    const system = await this.getSystem(query);
    if (!system) return null;

    const prefix = system.naturalId.toUpperCase();
    const planets = (await this.getPlanetIndex())
      .filter((planet) => {
        const id = planet.naturalId.toUpperCase();
        // Guard against OT-58 matching OT-580b: the remainder must be the
        // planet's letter, not more of a longer system id.
        return id.startsWith(prefix) && /^[A-Z]+$/.test(id.slice(prefix.length)) && id.length > prefix.length;
      })
      .sort((a, b) => a.naturalId.localeCompare(b.naturalId));

    return { system, planets };
  }

  private async fetchPlanet(query: string) {
    const materials = await this.getAllMaterials();
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const direct = await this.fetchJson(`/planet/${encodeURIComponent(query)}`)
      .then((json) => this.normalizePlanet(json, materialById))
      .catch(() => null);
    if (direct) return direct;

    // The direct lookup already accepts a natural id or a name, so reaching
    // here usually means a typo. Resolve against the index of every planet —
    // 240kB of ids and names — rather than /planet/allplanets/full, which is
    // 35MB and far too heavy to pull into a browser just to check a spelling.
    const normalized = query.toUpperCase();
    const match = (await this.getPlanetIndex()).find(
      (planet) => planet.naturalId.toUpperCase() === normalized || planet.name.toUpperCase() === normalized,
    );
    if (!match) return null;

    return this.fetchJson(`/planet/${encodeURIComponent(match.naturalId)}`)
      .then((json) => this.normalizePlanet(json, materialById))
      .catch(() => null);
  }

  /** Every planet's natural id and name. Enough to resolve or list, nothing more. */
  private async getPlanetIndex(): Promise<Array<{ naturalId: string; name: string }>> {
    if (!this.planetIndexCache) {
      this.planetIndexCache = this.fetchJson("/planet/allplanets")
        .then((json) =>
          asArray(json)
            .map((entry) => {
              const record = asRecord(entry);
              const naturalId = asString(pickField(record ?? {}, ["PlanetNaturalId", "NaturalId"]));
              if (!naturalId) return null;
              return { naturalId, name: asString(pickField(record ?? {}, ["PlanetName", "Name"])) ?? naturalId };
            })
            .filter((entry): entry is { naturalId: string; name: string } => Boolean(entry)),
        )
        .catch(() => []);
    }
    return this.planetIndexCache;
  }

  private async fetchJson(path: string) {
    return cachedFetch(`json:${this.baseUrl}${path}`, async () => {
      const response = await fetch(`${this.baseUrl}${path}`, { headers: { "Content-Type": "application/json" } });
      if (!response.ok && response.status !== 204) throw new Error(`FIO API error (${response.status}) for ${path}`);
      return response.status === 204 ? null : response.json();
    });
  }

  private async fetchText(path: string) {
    return cachedFetch(`text:${this.baseUrl}${path}`, async () => {
      const response = await fetch(`${this.baseUrl}${path}`, { headers: { "Content-Type": "text/plain" } });
      if (!response.ok && response.status !== 204) throw new Error(`FIO API error (${response.status}) for ${path}`);
      return response.status === 204 ? "" : response.text();
    });
  }

  private normalizeMaterial(value: unknown): MaterialInfo | null {
    const record = asRecord(value);
    if (!record) return null;
    const ticker = asString(pickField(record, ["Ticker", "MaterialTicker", "ticker", "Code", "code"]));
    if (!ticker) return null;
    return {
      id: asString(pickField(record, ["MaterialId", "id"])),
      ticker: normalizeTicker(ticker),
      name: asString(pickField(record, ["Name", "MaterialName", "name"])) ?? normalizeTicker(ticker),
      categoryName: asString(pickField(record, ["CategoryName", "categoryName"])),
      weight: asNumber(pickField(record, ["Weight", "weight"])),
      volume: asNumber(pickField(record, ["Volume", "volume"])),
    };
  }

  private normalizeBuilding(value: unknown): BuildingInfo | null {
    const record = asRecord(value);
    if (!record) return null;
    const code = asString(pickField(record, ["Ticker", "BuildingTicker", "Code", "code", "NaturalId", "BuildingCode"]));
    if (!code) return null;

    const recipeContainers = ["BuildingCosts", "ConstructionCosts", "Materials", "Recipe", "Ingredients"];
    const recipeLines = recipeContainers.flatMap((key) => this.normalizeRecipeLines(record[key]));

    return {
      code: normalizeTicker(code),
      name: titleize(asString(pickField(record, ["Name", "BuildingName", "name"])) ?? code),
      areaCost: asNumber(pickField(record, ["AreaCost", "areaCost", "Area", "area"])),
      slots: asNumber(pickField(record, ["Slots", "slots", "ProductionSlots", "productionSlots", "SlotCount", "slotCount"])),
      workforce: {
        pioneers: asNumber(pickField(record, ["Pioneers", "pioneers"])) ?? 0,
        settlers: asNumber(pickField(record, ["Settlers", "settlers"])) ?? 0,
        technicians: asNumber(pickField(record, ["Technicians", "technicians"])) ?? 0,
        engineers: asNumber(pickField(record, ["Engineers", "engineers"])) ?? 0,
        scientists: asNumber(pickField(record, ["Scientists", "scientists"])) ?? 0,
      },
      recipeLines: this.mergeRecipeLines(recipeLines),
    };
  }

  private normalizeRecipeLines(value: unknown): Array<{ materialTicker: string; quantity: number }> {
    const direct = asArray(value)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .flatMap((row) => {
        const materialTicker = asString(pickField(row, ["CommodityTicker", "MaterialTicker", "Ticker", "Material", "material"]));
        const quantity = asNumber(pickField(row, ["Amount", "Quantity", "Count", "amount", "quantity", "count"]));
        return materialTicker && quantity !== null ? [{ materialTicker: normalizeTicker(materialTicker), quantity }] : [];
      });

    const objectRows = asRecord(value)
      ? Object.entries(asRecord(value)!).flatMap(([materialTicker, quantity]) => {
          const quantityRecord = asRecord(quantity);
          const parsed = asNumber(quantityRecord ? pickField(quantityRecord, ["Amount", "Quantity", "Count", "amount"]) : quantity);
          return materialTicker && parsed !== null ? [{ materialTicker: normalizeTicker(materialTicker), quantity: parsed }] : [];
        })
      : [];

    return [...direct, ...objectRows];
  }

  private mergeRecipeLines(lines: Array<{ materialTicker: string; quantity: number }>) {
    const merged = new Map<string, number>();
    for (const line of lines) merged.set(line.materialTicker, (merged.get(line.materialTicker) ?? 0) + line.quantity);
    return [...merged.entries()].map(([materialTicker, quantity]) => ({ materialTicker, quantity }));
  }

  private normalizePlanet(value: unknown, materialById: Map<string | null, MaterialInfo>): PlanetInfo | null {
    const record = asRecord(value);
    if (!record) return null;
    const naturalId = asString(pickField(record, ["PlanetNaturalId", "NaturalId", "naturalId"]));
    const name = asString(pickField(record, ["PlanetName", "Name", "name"])) ?? naturalId;
    if (!naturalId || !name) return null;

    const resources: PlanetResource[] = asArray(pickField(record, ["Resources", "resources"]))
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((resource) => {
        const materialId = asString(pickField(resource, ["MaterialId", "materialId"])) ?? "";
        const material = materialById.get(materialId) ?? null;
        return {
          materialId,
          ticker: material?.ticker ?? null,
          name: material?.name ?? null,
          resourceType: asString(pickField(resource, ["ResourceType", "resourceType"])),
          factor: asNumber(pickField(resource, ["Factor", "factor"])),
        };
      });

    return {
      id: asString(pickField(record, ["PlanetId", "id"])),
      naturalId: normalizeTicker(naturalId),
      name,
      systemId: asString(pickField(record, ["SystemId", "systemId"])),
      resources,
      gravity: asNumber(pickField(record, ["Gravity", "gravity"])),
      pressure: asNumber(pickField(record, ["Pressure", "pressure"])),
      temperature: asNumber(pickField(record, ["Temperature", "temperature"])),
      fertility: asNumber(pickField(record, ["Fertility", "fertility"])),
      surface: asBoolean(pickField(record, ["Surface", "surface"])),
      hasLocalMarket: asBoolean(pickField(record, ["HasLocalMarket", "hasLocalMarket"])),
    };
  }

  private normalizeRecipe(value: unknown, requestedOutputTicker: string): RecipeCandidate | null {
    const record = asRecord(value);
    if (!record) return null;
    const inputs = asArray(pickField(record, ["Inputs", "inputs"]))
      .map(normalizeCommodity)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeCommodity>> => Boolean(entry));
    const outputs = asArray(pickField(record, ["Outputs", "outputs"]))
      .map(normalizeCommodity)
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizeCommodity>> => Boolean(entry));
    const matchingOutput = outputs.find((output) => output.ticker === requestedOutputTicker);
    const durationMs = asNumber(pickField(record, ["DurationMs", "durationMs", "Duration", "duration"])) ?? 0;
    if (!matchingOutput || durationMs <= 0) return null;

    const base = {
      buildingTicker: asString(pickField(record, ["BuildingTicker", "buildingTicker"])),
      recipeName: asString(pickField(record, ["RecipeName", "recipeName"])),
      standardRecipeName: asString(pickField(record, ["StandardRecipeName", "standardRecipeName"])),
      durationMs,
      batchHours: durationMs / 3_600_000,
      outputTicker: matchingOutput.ticker,
      outputAmount: matchingOutput.amount,
      inputs,
      outputs,
    };

    return {
      ...base,
      id: recipeId(base),
      label: recipeLabel(base),
    };
  }
}

export const prosperousProvider = new FioProvider();
