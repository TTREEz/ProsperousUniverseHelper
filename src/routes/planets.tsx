import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Input } from "@/components/ui";
import { createPlanet } from "@/schema/defaults";
import { activeScenario, useAppStore } from "@/store/app-store";

export function PlanetsRoute() {
  const { file, update } = useAppStore();
  const scenario = activeScenario(file);
  const [name, setName] = useState("");

  if (!scenario) return null;
  const scenarioId = scenario.id;

  function addPlanet() {
    const trimmed = name.trim();
    if (!trimmed) return;
    update((draft) => {
      draft.scenarios.find((entry) => entry.id === scenarioId)?.planets.push(createPlanet(trimmed));
    });
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
    });
  }

  function renamePlanet(planetId: string, next: string) {
    update((draft) => {
      const planet = draft.scenarios
        .find((entry) => entry.id === scenarioId)
        ?.planets.find((entry) => entry.id === planetId);
      if (planet) planet.name = next;
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader title="Planets" description={`In scenario “${scenario.name}”`} />
        <div className="flex gap-2 border-b border-edge p-4">
          <Input
            value={name}
            placeholder="Planet name or natural id"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addPlanet()}
          />
          <Button variant="primary" onClick={addPlanet} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {scenario.planets.length === 0 ? (
          <EmptyState title="No planets yet">
            Add a planet to start tracking its factories, production and imports.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-edge/60">
            {scenario.planets.map((planet) => (
              <li key={planet.id} className="flex items-center gap-3 px-4 py-2">
                <input
                  className="flex-1 bg-transparent text-sm text-slate-100 outline-none focus:underline"
                  value={planet.name}
                  onChange={(event) => renamePlanet(planet.id, event.target.value)}
                />
                <span className="text-xs text-slate-500">
                  {planet.factories.length} factories · {planet.produced.length} produced
                </span>
                <Button size="sm" variant="ghost" onClick={() => removePlanet(planet.id)} title="Delete planet">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
