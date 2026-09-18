import { useState } from "react";
import { Play, Save, ShoppingCart } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { formatNumber, formatPercent } from "@/lib/formats";
import { optimizeBase } from "@/optimizer/optimize";
import type { OptimizedBaseResult } from "@/optimizer/types";
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

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizedBaseResult | null>(null);
  const [sentToList, setSentToList] = useState<string | null>(null);

  const canRun = planetCode.trim().length > 0 && targetProduct.trim().length > 0 && !running;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const output = await optimizeBase(
        {
          planetCode: planetCode.trim().toUpperCase(),
          availableArea,
          objectiveType,
          targetProduct: targetProduct.trim().toUpperCase(),
          targetAmount: targetAmount === "" ? null : targetAmount,
          targetPeriod: objectiveType === "CLOSEST_TO_TARGET" ? targetPeriod : null,
          selectedWorkforceInHouseResources: inHouse,
          selectedRecipeOverrides: {},
          excludedRecipes: [],
        },
        prosperousProvider,
      );
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
        selectedWorkforceInHouseResources: inHouse,
        selectedRecipeOverrides: {},
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
            <Input
              value={targetProduct}
              onChange={(event) => setTargetProduct(event.target.value)}
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
        <OptimizerResult
          result={result}
          onSave={saveAsTemplate}
          onSendToShoppingList={sendToShoppingList}
          canSave={Boolean(scenario)}
          sentToList={sentToList}
        />
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
