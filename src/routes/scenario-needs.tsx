import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, EmptyState, cn } from "@/components/ui";
import { formatNumber } from "@/lib/formats";
import { buildScenarioBalance } from "@/planner/scenario-balance";
import { prosperousProvider } from "@/provider/fio-provider";
import type { PopulationCounts, WorkforceNeed } from "@/provider/types";
import type { Scenario } from "@/schema/types";

/**
 * Every base in a scenario side by side, per material.
 *
 * The question this answers is not what one planet needs — the planet screen
 * already says that — but whether the planets that make something still cover
 * the ones that consume it. Adding a base is the usual way that stops being
 * true: the planet feeding everyone has a surplus right up until it does not.
 *
 * Figures are per week and already account for trade routes, so a planet that
 * ships its output away shows what is left after shipping, not before.
 */
export function ScenarioNeeds({ scenario }: { scenario: Scenario }) {
  const [workforceByBuilding, setWorkforceByBuilding] = useState<Map<string, PopulationCounts>>(new Map());
  const [needs, setNeeds] = useState<WorkforceNeed[]>([]);
  const [loading, setLoading] = useState(true);

  const buildingCodes = useMemo(
    () =>
      [
        ...new Set(
          scenario.planets.flatMap((planet) =>
            planet.factories.map((factory) => factory.buildingCode.trim().toUpperCase()),
          ),
        ),
      ]
        .sort()
        .join(","),
    [scenario.planets],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const codes = buildingCodes ? buildingCodes.split(",") : [];

    Promise.all([
      Promise.all(
        codes.map(async (code) => {
          const workforce = await prosperousProvider.getBuildingWorkforceRequirements(code).catch(() => null);
          return [
            code,
            workforce ?? { pioneers: 0, settlers: 0, technicians: 0, engineers: 0, scientists: 0 },
          ] as const;
        }),
      ),
      prosperousProvider.getWorkforceNeeds().catch(() => ({ needs: [], source: "fallback" as const })),
    ]).then(([workforceEntries, needsResult]) => {
      if (cancelled) return;
      setWorkforceByBuilding(new Map(workforceEntries));
      setNeeds(needsResult.needs);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [buildingCodes]);

  const balance = useMemo(
    () => buildScenarioBalance(scenario, workforceByBuilding, needs),
    [scenario, workforceByBuilding, needs],
  );

  const short = balance.materials.filter((row) => row.netShortfall > 0);
  const movable = balance.materials.filter((row) => row.netShortfall === 0 && row.totalShortfall > 0);

  return (
    <Card>
      <CardHeader
        title="Supply and demand across your bases"
        description="Per week, after trade routes. Green is spare, amber is short."
      />

      {loading && <div className="px-4 py-6 text-sm text-slate-500">Working out each base…</div>}

      {!loading && balance.materials.length === 0 && (
        <EmptyState title="Nothing produced or consumed yet">
          Add buildings and production to your planets and this fills in.
        </EmptyState>
      )}

      {!loading && balance.materials.length > 0 && (
        <>
          <div className="flex flex-wrap gap-4 border-b border-edge px-4 py-3 text-xs">
            <span className="text-slate-400">
              <span className="font-medium text-amber-300">{short.length}</span> to buy in
            </span>
            <span className="text-slate-400">
              <span className="font-medium text-emerald-300">{movable.length}</span> covered by another base
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-edge text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Material</th>
                  {balance.planets.map((planet) => (
                    <th key={planet.planetId} className="px-3 py-2 text-right font-medium">
                      {planet.planetName}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">Across all</th>
                </tr>
              </thead>
              <tbody>
                {balance.materials.map((row) => (
                  <tr key={row.ticker} className="border-b border-edge/40 last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-100">{row.ticker}</td>

                    {balance.planets.map((planet) => {
                      const value = row.byPlanet[planet.planetId];
                      return (
                        <td
                          key={planet.planetId}
                          className={cn(
                            "px-3 py-2 text-right",
                            value === undefined && "text-slate-700",
                            value !== undefined && value > 0 && "text-emerald-300",
                            value !== undefined && value < 0 && "text-amber-300",
                          )}
                        >
                          {value === undefined ? "·" : formatNumber(value, 1)}
                        </td>
                      );
                    })}

                    <td className="px-4 py-2 text-right">
                      {row.netShortfall > 0 ? (
                        <span className="font-medium text-amber-300" title="No base makes enough of this">
                          buy {formatNumber(row.netShortfall, 1)}
                        </span>
                      ) : row.totalShortfall > 0 ? (
                        <span
                          className="text-emerald-300"
                          title={`Covered from within: ${formatNumber(row.totalSurplus, 1)} spare against ${formatNumber(row.totalShortfall, 1)} needed`}
                        >
                          covered, {formatNumber(row.totalSurplus - row.totalShortfall, 1)} spare
                        </span>
                      ) : (
                        <span className="text-slate-500">{formatNumber(row.totalSurplus, 1)} spare</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="px-4 py-3 text-xs text-slate-600">
            A material shows “covered” when the bases making it out-produce the ones consuming it. Spare is the
            headroom left — how much more demand the supplying base can take before you have to buy any.
          </p>
        </>
      )}
    </Card>
  );
}
