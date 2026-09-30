import { useState } from "react";
import { Layers, Play, Plus, Save, ShoppingCart, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { ComboInput, useCatalog } from "@/components/combo-input";
import { formatNumber, formatPercent } from "@/lib/formats";
import { optimizeBase } from "@/optimizer/optimize";
import { generateBasePhases } from "@/optimizer/phases";
import type { AdditionalTarget, BasePhasePlan, OptimizedBaseResult, RecipeDecision } from "@/optimizer/types";
import { prosperousProvider } from "@/provider/fio-provider";
import { newId } from "@/schema/defaults";
import type { ObjectiveType, TargetPeriod } from "@/schema/types";
import { activeScenario, useAppStore } from "@/store/app-store";

const OBJECTIVES: Array<{ value: ObjectiveType; label: string }> = [
  { value: "MAXIMIZE_OUTPUT", label: "Maximize output within the area" },
  { value: "CLOSEST_TO_TARGET", label: "Hit a target amount" },
  { value: "MINIMIZE_IMPORTS", label: "Minimize imports" },
  { value: "MAXIMIZE_SELF_SUFFICIENCY", label: "Maximize self-sufficiency" },
];

const WORKFORCE_GOODS = ["DW", "RAT", "OVE", "PWO", "COF", "EXO", "PT", "REP", "KOM", "FIM", "MEA"];

export function OptimizerRoute() {
  const { file, update } = useAppStore();
  const scenario = activeScenario(file);

  const [planetCode, setPlanetCode] = useState("");
  const [availableArea, setAvailableArea] = useState(500);
  const [objectiveType, setObjectiveType] = useState<ObjectiveType>("MAXIMIZE_OUTPUT");
  const [targetProduct, setTargetProduct] = useState("");
  const [targetAmount, setTargetAmount] = useState<number | "">("");
  const [targetPeriod, setTargetPeriod] = useState<TargetPeriod>("WEEK");
  const [inHouse, setInHouse] = useState<string[]>(["DW", "RAT"]);
  const [additionalTargets, setAdditionalTargets] = useState<AdditionalTarget[]>([]);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizedBaseResult | null>(null);
  const [sentToList, setSentToList] = useState<string | null>(null);
  /** Product ticker to chosen recipe id, for recipes the solver got wrong. */
  const [recipeOverrides, setRecipeOverrides] = useState<Record<string, string>>({});
  const materials = useCatalog("materials");
  const [phases, setPhases] = useState<BasePhasePlan | null>(null);
  const [phasing, setPhasing] = useState(false);

  function currentInput(overrides: Record<string, string>) {
    return {
      planetCode: planetCode.trim().toUpperCase(),
      availableArea,
      objectiveType,
      targetProduct: targetProduct.trim().toUpperCase(),
      targetAmount: targetAmount === "" ? null : targetAmount,
      targetPeriod: objectiveType === "CLOSEST_TO_TARGET" ? targetPeriod : null,
      additionalTargets: additionalTargets.filter((entry) => entry.product.trim() && entry.amount > 0),
      selectedWorkforceInHouseResources: inHouse,
      selectedRecipeOverrides: overrides,
      excludedRecipes: [],
    };
  }

  async function generatePhases() {
    setPhasing(true);
    setError(null);
    try {
      setPhases(await generateBasePhases(currentInput(recipeOverrides), prosperousProvider));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPhasing(false);
    }
  }

  const canRun = planetCode.trim().length > 0 && targetProduct.trim().length > 0 && !running;

  async function run(overrides: Record<string, string> = recipeOverrides) {
    setRunning(true);
    setError(null);
    // Stages are solved from the same inputs, so a new plan makes them stale.
    setPhases(null);
    try {
      const output = await optimizeBase(currentInput(overrides), prosperousProvider);
      setResult(output);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  function saveAsTemplate() {
    if (!result || !scenario) return;
    const scenarioId = scenario.id;
    update((draft) => {
      const target = draft.scenarios.find((entry) => entry.id === scenarioId);
      if (!target) return;
      target.baseTemplates.push({
        id: newId(),
        name: `${result.summary.targetProduct} on ${result.summary.planetName ?? result.summary.planetCode}`,
        planetId: null,
        planetCode: result.summary.planetCode,
        planetNameSnapshot: result.summary.planetName,
        availableArea: result.summary.availableArea,
        objectiveType,
        targetProduct: result.summary.targetProduct,
        targetAmount: targetAmount === "" ? null : targetAmount,
        targetPeriod: objectiveType === "CLOSEST_TO_TARGET" ? targetPeriod : null,
        additionalTargets,
        selectedWorkforceInHouseResources: inHouse,
        selectedRecipeOverrides: recipeOverrides,
        excludedRecipes: [],
        notes: null,
        results: [
          {
            id: newId(),
            createdAt: new Date().toISOString(),
            score: result.summary.score,
            targetAchieved: result.summary.targetAchievedPerWeek,
            areaUsed: result.summary.areaUsed,
            averageUtilization: result.summary.averageUtilization ?? 0,
            warningCount: result.warnings.length,
            snapshot: result,
          },
        ],
      });
    });
  }

  /**
   * The point of merging the two old tools: a generated layout becomes a
   * shopping list without retyping every building by hand.
   */
  function sendToShoppingList() {
    if (!result || !scenario) return;
    const scenarioId = scenario.id;
    const name = `${result.summary.targetProduct} on ${result.summary.planetName ?? result.summary.planetCode}`;

    update((draft) => {
      const target = draft.scenarios.find((entry) => entry.id === scenarioId);
      if (!target) return;

      // Housing and production buildings both count; anything the optimizer
      // could not resolve a building for would only add noise.
      const buildings = result.buildingPlan.filter((row) => row.status === "planned" && row.count > 0);

      target.expansionPackages.push({
        id: newId(),
        name: `${name} — build out`,
        description: `From the base optimizer: ${buildings.length} building types, ${formatNumber(
          result.summary.areaUsed,
          0,
        )} area.`,
        systemId: null,
        targetPlanetId:
          target.planets.find(
            (planet) =>
              planet.fioPlanetNaturalId?.toUpperCase() === result.summary.planetCode.toUpperCase() ||
              planet.name.toUpperCase() === (result.summary.planetName ?? "").toUpperCase(),
          )?.id ?? null,
        exchangeCode: null,
        enabled: true,
        // The optimizer describes the finished base, so what to buy is this
        // minus whatever already stands on the target planet.
        deductExistingBuildings: true,
        items: buildings.map((row, index) => ({
          id: newId(),
          itemType: "BUILDING" as const,
          itemCode: row.buildingCode,
          itemNameSnapshot: row.buildingName,
          quantity: row.count,
          sortOrder: index,
          notes: row.purpose,
        })),
        adjustments: [],
        checklist: [],
      });
    });

    setSentToList(name);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader
          title="Base optimizer"
          description="Pick a planet, an area budget and a target product. Game data comes from FIO and is cached for offline use."
          actions={
            <Button variant="primary" disabled={!canRun} onClick={() => void run()}>
              <Play className="h-3.5 w-3.5" /> {running ? "Solving…" : "Generate plan"}
            </Button>
          }
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Planet" hint="Natural id or name, e.g. OT-580b or Montem">
            <Input value={planetCode} onChange={(event) => setPlanetCode(event.target.value)} placeholder="OT-580b" />
          </Field>

          <Field label="Available area">
            <Input
              type="number"
              min={1}
              value={availableArea}
              onChange={(event) => setAvailableArea(Number(event.target.value) || 0)}
            />
          </Field>

          <Field label="Target product" hint="Material ticker, e.g. RAT">
            <ComboInput
              value={targetProduct}
              onChange={setTargetProduct}
              options={materials}
              placeholder="RAT"
            />
          </Field>

          <Field label="Objective">
            <Select value={objectiveType} onChange={(event) => setObjectiveType(event.target.value as ObjectiveType)}>
              {OBJECTIVES.map((objective) => (
                <option key={objective.value} value={objective.value}>
                  {objective.label}
                </option>
              ))}
            </Select>
          </Field>

          {objectiveType === "CLOSEST_TO_TARGET" && (
            <>
              <Field label="Target amount">
                <Input
                  type="number"
                  min={0}
                  value={targetAmount}
                  onChange={(event) => setTargetAmount(event.target.value === "" ? "" : Number(event.target.value))}
                />
              </Field>
              <Field label="Per">
                <Select value={targetPeriod} onChange={(event) => setTargetPeriod(event.target.value as TargetPeriod)}>
                  <option value="HOUR">Hour</option>
                  <option value="DAY">Day</option>
                  <option value="WEEK">Week</option>
                </Select>
              </Field>
            </>
          )}

          <div className="sm:col-span-2 lg:col-span-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="label mb-0">Also make</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdditionalTargets((current) => [...current, { product: "", amount: 0, period: "WEEK" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add product
              </Button>
              <span className="text-xs text-slate-600">
                Fixed amounts made alongside the main target, sharing its production chain.
              </span>
            </div>

            {additionalTargets.map((entry, index) => (
              <div key={index} className="mb-1.5 flex items-center gap-2">
                <ComboInput
                  className="w-28"
                  value={entry.product}
                  placeholder="DW"
                  options={materials}
                  onChange={(next) =>
                    setAdditionalTargets((current) =>
                      current.map((row, i) => (i === index ? { ...row, product: next.toUpperCase() } : row)),
                    )
                  }
                />
                <Input
                  className="w-28"
                  type="number"
                  min={0}
                  value={entry.amount}
                  onChange={(event) =>
                    setAdditionalTargets((current) =>
                      current.map((row, i) => (i === index ? { ...row, amount: Number(event.target.value) || 0 } : row)),
                    )
                  }
                />
                <Select
                  className="w-28"
                  value={entry.period}
                  onChange={(event) =>
                    setAdditionalTargets((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, period: event.target.value as TargetPeriod } : row,
                      ),
                    )
                  }
                >
                  <option value="HOUR">per hour</option>
                  <option value="DAY">per day</option>
                  <option value="WEEK">per week</option>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdditionalTargets((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <span className="label">Produce workforce goods in-house</span>
            <div className="flex flex-wrap gap-1.5">
              {WORKFORCE_GOODS.map((ticker) => {
                const selected = inHouse.includes(ticker);
                return (
                  <button
                    key={ticker}
                    type="button"
                    onClick={() =>
                      setInHouse((current) =>
                        current.includes(ticker) ? current.filter((entry) => entry !== ticker) : [...current, ticker],
                      )
                    }
                    className={
                      selected
                        ? "rounded border border-accent bg-accent/15 px-2 py-1 text-xs text-accent"
                        : "rounded border border-edge px-2 py-1 text-xs text-slate-400 hover:border-edge-strong"
                    }
                  >
                    {ticker}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <Card>
          <div className="px-4 py-3 text-sm text-red-300">{error}</div>
        </Card>
      )}

      {result && (
        <>
          <RecipeChoices
            decisions={result.recipeDecisions}
            overrides={recipeOverrides}
            running={running}
            onChange={(product, recipeId) => {
              const next = { ...recipeOverrides };
              if (recipeId === null) delete next[product];
              else next[product] = recipeId;
              setRecipeOverrides(next);
              void run(next);
            }}
          />
          <OptimizerResult
            result={result}
            onSave={saveAsTemplate}
            onSendToShoppingList={sendToShoppingList}
            canSave={Boolean(scenario)}
            sentToList={sentToList}
          />
          <BuildStages phases={phases} generating={phasing} onGenerate={() => void generatePhases()} />
        </>
      )}

      {!result && !error && (
        <Card>
          <EmptyState title="No plan yet">
            Fill in a planet and target product, then generate a plan. The first run fetches material and building
            data from FIO, so it takes a moment; later runs use the cache.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}

/**
 * The plan broken into stages you can actually build towards.
 *
 * Each stage is the best base that fits in a fraction of the final area, so
 * every one is a base worth running rather than a half-finished version of the
 * last. Stages that do not change what you build, or add less than a few
 * percent of the final output, are dropped.
 */
function BuildStages({
  phases,
  onGenerate,
  generating,
}: {
  phases: BasePhasePlan | null;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Build stages"
        description="Points on the way to the full base where it is worth stopping and running what you have."
        actions={
          <Button size="sm" disabled={generating} onClick={onGenerate}>
            <Layers className="h-3.5 w-3.5" /> {generating ? "Working…" : phases ? "Regenerate" : "Work out stages"}
          </Button>
        }
      />

      {!phases && !generating && (
        <EmptyState title="No stages yet">
          This re-solves the base at several smaller area budgets, so it takes a little longer than a single plan.
        </EmptyState>
      )}

      {generating && <div className="px-4 py-6 text-sm text-slate-500">Solving the base at each area budget…</div>}

      {phases && !generating && (
        <ul className="divide-y divide-edge/60">
          {phases.phases.map((phase) => (
            <li key={phase.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-slate-100">{phase.name}</span>
                <Badge tone={phase.index === phases.phases.length ? "good" : "accent"}>
                  {formatNumber(phase.areaCap, 0)} area
                </Badge>
                {phase.outputShareOfFinal !== null && (
                  <span className="text-xs text-slate-400">
                    {formatPercent(phase.outputShareOfFinal)} of final output
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {formatNumber(phase.result.summary.targetAchievedPerWeek, 0)} / week
                </span>
                {phase.result.summary.averageUtilization !== null && (
                  <span className="text-xs text-slate-500">
                    {formatPercent(phase.result.summary.averageUtilization)} utilization
                  </span>
                )}
              </div>

              {phase.buildingDeltas.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {phase.buildingDeltas.map((delta) => (
                    <span
                      key={delta.buildingCode}
                      className="rounded border border-edge px-2 py-0.5 text-xs text-slate-300"
                      title={`${delta.purpose} — ${formatNumber(delta.totalAreaAdded, 0)} area`}
                    >
                      +{delta.addCount} {delta.buildingCode}
                      {delta.previousCount > 0 && (
                        <span className="ml-1 opacity-60">
                          ({delta.previousCount}→{delta.nextCount})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-600">Nothing new to build at this stage.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Which recipe the solver picked for each product, and what else it could have
 * used. Its choice folds the whole chain below a recipe into one number, so it
 * sometimes prefers something that does not match how you actually want to run
 * the base — this is where you say so.
 */
function RecipeChoices({
  decisions,
  overrides,
  running,
  onChange,
}: {
  decisions: RecipeDecision[];
  overrides: Record<string, string>;
  running: boolean;
  onChange: (product: string, recipeId: string | null) => void;
}) {
  const withChoices = decisions.filter((decision) => decision.alternatives.length > 1);
  if (withChoices.length === 0) return null;

  const overriddenCount = Object.keys(overrides).length;

  return (
    <Card>
      <CardHeader
        title="Recipes"
        description="Only products with more than one way to make them are listed. Changing one re-runs the plan."
        actions={
          overriddenCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={running}
              onClick={() => {
                for (const product of Object.keys(overrides)) onChange(product, null);
              }}
            >
              Reset {overriddenCount}
            </Button>
          ) : undefined
        }
      />

      <ul className="divide-y divide-edge/60">
        {withChoices.map((decision) => {
          const best = decision.alternatives.find((entry) => entry.id === decision.recommendedRecipeId) ?? null;
          return (
            <li key={decision.product} className="px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-100">{decision.product}</span>
                {decision.overridden && <Badge tone="warn">Your choice</Badge>}
                <span className="text-xs text-slate-500">
                  {decision.alternatives.length} recipes
                </span>
              </div>

              <Select
                disabled={running}
                value={overrides[decision.product] ?? decision.selectedRecipeId ?? ""}
                onChange={(event) =>
                  onChange(decision.product, event.target.value === best?.id ? null : event.target.value)
                }
              >
                {decision.alternatives.map((alternative) => (
                  <option key={alternative.id} value={alternative.id}>
                    {alternative.id === decision.recommendedRecipeId ? "★ " : ""}
                    {alternative.label}
                  </option>
                ))}
              </Select>

              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {decision.alternatives.map((alternative) => {
                  const isSelected = alternative.id === (overrides[decision.product] ?? decision.selectedRecipeId);
                  return (
                    <span
                      key={alternative.id}
                      className={isSelected ? "text-slate-300" : undefined}
                      title={alternative.recommendationReason}
                    >
                      {alternative.buildingTicker ?? "?"}:{" "}
                      {alternative.utilization === null ? "—" : formatPercent(alternative.utilization)} fit
                      <span className="ml-1 opacity-60">(score {formatNumber(alternative.score, 0)})</span>
                    </span>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function OptimizerResult({
  result,
  onSave,
  onSendToShoppingList,
  canSave,
  sentToList,
}: {
  result: OptimizedBaseResult;
  onSave: () => void;
  onSendToShoppingList: () => void;
  canSave: boolean;
  sentToList: string | null;
}) {
  const { summary } = result;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${summary.targetProduct} on ${summary.planetName ?? summary.planetCode}`}
          description={`Score ${formatNumber(summary.score, 1)} · ${summary.totalBuildingCount} buildings`}
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={!canSave}
                onClick={onSendToShoppingList}
                title="Create a shopping list from these buildings"
              >
                <ShoppingCart className="h-3.5 w-3.5" /> Send to shopping list
              </Button>
              <Button size="sm" disabled={!canSave} onClick={onSave} title="Save these inputs and this result to the scenario">
                <Save className="h-3.5 w-3.5" /> Save as template
              </Button>
            </>
          }
        />

        {sentToList && (
          <p className="border-b border-edge bg-surface-overlay px-4 py-2 text-xs text-slate-300">
            Added “{sentToList} — build out” to the Material planner. Set its target planet there to include
            environmental construction costs.
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Output / week" value={formatNumber(summary.targetAchievedPerWeek, 1)} />
          <Stat label="Area used" value={`${formatNumber(summary.areaUsed, 0)} / ${formatNumber(summary.availableArea, 0)}`} />
          <Stat label="Avg utilization" value={summary.averageUtilization === null ? "—" : formatPercent(summary.averageUtilization)} />
          <Stat label="Unresolved imports" value={String(summary.unresolvedImportCount)} />
        </dl>
      </Card>

      {result.warnings.length > 0 && (
        <Card>
          <CardHeader title="Warnings" description="Where the plan had to guess or fell back to incomplete data" />
          <ul className="space-y-1 p-4 text-xs text-amber-300">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Building plan" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <Th>Building</Th>
                <Th>Count</Th>
                <Th>Area</Th>
                <Th>Utilization</Th>
                <Th>Purpose</Th>
              </tr>
            </thead>
            <tbody>
              {result.buildingPlan.map((row) => (
                <tr key={`${row.buildingCode}-${row.purpose}`} className="border-b border-edge/50 last:border-0">
                  <Td>
                    <span className="font-medium text-slate-100">{row.buildingCode}</span>
                    <span className="ml-2 text-xs text-slate-500">{row.buildingName}</span>
                  </Td>
                  <Td>{row.count}</Td>
                  <Td>{formatNumber(row.totalArea, 0)}</Td>
                  <Td>{row.utilization === null ? "—" : formatPercent(row.utilization)}</Td>
                  <Td>
                    <span className="text-xs text-slate-400">{row.purpose}</span>
                    {row.status !== "planned" && <Badge tone="warn">{row.status}</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {result.imports.length > 0 && (
        <Card>
          <CardHeader title="Imports" description="What this base cannot make for itself" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <Th>Resource</Th>
                  <Th>Per day</Th>
                  <Th>Per week</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {result.imports.map((row) => (
                  <tr key={row.resource} className="border-b border-edge/50 last:border-0">
                    <Td>{row.resource}</Td>
                    <Td>{formatNumber(row.amountPerDay, 2)}</Td>
                    <Td>{formatNumber(row.amountPerWeek, 2)}</Td>
                    <Td>
                      <span className="text-xs text-slate-400">{row.reason}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-100">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2 align-top">{children}</td>;
}
