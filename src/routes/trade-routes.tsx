import { useMemo, useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { formatNumber } from "@/lib/formats";
import { newId } from "@/schema/defaults";
import type { TradeRoute } from "@/schema/types";
import { activeScenario, useAppStore } from "@/store/app-store";

export function TradeRoutesRoute() {
  const { file, update } = useAppStore();
  const scenario = activeScenario(file);

  const [fromPlanetId, setFromPlanetId] = useState("");
  const [toPlanetId, setToPlanetId] = useState("");
  const [resource, setResource] = useState("");
  const [amountPerWeek, setAmountPerWeek] = useState(0);

  const planetsById = useMemo(
    () => new Map((scenario?.planets ?? []).map((planet) => [planet.id, planet])),
    [scenario?.planets],
  );

  // Net movement per material, so it is obvious what the routes actually do.
  const netByResource = useMemo(() => {
    const totals = new Map<string, { out: number; in: number }>();
    for (const route of scenario?.tradeRoutes ?? []) {
      if (!route.enabled) continue;
      const entry = totals.get(route.resource) ?? { out: 0, in: 0 };
      entry.out += route.amountPerWeek;
      entry.in += route.amountPerWeek;
      totals.set(route.resource, entry);
    }
    return totals;
  }, [scenario?.tradeRoutes]);

  if (!scenario) return null;
  const scenarioId = scenario.id;
  const planets = scenario.planets;

  function addRoute() {
    const ticker = resource.trim().toUpperCase();
    if (!fromPlanetId || !toPlanetId || !ticker || amountPerWeek <= 0) return;
    if (fromPlanetId === toPlanetId) return;

    update((draft) => {
      draft.scenarios
        .find((entry) => entry.id === scenarioId)
        ?.tradeRoutes.push({
          id: newId(),
          fromPlanetId,
          toPlanetId,
          resource: ticker,
          amountPerWeek,
          enabled: true,
          notes: null,
        });
    });
    setResource("");
    setAmountPerWeek(0);
  }

  function editRoutes(recipe: (routes: TradeRoute[]) => void) {
    update((draft) => {
      const target = draft.scenarios.find((entry) => entry.id === scenarioId);
      if (target) recipe(target.tradeRoutes);
    });
  }

  // Null when either planet has no system assigned: two unassigned planets are
  // unknown, not proof of an interstellar hop.
  const sameSystem = (fromId: string, toId: string): boolean | null => {
    const from = planetsById.get(fromId);
    const to = planetsById.get(toId);
    if (!from?.systemId || !to?.systemId) return null;
    return from.systemId === to.systemId;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Card>
        <CardHeader
          title="Trade routes"
          description="Recurring transfers between your planets, so production figures account for what arrives and leaves."
        />

        {planets.length < 2 ? (
          <EmptyState title="Add at least two planets first">
            Trade routes move materials between planets in this scenario.
          </EmptyState>
        ) : (
          <div className="grid gap-3 border-b border-edge p-4 sm:grid-cols-5">
            <Field label="From">
              <Select value={fromPlanetId} onChange={(event) => setFromPlanetId(event.target.value)}>
                <option value="">Select…</option>
                {planets.map((planet) => (
                  <option key={planet.id} value={planet.id}>
                    {planet.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="To">
              <Select value={toPlanetId} onChange={(event) => setToPlanetId(event.target.value)}>
                <option value="">Select…</option>
                {planets
                  .filter((planet) => planet.id !== fromPlanetId)
                  .map((planet) => (
                    <option key={planet.id} value={planet.id}>
                      {planet.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="Material">
              <Input
                value={resource}
                placeholder="RAT"
                onChange={(event) => setResource(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && addRoute()}
              />
            </Field>

            <Field label="Per week">
              <Input
                type="number"
                min={0}
                value={amountPerWeek}
                onChange={(event) => setAmountPerWeek(Number(event.target.value) || 0)}
              />
            </Field>

            <div className="flex items-end">
              <Button
                variant="primary"
                className="w-full"
                onClick={addRoute}
                disabled={!fromPlanetId || !toPlanetId || !resource.trim() || amountPerWeek <= 0}
              >
                <Plus className="h-3.5 w-3.5" /> Add route
              </Button>
            </div>
          </div>
        )}

        {scenario.tradeRoutes.length === 0 ? (
          <EmptyState title="No routes yet">
            Add the transfers you run regularly between your planets.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-edge/60">
            {scenario.tradeRoutes.map((route) => {
              const from = planetsById.get(route.fromPlanetId);
              const to = planetsById.get(route.toPlanetId);
              const orphaned = !from || !to;

              return (
                <li key={route.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={route.enabled}
                    title={route.enabled ? "Route is active" : "Route is paused"}
                    onChange={(event) =>
                      editRoutes((routes) => {
                        const found = routes.find((entry) => entry.id === route.id);
                        if (found) found.enabled = event.target.checked;
                      })
                    }
                  />

                  <Badge tone="accent">{route.resource}</Badge>

                  <span className={orphaned ? "text-red-300" : "text-slate-200"}>
                    {from?.name ?? "missing planet"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-600" />
                  <span className={orphaned ? "text-red-300" : "text-slate-200"}>{to?.name ?? "missing planet"}</span>

                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="number"
                      min={0}
                      value={route.amountPerWeek}
                      onChange={(event) =>
                        editRoutes((routes) => {
                          const found = routes.find((entry) => entry.id === route.id);
                          if (found) found.amountPerWeek = Number(event.target.value) || 0;
                        })
                      }
                      className="w-24 rounded border border-edge bg-surface px-2 py-1 text-right text-sm text-slate-100"
                    />
                    / week
                  </label>

                  {!orphaned &&
                    (() => {
                      const within = sameSystem(route.fromPlanetId, route.toPlanetId);
                      if (within === null) return null;
                      return <Badge>{within ? "In system" : "Interstellar"}</Badge>;
                    })()}
                  {!route.enabled && <Badge tone="warn">Paused</Badge>}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() =>
                      editRoutes((routes) => {
                        const index = routes.findIndex((entry) => entry.id === route.id);
                        if (index >= 0) routes.splice(index, 1);
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
      </Card>

      {netByResource.size > 0 && (
        <Card>
          <CardHeader title="Weekly movement" description="Totals across every active route" />
          <ul className="grid gap-2 p-4 sm:grid-cols-3">
            {[...netByResource.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([ticker, totals]) => (
                <li key={ticker} className="flex items-center justify-between rounded border border-edge px-3 py-2">
                  <span className="font-medium text-slate-100">{ticker}</span>
                  <span className="text-sm text-slate-400">{formatNumber(totals.out, 0)} / week</span>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
