export type PopulationClass = "pioneers" | "settlers" | "technicians" | "engineers" | "scientists";

export type PopulationCounts = Record<PopulationClass, number>;

export type MaterialInfo = {
  id: string | null;
  ticker: string;
  name: string | null;
  categoryName: string | null;
  weight: number | null;
  volume: number | null;
};

export type CommodityAmount = {
  ticker: string;
  name: string | null;
  amount: number;
  weight: number | null;
  volume: number | null;
};

export type RecipeCandidate = {
  id: string;
  label: string;
  buildingTicker: string | null;
  recipeName: string | null;
  standardRecipeName: string | null;
  durationMs: number;
  batchHours: number;
  outputTicker: string;
  outputAmount: number;
  inputs: CommodityAmount[];
  outputs: CommodityAmount[];
};

export type PlanetResource = {
  materialId: string;
  ticker: string | null;
  name: string | null;
  resourceType: string | null;
  factor: number | null;
};

export type PlanetInfo = {
  id: string | null;
  naturalId: string;
  name: string;
  systemId: string | null;
  resources: PlanetResource[];
  gravity: number | null;
  pressure: number | null;
  temperature: number | null;
  fertility: number | null;
  surface: boolean | null;
  hasLocalMarket: boolean | null;
};

export type BuildingInfo = {
  code: string;
  name: string;
  areaCost: number | null;
  slots: number | null;
  workforce: PopulationCounts;
  recipeLines: Array<{ materialTicker: string; quantity: number }>;
};

export type WorkforceNeed = {
  workforceType: PopulationClass;
  materialTicker: string;
  materialName: string;
  amountPer100Daily: number;
  isLuxury: boolean;
};

export interface ProsperousProvider {
  getAllMaterials(): Promise<MaterialInfo[]>;
  getMaterialByTicker(ticker: string): Promise<MaterialInfo | null>;
  searchMaterials(query: string): Promise<MaterialInfo[]>;
  getAllBuildings(): Promise<BuildingInfo[]>;
  getBuildingByCode(code: string): Promise<BuildingInfo | null>;
  searchBuildings(query: string): Promise<BuildingInfo[]>;
  getBuildingBom(buildingCode: string): Promise<BuildingInfo["recipeLines"] | null>;
  getRecipesForProduct(productTicker: string): Promise<RecipeCandidate[]>;
  getRecipeVariants(productTicker: string): Promise<RecipeCandidate[]>;
  getPlanetByIdOrCode(planetCode: string): Promise<PlanetInfo | null>;
  getPlanetResources(planetCode: string): Promise<PlanetResource[]>;
  getWorkforceNeeds(): Promise<{ needs: WorkforceNeed[]; source: "provider" | "fallback" }>;
  getBuildingWorkforceRequirements(buildingCode: string): Promise<PopulationCounts | null>;
  getBuildingArea(buildingCode: string): Promise<number | null>;
}
