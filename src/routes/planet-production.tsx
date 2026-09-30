import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, Input, Select } from "@/components/ui";
import { extractionBuildingFor, extractionPerDay } from "@/lib/extraction";
import { formatNumber, formatPercent } from "@/lib/formats";
import { applyRecipeToPlanet, type RecipeChoice } from "@/planner/apply-recipe";
import { calculateProduction, type ProductionPlan } from "@/planner/production";
import {
  POPULATION_CLASSES,
  consumptionFromPopulation,
  emptyPopulation,
  populationFromBuildings,
  totalPopulation,
  type WorkforceLine,
} from "@/planner/workforce";
import { prosperousProvider } from "@/provider/fio-provider";
import type { PlanetResource, PopulationCounts, WorkforceNeed } from "@/provider/types";
import { newId } from "@/schema/defaults";
import type { Planet, Scenario } from "@/schema/types";
import { useAppStore } from "@/store/app-store";

/**
 * The production side of a planet: what it makes, what that needs, and what is
 * left to buy once trade routes are taken into account.
 *
 * These live as sections of the planet screen rather than separate pages —
 * they are all views of the same planet and are read together.
 */

type Section = "production" | "balance" | "buy" | "resources";

/**
 * Every way a product can be made here: its recipes, plus extraction when the
 * planet holds that resource itself.
 */
async function recipeChoicesFor(product: string, planetCode: string | null): Promise<RecipeChoice[]> {
  const choices: RecipeChoice[] = [];

  if (planetCode) {
    const planet = await prosperousProvider.getPlanetByIdOrCode(planetCode).catch(() => null);
    const resource = planet?.resources.find((entry) => entry.ticker?.toUpperCase() === product);
    const perDay = resource ? extractionPerDay(resource.resourceType, resource.factor) : null;
    const building = resource ? extractionBuildingFor(resource.resourceType) : null;

    if (perDay && building) {
      choices.push({
        id: `extract:${building}`,
        label: `${building}: extract ${perDay} ${product} / day`,
        batchQty: perDay,
        batchHours: 24,
        inputs: [],
        buildingCode: building,
      });
    }
  }

  const recipes = await prosperousProvider.getRecipesForProduct(product).catch(() => []);
  for (const recipe of recipes) {
    choices.push({
      id: recipe.id,
      label: recipe.label,
      batchQty: recipe.outputAmount,
      batchHours: recipe.batchHours,
      inputs: recipe.inputs.map((input) => ({ ticker: input.ticker, amount: input.amount })),
      buildingCode: recipe.buildingTicker,
    });
  }

  return choices;
}

/** What the planet itself yields, straight from FIO. */
function ResourcesSection({ planetCode }: { planetCode: string | null }) {
  const [resources, setResources] = useState<PlanetResource[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "missing">("idle");

  useEffect(() => {
    if (!planetCode) {
      setResources(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    prosperousProvider
      .getPlanetByIdOrCode(planetCode)
      .then((planet) => {
        if (cancelled) return;
        if (!planet) {
          setResources(null);
          setStatus("missing");
          return;
        }
        setResources(planet.resources);
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [planetCode]);

  if (!planetCode) {
    return <EmptyState title="No FIO id set">Set the planet's FIO id above to look up what it yields.</EmptyState>;
  }
  if (status === "loading") return <div className="px-4 py-6 text-sm text-slate-500">Looking up {planetCode}…</div>;
  if (status === "missing") {
    return (
      <EmptyState title={`Could not find “${planetCode}”`}>
        Check the FIO id — it should be a natural id like OT-580b or an exact planet name.
      </EmptyState>
    );
  }
  if (!resources?.length) {
    return <EmptyState title="No extractable resources">FIO lists nothing minable or harvestable here.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Resource</th>
            <th className="px-4 py-2 text-left font-medium">Type</th>
            <th className="px-4 py-2 text-right font-medium">Per day</th>
            <th className="px-4 py-2 text-left font-medium">Extracted by</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((resource) => {
            const perDay = extractionPerDay(resource.resourceType, resource.factor);
            const building = extractionBuildingFor(resource.resourceType);
            return (
              <tr key={resource.materialId} className="border-b border-edge/40 last:border-0">
                <td className="px-4 py-2">
                  <span className="font-medium text-slate-100">{resource.ticker ?? "?"}</span>
                  {resource.name && <span className="ml-2 text-xs text-slate-500">{resource.name}</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{resource.resourceType ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  {perDay === null ? (
                    "—"
                  ) : (
                    <span className="font-medium text-slate-100">{perDay}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{building ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-slate-600">
        Units one extraction building pulls per day at 100% efficiency.
      </p>
    </div>
  );
}


export function PlanetProduction({ planet, scenario }: { planet: Planet; scenario: Scenario }) {
  const { update } = useAppStore();
  const [section, setSection] = useState<Section>("production");

  // Who works here, and what they get through, both follow from the buildings.
  const [workforceByBuilding, setWorkforceByBuilding] = useState<Map<string, PopulationCounts>>(new Map());
  const [needs, setNeeds] = useState<WorkforceNeed[]>([]);

  const buildingCodes = useMemo(
    () => [...new Set(planet.factories.map((factory) => factory.buildingCode.trim().toUpperCase()))].sort().join(","),
    [planet.factories],
  );

  useEffect(() => {
    let cancelled = false;
    const codes = buildingCodes ? buildingCodes.split(",") : [];

    Promise.all([
      Promise.all(
        codes.map(async (code) => {
          const workforce = await prosperousProvider.getBuildingWorkforceRequirements(code).catch(() => null);
          return [code, workforce ?? emptyPopulation()] as const;
        }),
      ),
      prosperousProvider.getWorkforceNeeds().catch(() => ({ needs: [], source: "fallback" as const })),
    ]).then(([workforceEntries, needsResult]) => {
      if (cancelled) return;
      setWorkforceByBuilding(new Map(workforceEntries));
      setNeeds(needsResult.needs);
    });

    return () => {
      cancelled = true;
    };
  }, [buildingCodes]);

  const population = useMemo(
    () => populationFromBuildings(planet.factories, workforceByBuilding),
    [planet.factories, workforceByBuilding],
  );

  const consumption = useMemo(
    () => consumptionFromPopulation(population, needs, planet.includeLuxuries),
    [population, needs, planet.includeLuxuries],
  );

  const plan: ProductionPlan = useMemo(() => {
    const incoming = scenario.tradeRoutes.filter((route) => route.toPlanetId === planet.id);
    const outgoing = scenario.tradeRoutes.filter((route) => route.fromPlanetId === planet.id);

    return calculateProduction({
      batchInfos: planet.batchInfos,
      factories: planet.factories,
      produced: planet.produced,
      recipeInfos: planet.recipeInfos,
      workforceConsumption: consumption.map((line) => ({
        resource: line.materialTicker,
        dailyConsumption: line.dailyConsumption,
      })),
      needToBuy: planet.needToBuy,
      incomingTradeRoutes: incoming,
      outgoingTradeRoutes: outgoing,
    });
  }, [planet, scenario.tradeRoutes, consumption]);

  function edit(recipe: (target: Planet) => void) {
    update((draft) => {
      const target = draft.scenarios
        .find((entry) => entry.id === scenario.id)
        ?.planets.find((entry) => entry.id === planet.id);
      if (target) recipe(target);
    });
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-edge px-4 py-2">
        {(
          [
            ["production", "Production"],
            ["resources", "Natural resources"],
            ["balance", "Resource balance"],
            ["buy", `To buy${plan.needToBuy.length ? ` (${plan.needToBuy.length})` : ""}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={
              section === id
                ? "rounded bg-surface-overlay px-3 py-1.5 text-sm text-slate-100"
                : "rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {plan.warnings.length > 0 && (
        <ul className="space-y-1 border-b border-edge px-4 py-3 text-xs text-amber-300">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {section === "production" && (
        <ProductionSection
          planet={planet}
          plan={plan}
          population={population}
          consumption={consumption}
          edit={edit}
        />
      )}
      {section === "resources" && (
        <ResourcesSection planetCode={planet.fioPlanetNaturalId ?? planet.name ?? null} />
      )}
      {section === "balance" && <BalanceSection plan={plan} />}
      {section === "buy" && <BuySection planet={planet} plan={plan} edit={edit} />}
    </div>
  );
}

function SubHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

function Num({ value, onChange, width = "w-24" }: { value: number; onChange: (next: number) => void; width?: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
      className={`${width} rounded border border-edge bg-surface px-2 py-1 text-right text-sm text-slate-100`}
    />
  );
}

function Txt({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-28 rounded border border-edge bg-surface px-2 py-1 text-sm text-slate-100"
    />
  );
}

function ProductionSection({
  planet,
  plan,
  population,
  consumption,
  edit,
}: {
  planet: Planet;
  plan: ProductionPlan;
  population: PopulationCounts;
  consumption: WorkforceLine[];
  edit: (recipe: (target: Planet) => void) => void;
}) {
  const [product, setProduct] = useState("");
  const [looking, setLooking] = useState(false);
  /** Every way each product on this planet can be made, for the pickers. */
  const [choicesByProduct, setChoicesByProduct] = useState<Record<string, RecipeChoice[]>>({});

  const productNames = useMemo(
    () => [...new Set(planet.produced.map((row) => row.name.trim().toUpperCase()).filter(Boolean))],
    [planet.produced],
  );

  // Look up the options once per product, so the pickers can be opened without
  // waiting and switching a recipe costs nothing.
  useEffect(() => {
    let cancelled = false;
    const planetCode = planet.fioPlanetNaturalId ?? planet.name;

    Promise.all(
      productNames
        .filter((name) => !(name in choicesByProduct))
        .map(async (name) => [name, await recipeChoicesFor(name, planetCode)] as const),
    ).then((entries) => {
      if (!cancelled && entries.length) {
        setChoicesByProduct((current) => ({ ...current, ...Object.fromEntries(entries) }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [productNames]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addProduct() {
    const name = product.trim().toUpperCase();
    if (!name) return;

    setLooking(true);
    const planetCode = planet.fioPlanetNaturalId ?? planet.name;
    const choices = await recipeChoicesFor(name, planetCode);
    setLooking(false);

    setChoicesByProduct((current) => ({ ...current, [name]: choices }));
    const chosen = choices[0] ?? { id: null, label: null, batchQty: 1, batchHours: 1, inputs: [], buildingCode: null };

    edit((target) => {
      applyRecipeToPlanet(target, name, chosen);

      // Put it in the building that actually makes it, when that is here.
      const match = chosen.buildingCode
        ? target.factories.find((factory) => factory.buildingCode === chosen.buildingCode)
        : undefined;

      target.produced.push({
        id: newId(),
        name,
        amount: 0,
        allocatedSlots: null,
        factoryId: (match ?? target.factories[0])?.id ?? null,
        notes: chosen.buildingCode && !match ? `Needs a ${chosen.buildingCode} on this planet` : null,
      });
    });

    setProduct("");
  }

  function chooseRecipe(name: string, recipeId: string) {
    const choice = (choicesByProduct[name] ?? []).find((entry) => (entry.id ?? "") === recipeId);
    if (!choice) return;
    edit((target) => {
      applyRecipeToPlanet(target, name, choice);
      const match = choice.buildingCode
        ? target.factories.find((factory) => factory.buildingCode === choice.buildingCode)
        : undefined;
      if (match) {
        for (const row of target.produced) {
          if (row.name.trim().toUpperCase() === name) row.factoryId = match.id;
        }
      }
    });
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <SubHeading title="What this planet makes" hint="Amount is the production order size you run." />
        <div className="mb-3 flex gap-2">
          <Input
            value={product}
            placeholder="Material ticker, e.g. RAT"
            onChange={(event) => setProduct(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void addProduct()}
          />
          <Button variant="primary" onClick={() => void addProduct()} disabled={!product.trim() || looking}>
            <Plus className="h-3.5 w-3.5" /> {looking ? "Looking up…" : "Add product"}
          </Button>
        </div>

        {planet.produced.length === 0 ? (
          <EmptyState title="Nothing produced here yet" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1.5 text-left font-medium">Product</th>
                <th className="py-1.5 text-right font-medium">Order size</th>
                <th className="py-1.5 text-left font-medium">Building</th>
                <th className="py-1.5 text-right font-medium">Slots</th>
                <th className="py-1.5 text-right font-medium">Per hour</th>
                <th className="py-1.5 text-right font-medium">Per week</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {planet.produced.map((row) => {
                const derived = plan.produced.find((entry) => entry.id === row.id);
                return (
                  <tr key={row.id} className="border-b border-edge/40 last:border-0">
                    <td className="py-1.5 font-medium text-slate-100">{row.name}</td>
                    <td className="py-1.5 text-right">
                      <Num
                        value={row.amount}
                        onChange={(next) =>
                          edit((target) => {
                            const found = target.produced.find((entry) => entry.id === row.id);
                            if (found) found.amount = next;
                          })
                        }
                      />
                      {/* An order queues whole batches, up to 20 in one go. */}
                      {derived && derived.batchQty > 0 && row.amount > 0 && (
                        <span
                          className={
                            Math.ceil(row.amount / derived.batchQty) > 20
                              ? "ml-2 text-xs text-amber-300"
                              : "ml-2 text-xs text-slate-600"
                          }
                          title={
                            Math.ceil(row.amount / derived.batchQty) > 20
                              ? "More than one order: an order holds at most 20 batches"
                              : "Batches in this order"
                          }
                        >
                          {Math.ceil(row.amount / derived.batchQty)}×
                        </span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <Select
                        className="w-28 py-1 text-sm"
                        value={row.factoryId ?? ""}
                        onChange={(event) =>
                          edit((target) => {
                            const found = target.produced.find((entry) => entry.id === row.id);
                            if (found) found.factoryId = event.target.value || null;
                          })
                        }
                      >
                        <option value="">None</option>
                        {planet.factories.map((factory) => (
                          <option key={factory.id} value={factory.id}>
                            {factory.buildingCode}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1.5 text-right text-slate-400">
                      {formatNumber(derived?.effectiveSlots ?? 0, 2)}
                      {/* Lines sharing a building split it by order length, so
                          show the share rather than leaving it to be inferred. */}
                      {derived?.capacityShare !== null && derived?.capacityShare !== undefined && (
                        <span
                          className="ml-1.5 text-xs text-slate-600"
                          title="Share of this building, from how long its orders run against the others"
                        >
                          {formatPercent(derived.capacityShare)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-slate-100">{formatNumber(derived?.outputPerHour ?? 0, 2)}</td>
                    <td className="py-1.5 text-right text-slate-400">{formatNumber(derived?.outputPerWeek ?? 0, 0)}</td>
                    <td className="py-1.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          edit((target) => {
                            target.produced = target.produced.filter((entry) => entry.id !== row.id);
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <SubHeading
          title="Batch info"
          hint="Filled in from the recipe. Change the recipe and the batch and its ingredients follow."
        />
        {planet.batchInfos.length === 0 ? (
          <p className="text-xs text-slate-600">Added automatically when you add a product.</p>
        ) : (
          <ul className="space-y-2">
            {planet.batchInfos.map((row) => {
              const options = choicesByProduct[row.name.trim().toUpperCase()] ?? [];
              return (
                <li key={row.id} className="space-y-1">
                  {options.length > 1 && (
                    <Select
                      className="w-full py-1 text-xs"
                      value={row.recipeId ?? ""}
                      onChange={(event) => chooseRecipe(row.name.trim().toUpperCase(), event.target.value)}
                    >
                      {options.map((option) => (
                        <option key={option.id ?? option.label ?? ""} value={option.id ?? ""}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  {options.length === 1 && row.recipeLabel && (
                    <p className="text-xs text-slate-600">{row.recipeLabel}</p>
                  )}

                  <div className="flex items-center gap-2 text-sm">
                <span className="w-16 font-medium text-slate-100">{row.name}</span>
                <span className="text-xs text-slate-500">qty</span>
                <Num
                  value={row.batchQty}
                  width="w-20"
                  onChange={(next) =>
                    edit((target) => {
                      const found = target.batchInfos.find((entry) => entry.id === row.id);
                      if (found) found.batchQty = next;
                    })
                  }
                />
                <span className="text-xs text-slate-500">hours</span>
                <Num
                  value={row.knownBatchHours}
                  width="w-20"
                  onChange={(next) =>
                    edit((target) => {
                      const found = target.batchInfos.find((entry) => entry.id === row.id);
                      if (found) found.knownBatchHours = next;
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    edit((target) => {
                      target.batchInfos = target.batchInfos.filter((entry) => entry.id !== row.id);
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <IngredientsSection planet={planet} plan={plan} edit={edit} />
      <WorkforceSection planet={planet} population={population} consumption={consumption} edit={edit} />
    </div>
  );
}

function IngredientsSection({
  planet,
  plan,
  edit,
}: {
  planet: Planet;
  plan: ProductionPlan;
  edit: (recipe: (target: Planet) => void) => void;
}) {
  return (
    <div>
      <SubHeading title="Ingredients" hint="What one batch of each product consumes." />
      <div className="mb-2">
        <Button
          size="sm"
          onClick={() =>
            edit((target) => {
              target.recipeInfos.push({
                id: newId(),
                product: target.produced[0]?.name ?? "",
                ingredient: "",
                qtyPerProductBatch: 1,
              });
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add ingredient
        </Button>
      </div>

      {planet.recipeInfos.length === 0 ? (
        <p className="text-xs text-slate-600">No ingredients recorded, so nothing is counted as consumed.</p>
      ) : (
        <ul className="space-y-1">
          {planet.recipeInfos.map((row) => {
            const derived = plan.recipes.find((entry) => entry.id === row.id);
            return (
              <li key={row.id} className="flex items-center gap-2 text-sm">
                <Txt
                  value={row.product}
                  placeholder="RAT"
                  onChange={(next) =>
                    edit((target) => {
                      const found = target.recipeInfos.find((entry) => entry.id === row.id);
                      if (found) found.product = next.toUpperCase();
                    })
                  }
                />
                <span className="text-xs text-slate-500">needs</span>
                <Num
                  value={row.qtyPerProductBatch}
                  width="w-16"
                  onChange={(next) =>
                    edit((target) => {
                      const found = target.recipeInfos.find((entry) => entry.id === row.id);
                      if (found) found.qtyPerProductBatch = next;
                    })
                  }
                />
                <Txt
                  value={row.ingredient}
                  placeholder="GRN"
                  onChange={(next) =>
                    edit((target) => {
                      const found = target.recipeInfos.find((entry) => entry.id === row.id);
                      if (found) found.ingredient = next.toUpperCase();
                    })
                  }
                />
                <span className="text-xs text-slate-500">per batch</span>
                {derived && (
                  <Badge>{formatNumber(derived.ingredientDemandPerHour, 2)} / h</Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    edit((target) => {
                      target.recipeInfos = target.recipeInfos.filter((entry) => entry.id !== row.id);
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WorkforceSection({
  planet,
  population,
  consumption,
  edit,
}: {
  planet: Planet;
  population: PopulationCounts;
  consumption: WorkforceLine[];
  edit: (recipe: (target: Planet) => void) => void;
}) {
  const headcount = totalPopulation(population);

  return (
    <div>
      <SubHeading
        title="Workforce"
        hint="Worked out from the buildings here. Production buildings employ people; habitation, storage and the core module do not."
      />

      {headcount === 0 ? (
        <p className="text-xs text-slate-600">
          No production buildings here yet, so nobody lives here and nothing is consumed.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {POPULATION_CLASSES.filter((key) => population[key] > 0).map((key) => (
              <Badge key={key} tone="accent">
                {formatNumber(population[key], 0)} {key}
              </Badge>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={planet.includeLuxuries}
                onChange={(event) =>
                  edit((target) => {
                    target.includeLuxuries = event.target.checked;
                  })
                }
              />
              Supply luxuries
            </label>
          </div>

          {consumption.length === 0 ? (
            <p className="text-xs text-slate-600">No consumption data available from the provider.</p>
          ) : (
            <ul className="space-y-0.5">
              {consumption.map((line) => (
                <li key={line.materialTicker} className="flex items-center gap-2 text-sm">
                  <span className="w-16 font-medium text-slate-100">{line.materialTicker}</span>
                  <span className="text-xs text-slate-500">{line.materialName}</span>
                  {line.isLuxury && <Badge>luxury</Badge>}
                  <span className="ml-auto text-slate-300">
                    {formatNumber(line.dailyConsumption, 2)} / day
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function BalanceSection({ plan }: { plan: ProductionPlan }) {
  if (plan.balance.length === 0) {
    return <EmptyState title="Nothing to balance yet">Add what this planet produces and consumes.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Material</th>
            <th className="px-4 py-2 text-right font-medium">Made</th>
            <th className="px-4 py-2 text-right font-medium">Used</th>
            <th className="px-4 py-2 text-right font-medium">In</th>
            <th className="px-4 py-2 text-right font-medium">Out</th>
            <th className="px-4 py-2 text-right font-medium">Net / h</th>
            <th className="px-4 py-2 text-right font-medium">Short / week</th>
          </tr>
        </thead>
        <tbody>
          {plan.balance.map((row) => (
            <tr key={row.resource} className="border-b border-edge/40 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-100">{row.resource}</td>
              <td className="px-4 py-2 text-right">{formatNumber(row.producedPerHour, 2)}</td>
              <td className="px-4 py-2 text-right">{formatNumber(row.totalConsumedPerHour, 2)}</td>
              <td className="px-4 py-2 text-right text-slate-400">
                {row.incomingPerHour ? formatNumber(row.incomingPerHour, 2) : "—"}
              </td>
              <td className="px-4 py-2 text-right text-slate-400">
                {row.outgoingPerHour ? formatNumber(row.outgoingPerHour, 2) : "—"}
              </td>
              <td
                className={`px-4 py-2 text-right font-medium ${
                  row.netPerHour < 0 ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {formatNumber(row.netPerHour, 2)}
              </td>
              <td className="px-4 py-2 text-right">
                {row.importPerWeek > 0 ? formatNumber(row.importPerWeek, 1) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuySection({
  planet,
  plan,
  edit,
}: {
  planet: Planet;
  plan: ProductionPlan;
  edit: (recipe: (target: Planet) => void) => void;
}) {
  if (plan.needToBuy.length === 0) {
    return (
      <EmptyState title="Nothing needs buying">
        Everything this planet consumes is covered by what it makes or what arrives by trade route.
      </EmptyState>
    );
  }

  function setExtra(resource: string, manualExtraPerDay: number) {
    edit((target) => {
      const existing = target.needToBuy.find((row) => row.resource.toUpperCase() === resource);
      if (existing) {
        existing.manualExtraPerDay = manualExtraPerDay;
      } else {
        target.needToBuy.push({
          id: newId(),
          resource,
          importPerDay: 0,
          importPerWeek: 0,
          netPerHour: 0,
          sourceReason: "",
          manualExtraPerDay,
          notes: null,
        });
      }
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Material</th>
            <th className="px-4 py-2 text-right font-medium">Short / day</th>
            <th className="px-4 py-2 text-right font-medium">Extra / day</th>
            <th className="px-4 py-2 text-right font-medium">Buy / week</th>
            <th className="px-4 py-2 text-left font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {plan.needToBuy.map((row) => {
            const override = planet.needToBuy.find((entry) => entry.resource.toUpperCase() === row.resource);
            return (
              <tr key={row.resource} className="border-b border-edge/40 last:border-0">
                <td className="px-4 py-2 font-medium text-slate-100">{row.resource}</td>
                <td className="px-4 py-2 text-right">{formatNumber(row.importPerDay, 2)}</td>
                <td className="px-4 py-2 text-right">
                  <Num value={override?.manualExtraPerDay ?? 0} onChange={(next) => setExtra(row.resource, next)} />
                </td>
                <td className="px-4 py-2 text-right font-medium text-slate-100">
                  {formatNumber(row.totalImportPerWeek, 1)}
                </td>
                <td className="px-4 py-2">
                  <span className="text-xs text-slate-500">{row.reason}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
