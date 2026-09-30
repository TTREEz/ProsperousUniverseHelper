import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, Input, Select } from "@/components/ui";
import { extractionBuildingFor, extractionPerDay } from "@/lib/extraction";
import { formatNumber } from "@/lib/formats";
import { calculateProduction, type ProductionPlan } from "@/planner/production";
import { prosperousProvider } from "@/provider/fio-provider";
import type { PlanetResource } from "@/provider/types";
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

  const plan: ProductionPlan = useMemo(() => {
    const incoming = scenario.tradeRoutes.filter((route) => route.toPlanetId === planet.id);
    const outgoing = scenario.tradeRoutes.filter((route) => route.fromPlanetId === planet.id);

    return calculateProduction({
      batchInfos: planet.batchInfos,
      factories: planet.factories,
      produced: planet.produced,
      recipeInfos: planet.recipeInfos,
      workforceConsumption: planet.workforceConsumption,
      needToBuy: planet.needToBuy,
      incomingTradeRoutes: incoming,
      outgoingTradeRoutes: outgoing,
    });
  }, [planet, scenario.tradeRoutes]);

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

      {section === "production" && <ProductionSection planet={planet} plan={plan} edit={edit} />}
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
  edit,
}: {
  planet: Planet;
  plan: ProductionPlan;
  edit: (recipe: (target: Planet) => void) => void;
}) {
  const [product, setProduct] = useState("");
  const [looking, setLooking] = useState(false);

  /**
   * Batch size and time are published per recipe, and a planet's own resources
   * come out at a rate set by their concentration, so neither needs typing in.
   * Anything the provider cannot answer is left at 1 for the user to fill.
   */
  async function resolveBatch(
    name: string,
  ): Promise<{ batchQty: number; batchHours: number; buildingCode: string | null }> {
    const planetCode = planet.fioPlanetNaturalId ?? planet.name;
    if (planetCode) {
      const info = await prosperousProvider.getPlanetByIdOrCode(planetCode).catch(() => null);
      const resource = info?.resources.find((entry) => entry.ticker?.toUpperCase() === name);
      if (resource) {
        const perDay = extractionPerDay(resource.resourceType, resource.factor);
        if (perDay) {
          // An extractor runs continuously, so a day's yield is the batch.
          return { batchQty: perDay, batchHours: 24, buildingCode: extractionBuildingFor(resource.resourceType) };
        }
      }
    }

    const recipes = await prosperousProvider.getRecipesForProduct(name).catch(() => []);
    const best = recipes[0];
    if (!best) return { batchQty: 1, batchHours: 1, buildingCode: null };
    return { batchQty: best.outputAmount, batchHours: best.batchHours, buildingCode: best.buildingTicker };
  }

  async function addProduct() {
    const name = product.trim().toUpperCase();
    if (!name) return;

    setLooking(true);
    const resolved = await resolveBatch(name).catch(() => ({ batchQty: 1, batchHours: 1, buildingCode: null }));
    setLooking(false);

    edit((target) => {
      const existing = target.batchInfos.find((row) => row.name.toUpperCase() === name);
      if (existing) {
        existing.batchQty = resolved.batchQty;
        existing.knownBatchHours = resolved.batchHours;
      } else {
        target.batchInfos.push({
          id: newId(),
          name,
          batchQty: resolved.batchQty,
          knownBatchHours: resolved.batchHours,
          knownEff: 1,
          notes: null,
        });
      }

      // Put it in the building that actually makes it, when that is here.
      const match = resolved.buildingCode
        ? target.factories.find((factory) => factory.buildingCode === resolved.buildingCode)
        : undefined;

      target.produced.push({
        id: newId(),
        name,
        amount: 0,
        allocatedSlots: null,
        factoryId: (match ?? target.factories[0])?.id ?? null,
        notes: resolved.buildingCode && !match ? `Needs a ${resolved.buildingCode} on this planet` : null,
      });
    });

    setProduct("");
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
        <SubHeading title="Batch info" hint="How much one batch makes and how long it takes at 100% efficiency." />
        {planet.batchInfos.length === 0 ? (
          <p className="text-xs text-slate-600">Added automatically when you add a product.</p>
        ) : (
          <ul className="space-y-1">
            {planet.batchInfos.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-sm">
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <IngredientsSection planet={planet} plan={plan} edit={edit} />
      <WorkforceSection planet={planet} edit={edit} />
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

function WorkforceSection({ planet, edit }: { planet: Planet; edit: (recipe: (target: Planet) => void) => void }) {
  return (
    <div>
      <SubHeading title="Workforce consumption" hint="What your population eats and drinks each day." />
      <div className="mb-2">
        <Button
          size="sm"
          onClick={() =>
            edit((target) => {
              target.workforceConsumption.push({ id: newId(), resource: "", dailyConsumption: 0, notes: null });
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {planet.workforceConsumption.length === 0 ? (
        <p className="text-xs text-slate-600">Nothing recorded.</p>
      ) : (
        <ul className="space-y-1">
          {planet.workforceConsumption.map((row) => (
            <li key={row.id} className="flex items-center gap-2 text-sm">
              <Txt
                value={row.resource}
                placeholder="DW"
                onChange={(next) =>
                  edit((target) => {
                    const found = target.workforceConsumption.find((entry) => entry.id === row.id);
                    if (found) found.resource = next.toUpperCase();
                  })
                }
              />
              <Num
                value={row.dailyConsumption}
                onChange={(next) =>
                  edit((target) => {
                    const found = target.workforceConsumption.find((entry) => entry.id === row.id);
                    if (found) found.dailyConsumption = next;
                  })
                }
              />
              <span className="text-xs text-slate-500">per day</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  edit((target) => {
                    target.workforceConsumption = target.workforceConsumption.filter((entry) => entry.id !== row.id);
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
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
