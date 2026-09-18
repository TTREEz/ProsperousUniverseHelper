import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { formatNumber } from "@/lib/formats";
import { derivePackagePlan, type MaterialPlan } from "@/planner/materials";
import { applyPrices, type PricedPlan } from "@/planner/pricing";
import { prosperousProvider } from "@/provider/fio-provider";
import { EXCHANGES, getExchangePrices } from "@/provider/market";
import { newId } from "@/schema/defaults";
import type { ExpansionItemType, ExpansionPackage } from "@/schema/types";
import { activeScenario, useAppStore } from "@/store/app-store";

export function MaterialsRoute() {
  const { file, update } = useAppStore();
  const scenario = activeScenario(file);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const packages = scenario?.expansionPackages ?? [];
  const selected = packages.find((entry) => entry.id === selectedId) ?? packages[0] ?? null;

  if (!scenario) return null;
  const scenarioId = scenario.id;

  function addPackage() {
    const name = newName.trim();
    if (!name) return;
    const pkg: ExpansionPackage = {
      id: newId(),
      name,
      description: null,
      systemId: null,
      targetPlanetId: null,
      exchangeCode: null,
      enabled: true,
      // A hand-written list means "buy me this much", so it is not reduced by
      // what is already standing unless the user asks for that.
      deductExistingBuildings: false,
      items: [],
      adjustments: [],
      checklist: [],
    };
    update((draft) => {
      draft.scenarios.find((entry) => entry.id === scenarioId)?.expansionPackages.push(pkg);
    });
    setSelectedId(pkg.id);
    setNewName("");
  }

  function removePackage(packageId: string) {
    update((draft) => {
      const target = draft.scenarios.find((entry) => entry.id === scenarioId);
      if (!target) return;
      target.expansionPackages = target.expansionPackages.filter((entry) => entry.id !== packageId);
    });
    setSelectedId(null);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader
          title="Material planner"
          description="Build a shopping list from the buildings and materials you plan to buy."
        />
        <div className="flex gap-2 border-b border-edge p-4">
          <Input
            value={newName}
            placeholder="New shopping list name, e.g. Montem expansion"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addPackage()}
          />
          <Button variant="primary" onClick={addPackage} disabled={!newName.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {packages.length === 0 ? (
          <EmptyState title="No shopping lists yet">
            Add one, then put buildings or materials in it to see what you need to buy.
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedId(pkg.id)}
                className={
                  pkg.id === selected?.id
                    ? "rounded border border-accent bg-accent/15 px-3 py-1.5 text-sm text-accent"
                    : "rounded border border-edge px-3 py-1.5 text-sm text-slate-300 hover:border-edge-strong"
                }
              >
                {pkg.name}
                <span className="ml-2 text-xs opacity-70">{pkg.items.length}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <PackageDetail
          key={selected.id}
          pkg={selected}
          scenarioId={scenarioId}
          onDelete={() => removePackage(selected.id)}
        />
      )}
    </div>
  );
}

function PackageDetail({
  pkg,
  scenarioId,
  onDelete,
}: {
  pkg: ExpansionPackage;
  scenarioId: string;
  onDelete: () => void;
}) {
  const { file, update } = useAppStore();
  const scenario = file?.scenarios.find((entry) => entry.id === scenarioId) ?? null;

  const [itemType, setItemType] = useState<ExpansionItemType>("BUILDING");
  const [itemCode, setItemCode] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [plan, setPlan] = useState<MaterialPlan | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priced, setPriced] = useState<PricedPlan | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const targetPlanet = scenario?.planets.find((planet) => planet.id === pkg.targetPlanetId) ?? null;
  const targetPlanetCode = targetPlanet?.fioPlanetNaturalId ?? targetPlanet?.name ?? null;

  // Most specific choice wins: this list, then the planet's usual buy exchange,
  // then the file-wide default, so prices appear without configuring each list.
  const exchange =
    pkg.exchangeCode ?? targetPlanet?.defaultBuyExchangeCode ?? file?.settings.defaultExchangeCode ?? null;

  // Re-derive whenever the inputs that affect the answer change. The provider
  // is cached, so repeat runs after the first are cheap.
  const existingBuildings = useMemo(
    () => (targetPlanet?.factories ?? []).map((factory) => ({ buildingCode: factory.buildingCode, count: factory.count })),
    [targetPlanet],
  );

  const signature = useMemo(
    () =>
      JSON.stringify([
        pkg.items.map((item) => [item.itemType, item.itemCode, item.quantity]),
        pkg.adjustments.map((adjustment) => [adjustment.materialTicker, adjustment.quantityDelta]),
        pkg.checklist.map((entry) => [entry.materialTicker, entry.acquiredQuantity, entry.checkedComplete]),
        targetPlanetCode,
        pkg.deductExistingBuildings,
        existingBuildings,
      ]),
    [pkg.items, pkg.adjustments, pkg.checklist, targetPlanetCode, pkg.deductExistingBuildings, existingBuildings],
  );

  useEffect(() => {
    let cancelled = false;
    setDeriving(true);
    setError(null);

    derivePackagePlan(
      {
        items: pkg.items,
        adjustments: pkg.adjustments,
        checklist: pkg.checklist,
        targetPlanetCode,
        existingBuildings,
        deductExisting: pkg.deductExistingBuildings,
      },
      prosperousProvider,
    )
      .then((result) => {
        if (!cancelled) setPlan(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setDeriving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pricing is a separate pass so a market outage costs prices, not the list.
  useEffect(() => {
    if (!plan || !exchange) {
      setPriced(null);
      return;
    }

    let cancelled = false;
    setPriceError(null);

    getExchangePrices(exchange)
      .then((prices) => {
        if (!cancelled) setPriced(applyPrices(plan.rows, prices, exchange));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setPriced(null);
        setPriceError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [plan, exchange]);

  function editPackage(recipe: (target: ExpansionPackage) => void) {
    update((draft) => {
      const target = draft.scenarios
        .find((entry) => entry.id === scenarioId)
        ?.expansionPackages.find((entry) => entry.id === pkg.id);
      if (target) recipe(target);
    });
  }

  function addItem() {
    const code = itemCode.trim().toUpperCase();
    if (!code || quantity <= 0) return;
    editPackage((target) => {
      target.items.push({
        id: newId(),
        itemType,
        itemCode: code,
        itemNameSnapshot: null,
        quantity,
        sortOrder: target.items.length,
        notes: null,
      });
    });
    setItemCode("");
    setQuantity(1);
  }

  function setAcquired(ticker: string, acquiredQuantity: number) {
    editPackage((target) => {
      const existing = target.checklist.find((entry) => entry.materialTicker === ticker);
      if (existing) {
        existing.acquiredQuantity = acquiredQuantity;
      } else {
        target.checklist.push({ id: newId(), materialTicker: ticker, acquiredQuantity, checkedComplete: false });
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={pkg.name}
          description={
            targetPlanet
              ? `Building on ${targetPlanet.name} — environmental construction costs included`
              : "No target planet set — environmental construction costs are not included"
          }
          actions={
            <Button size="sm" variant="ghost" onClick={onDelete} title="Delete this shopping list">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          }
        />

        <div className="grid gap-4 border-b border-edge p-4 sm:grid-cols-4">
          <Field label="Target planet" hint="Drives MCG / AEF and climate costs">
            <Select
              value={pkg.targetPlanetId ?? ""}
              onChange={(event) =>
                editPackage((target) => {
                  target.targetPlanetId = event.target.value || null;
                })
              }
            >
              <option value="">None</option>
              {scenario?.planets.map((planet) => (
                <option key={planet.id} value={planet.id}>
                  {planet.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Exchange" hint="Prices come from here">
            <Select
              value={pkg.exchangeCode ?? ""}
              onChange={(event) =>
                editPackage((target) => {
                  target.exchangeCode = event.target.value || null;
                })
              }
            >
              <option value="">
                {targetPlanet?.defaultBuyExchangeCode
                  ? `Planet default (${targetPlanet.defaultBuyExchangeCode})`
                  : file?.settings.defaultExchangeCode
                    ? `File default (${file.settings.defaultExchangeCode})`
                    : "No prices"}
              </option>
              {EXCHANGES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Type">
            <Select value={itemType} onChange={(event) => setItemType(event.target.value as ExpansionItemType)}>
              <option value="BUILDING">Building</option>
              <option value="MATERIAL">Material</option>
            </Select>
          </Field>

          <Field label={itemType === "BUILDING" ? "Building code" : "Material ticker"}>
            <Input
              value={itemCode}
              placeholder={itemType === "BUILDING" ? "FRM" : "BSE"}
              onChange={(event) => setItemCode(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addItem()}
            />
          </Field>

          <Field label="Quantity">
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value) || 0)}
              />
              <Button variant="primary" onClick={addItem} disabled={!itemCode.trim()}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Field>
        </div>

        <label className="flex items-start gap-2 border-b border-edge px-4 py-3 text-sm text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={pkg.deductExistingBuildings}
            onChange={(event) =>
              editPackage((target) => {
                target.deductExistingBuildings = event.target.checked;
              })
            }
          />
          <span>
            Building counts are a total to reach
            <span className="mt-0.5 block text-xs text-slate-500">
              {pkg.deductExistingBuildings
                ? "Buildings already on the target planet are subtracted, so this lists only what is left to build."
                : "Quantities are taken as extra buildings to add, ignoring what is already on the planet."}
              {existingBuildings.length === 0 && targetPlanet
                ? ` ${targetPlanet.name} has no buildings recorded yet — add them under Planets.`
                : ""}
            </span>
          </span>
        </label>

        {pkg.items.length === 0 ? (
          <EmptyState title="Nothing in this list yet">
            Add the buildings you plan to construct, or materials you need directly.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-edge/60">
            {pkg.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Badge tone={item.itemType === "BUILDING" ? "accent" : "neutral"}>
                  {item.itemType === "BUILDING" ? "Building" : "Material"}
                </Badge>
                <span className="font-medium text-slate-100">{item.itemCode}</span>
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(event) =>
                    editPackage((target) => {
                      const found = target.items.find((entry) => entry.id === item.id);
                      if (found) found.quantity = Number(event.target.value) || 0;
                    })
                  }
                  className="w-20 rounded border border-edge bg-surface px-2 py-1 text-sm"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    editPackage((target) => {
                      target.items = target.items.filter((entry) => entry.id !== item.id);
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && (
        <Card>
          <div className="px-4 py-3 text-sm text-red-300">{error}</div>
        </Card>
      )}

      {plan && (
        <Card>
          <CardHeader
            title="Shopping list"
            description={
              plan.rows.length
                ? `${plan.totals.distinctMaterials} materials · ${formatNumber(plan.totals.unitsToBuy, 0)} units${
                    plan.totals.weight === null ? "" : ` · ${formatNumber(plan.totals.weight, 1)} t`
                  }${plan.totals.volume === null ? "" : ` · ${formatNumber(plan.totals.volume, 1)} m³`}`
                : undefined
            }
            actions={deriving ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500" /> : undefined}
          />

          {plan.warnings.length > 0 && (
            <ul className="space-y-1 border-b border-edge px-4 py-3 text-xs text-amber-300">
              {plan.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {priceError && (
            <p className="border-b border-edge px-4 py-2 text-xs text-amber-300">
              Prices unavailable ({priceError}). Quantities below are unaffected.
            </p>
          )}

          {priced && (
            <div className="border-b border-edge px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-lg font-semibold text-slate-100">
                  {formatNumber(priced.estimatedTotal, 0)}
                </span>
                <span className="text-xs text-slate-500">estimated at {priced.exchange} ask prices</span>
              </div>
              {priced.unpricedTickers.length > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  Not included: {priced.unpricedTickers.join(", ")} — nobody is selling at {priced.exchange}, so the
                  real total is higher.
                </p>
              )}
              {priced.shortSupplyTickers.length > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  More than {priced.exchange} has listed: {priced.shortSupplyTickers.join(", ")} — buying it all will
                  move the price or need another exchange.
                </p>
              )}
            </div>
          )}

          {plan.deductions.length > 0 && (
            <div className="border-b border-edge px-4 py-3 text-xs text-slate-400">
              <p className="mb-1 font-medium text-slate-300">Already built on {targetPlanet?.name}</p>
              <ul className="space-y-0.5">
                {plan.deductions.map((deduction) => (
                  <li key={deduction.buildingCode}>
                    {deduction.buildingCode}: {deduction.requested} planned − {deduction.alreadyBuilt} built ={" "}
                    <span className="text-slate-200">{deduction.stillToBuild} to build</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.rows.length === 0 ? (
            <EmptyState title="Nothing to buy yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Material</th>
                    <th className="px-4 py-2 text-right font-medium">Required</th>
                    <th className="px-4 py-2 text-right font-medium">To buy</th>
                    <th className="px-4 py-2 text-right font-medium">Have</th>
                    <th className="px-4 py-2 text-right font-medium">Still needed</th>
                    {priced && <th className="px-4 py-2 text-right font-medium">Ask</th>}
                    {priced && <th className="px-4 py-2 text-right font-medium">Cost</th>}
                    <th className="px-4 py-2 text-left font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.ticker} className="border-b border-edge/50 last:border-0">
                      <td className="px-4 py-2">
                        <span className="font-medium text-slate-100">{row.ticker}</span>
                        <span className="ml-2 text-xs text-slate-500">{row.name}</span>
                      </td>
                      <td className="px-4 py-2 text-right">{formatNumber(row.requiredQty, 2)}</td>
                      <td className="px-4 py-2 text-right font-medium text-slate-100">
                        {formatNumber(row.remainingToBuy, 2)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={row.acquiredQuantity}
                          onChange={(event) => setAcquired(row.ticker, Number(event.target.value) || 0)}
                          className="w-20 rounded border border-edge bg-surface px-2 py-1 text-right text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {row.remainingUnacquired === 0 ? (
                          <Badge tone="good">Done</Badge>
                        ) : (
                          formatNumber(row.remainingUnacquired, 2)
                        )}
                      </td>

                      {priced &&
                        (() => {
                          const p = priced.rows.find((entry) => entry.ticker === row.ticker);
                          return (
                            <>
                              <td className="px-4 py-2 text-right">
                                {p?.ask === null || p?.ask === undefined ? (
                                  <span className="text-xs text-amber-300" title="Nobody is selling this here">
                                    no ask
                                  </span>
                                ) : (
                                  formatNumber(p.ask, 2)
                                )}
                              </td>
                              <td className="px-4 py-2 text-right">
                                {p?.estimatedCost === null || p?.estimatedCost === undefined ? (
                                  <span className="text-slate-600">—</span>
                                ) : (
                                  <span className={p.shortSupply ? "text-amber-300" : undefined}>
                                    {formatNumber(p.estimatedCost, 0)}
                                  </span>
                                )}
                              </td>
                            </>
                          );
                        })()}

                      <td className="px-4 py-2">
                        <span className="text-xs text-slate-500">{row.sourceKinds.join(", ")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
