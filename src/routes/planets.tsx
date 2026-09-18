import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { PlanetProduction } from "@/routes/planet-production";
import { createPlanet, newId } from "@/schema/defaults";
import type { Planet } from "@/schema/types";
import { activeScenario, useAppStore } from "@/store/app-store";

export function PlanetsRoute() {
  const { file, update } = useAppStore();
  const scenario = activeScenario(file);
  const [name, setName] = useState("");
  const [systemName, setSystemName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!scenario) return null;
  const scenarioId = scenario.id;
  const selected = scenario.planets.find((planet) => planet.id === selectedId) ?? scenario.planets[0] ?? null;

  function addSystem() {
    const trimmed = systemName.trim();
    if (!trimmed) return;
    update((draft) => {
      draft.scenarios
        .find((entry) => entry.id === scenarioId)
        ?.systems.push({ id: newId(), name: trimmed, fioSystemNaturalId: null, notes: null });
    });
    setSystemName("");
  }

  function removeSystem(systemId: string) {
    update((draft) => {
      const target = draft.scenarios.find((entry) => entry.id === scenarioId);
      if (!target) return;
      target.systems = target.systems.filter((system) => system.id !== systemId);
      // Deleting a system must not take its planets with it.
      for (const planet of target.planets) {
        if (planet.systemId === systemId) planet.systemId = null;
      }
      for (const pkg of target.expansionPackages) {
        if (pkg.systemId === systemId) pkg.systemId = null;
      }
    });
  }

  const grouped = [
    ...scenario.systems.map((system) => ({
      key: system.id,
      label: system.name,
      planets: scenario.planets.filter((planet) => planet.systemId === system.id),
    })),
    {
      key: "unassigned",
      label: "Unassigned",
      planets: scenario.planets.filter((planet) => planet.systemId === null),
    },
  ].filter((group) => group.planets.length > 0 || group.key !== "unassigned");

  function addPlanet() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const planet = createPlanet(trimmed);
    // Most people type the natural id or the exact planet name, and both
    // resolve against FIO, so seed it rather than making them type it twice.
    planet.fioPlanetNaturalId = trimmed;
    update((draft) => {
      draft.scenarios.find((entry) => entry.id === scenarioId)?.planets.push(planet);
    });
    setSelectedId(planet.id);
    setName("");
  }

  function removePlanet(planetId: string) {
    update((draft) => {
      const target = draft.scenarios.find((entry) => entry.id === scenarioId);
      if (!target) return;
      target.planets = target.planets.filter((planet) => planet.id !== planetId);
      target.tradeRoutes = target.tradeRoutes.filter(
        (route) => route.fromPlanetId !== planetId && route.toPlanetId !== planetId,
      );
      for (const pkg of target.expansionPackages) {
        if (pkg.targetPlanetId === planetId) pkg.targetPlanetId = null;
      }
    });
    setSelectedId(null);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader
          title="Systems"
          description="Group planets so trade routes can tell an in-system hop from an interstellar one."
        />
        <div className="flex gap-2 border-b border-edge p-4">
          <Input
            value={systemName}
            placeholder="System name, e.g. Moria"
            onChange={(event) => setSystemName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addSystem()}
          />
          <Button variant="primary" onClick={addSystem} disabled={!systemName.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {scenario.systems.length === 0 ? (
          <EmptyState title="No systems yet">
            Without systems every route is left unlabelled, because two unassigned planets could be anywhere.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-edge/60">
            {scenario.systems.map((system) => {
              const count = scenario.planets.filter((planet) => planet.systemId === system.id).length;
              return (
                <li key={system.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <input
                    className="flex-1 bg-transparent text-slate-100 outline-none focus:underline"
                    value={system.name}
                    onChange={(event) =>
                      update((draft) => {
                        const found = draft.scenarios
                          .find((entry) => entry.id === scenarioId)
                          ?.systems.find((entry) => entry.id === system.id);
                        if (found) found.name = event.target.value;
                      })
                    }
                  />
                  <span className="text-xs text-slate-500">
                    {count} {count === 1 ? "planet" : "planets"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeSystem(system.id)}
                    title="Delete system — its planets stay, just unassigned"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Planets" description={`In scenario “${scenario.name}”`} />
        <div className="flex gap-2 border-b border-edge p-4">
          <Input
            value={name}
            placeholder="Planet name or natural id, e.g. Montem or OT-580b"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addPlanet()}
          />
          <Button variant="primary" onClick={addPlanet} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {scenario.planets.length === 0 ? (
          <EmptyState title="No planets yet">
            Add a planet, then record what is built on it so shopping lists know what you already have.
          </EmptyState>
        ) : (
          <div className="space-y-3 p-4">
            {grouped.map((group) => (
              <div key={group.key}>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-slate-500">{group.label}</p>
                {group.planets.length === 0 ? (
                  <p className="text-xs text-slate-600">No planets assigned yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {group.planets.map((planet) => (
                      <button
                        key={planet.id}
                        onClick={() => setSelectedId(planet.id)}
                        className={
                          planet.id === selected?.id
                            ? "rounded border border-accent bg-accent/15 px-3 py-1.5 text-sm text-accent"
                            : "rounded border border-edge px-3 py-1.5 text-sm text-slate-300 hover:border-edge-strong"
                        }
                      >
                        {planet.name}
                        <span className="ml-2 text-xs opacity-70">{planet.factories.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <PlanetDetail
          key={selected.id}
          planet={selected}
          scenarioId={scenarioId}
          onDelete={() => removePlanet(selected.id)}
        />
      )}
    </div>
  );
}

function PlanetDetail({
  planet,
  scenarioId,
  onDelete,
}: {
  planet: Planet;
  scenarioId: string;
  onDelete: () => void;
}) {
  const { file, update } = useAppStore();
  const scenario = file?.scenarios.find((entry) => entry.id === scenarioId) ?? null;

  const [buildingCode, setBuildingCode] = useState("");
  const [count, setCount] = useState(1);

  function editPlanet(recipe: (target: Planet) => void) {
    update((draft) => {
      const target = draft.scenarios
        .find((entry) => entry.id === scenarioId)
        ?.planets.find((entry) => entry.id === planet.id);
      if (target) recipe(target);
    });
  }

  function addBuilding() {
    const code = buildingCode.trim().toUpperCase();
    if (!code || count <= 0) return;
    editPlanet((target) => {
      const existing = target.factories.find((factory) => factory.buildingCode === code);
      if (existing) {
        existing.count += count;
      } else {
        target.factories.push({ id: newId(), buildingCode: code, count, efficiency: 1, notes: null });
      }
    });
    setBuildingCode("");
    setCount(1);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={planet.name}
          description="What is already built here. Shopping lists use this to work out what is still missing."
          actions={
            <Button size="sm" variant="ghost" onClick={onDelete} title="Delete planet">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          }
        />

        <div className="grid gap-4 border-b border-edge p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name">
            <Input
              value={planet.name}
              onChange={(event) =>
                editPlanet((target) => {
                  target.name = event.target.value;
                })
              }
            />
          </Field>

          <Field label="FIO id" hint="Natural id or name used for lookups">
            <Input
              value={planet.fioPlanetNaturalId ?? ""}
              placeholder="OT-580b"
              onChange={(event) =>
                editPlanet((target) => {
                  target.fioPlanetNaturalId = event.target.value || null;
                })
              }
            />
          </Field>

          <Field label="System">
            <Select
              value={planet.systemId ?? ""}
              onChange={(event) =>
                editPlanet((target) => {
                  target.systemId = event.target.value || null;
                })
              }
            >
              <option value="">Unassigned</option>
              {scenario?.systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Buy exchange" hint="e.g. NC1, AI1">
            <Input
              value={planet.defaultBuyExchangeCode ?? ""}
              onChange={(event) =>
                editPlanet((target) => {
                  target.defaultBuyExchangeCode = event.target.value.toUpperCase() || null;
                })
              }
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-edge p-4">
          <Field label="Building code">
            <Input
              value={buildingCode}
              placeholder="FRM"
              onChange={(event) => setBuildingCode(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addBuilding()}
            />
          </Field>
          <Field label="How many">
            <Input type="number" min={1} value={count} onChange={(event) => setCount(Number(event.target.value) || 0)} />
          </Field>
          <Button variant="primary" onClick={addBuilding} disabled={!buildingCode.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add building
          </Button>
        </div>

        {planet.factories.length === 0 ? (
          <EmptyState title="No buildings recorded">
            Add what you have built here. A shopping list set to “total to reach” will subtract these.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-edge/60">
            {planet.factories.map((factory) => (
              <li key={factory.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Badge tone="accent">{factory.buildingCode}</Badge>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  count
                  <input
                    type="number"
                    min={0}
                    value={factory.count}
                    onChange={(event) =>
                      editPlanet((target) => {
                        const found = target.factories.find((entry) => entry.id === factory.id);
                        if (found) found.count = Number(event.target.value) || 0;
                      })
                    }
                    className="w-16 rounded border border-edge bg-surface px-2 py-1 text-sm text-slate-100"
                  />
                </label>

                <span className="text-xs text-slate-600" title="Each building is one production slot">
                  = {factory.count} {factory.count === 1 ? "slot" : "slots"}
                </span>

                <label className="flex items-center gap-2 text-xs text-slate-500">
                  eff
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={factory.efficiency}
                    onChange={(event) =>
                      editPlanet((target) => {
                        const found = target.factories.find((entry) => entry.id === factory.id);
                        if (found) found.efficiency = Number(event.target.value) || 0;
                      })
                    }
                    className="w-20 rounded border border-edge bg-surface px-2 py-1 text-sm text-slate-100"
                  />
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    editPlanet((target) => {
                      target.factories = target.factories.filter((entry) => entry.id !== factory.id);
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

      {scenario && <Card><PlanetProduction planet={planet} scenario={scenario} /></Card>}
    </div>
  );
}
