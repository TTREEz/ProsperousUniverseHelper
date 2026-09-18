import { useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui";
import { cloneScenario } from "@/schema/clone";
import { createScenario } from "@/schema/defaults";
import type { Scenario } from "@/schema/types";
import { activeScenario, useAppStore } from "@/store/app-store";

export function ScenariosRoute() {
  const { file, update, setActiveScenario } = useAppStore();
  const current = activeScenario(file);
  const [name, setName] = useState("");

  if (!file) return null;

  function addScenario() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const scenario = createScenario(trimmed);
    update((draft) => {
      draft.scenarios.push(scenario);
      draft.settings.activeScenarioId = scenario.id;
    });
    setName("");
  }

  function duplicate(source: Scenario) {
    const clone = cloneScenario(source);
    update((draft) => {
      draft.scenarios.push(clone);
      draft.settings.activeScenarioId = clone.id;
    });
  }

  function remove(scenarioId: string) {
    update((draft) => {
      draft.scenarios = draft.scenarios.filter((entry) => entry.id !== scenarioId);
      if (draft.settings.activeScenarioId === scenarioId) {
        draft.settings.activeScenarioId = draft.scenarios[0]?.id ?? null;
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader
          title="Scenarios"
          description="Keep your live plan separate from drafts you are still working out."
        />
        <div className="flex gap-2 border-b border-edge p-4">
          <Input
            value={name}
            placeholder="New scenario name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addScenario()}
          />
          <Button variant="primary" onClick={addScenario} disabled={!name.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        <ul className="divide-y divide-edge/60">
          {file.scenarios.map((scenario) => {
            const isActive = scenario.id === current?.id;
            return (
              <li key={scenario.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-100">{scenario.name}</span>
                    {scenario.kind === "LIVE" && <Badge tone="good">Live</Badge>}
                    {scenario.kind === "ARCHIVED" && <Badge>Archived</Badge>}
                    {isActive && <Badge tone="accent">Active</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {scenario.planets.length} planets · {scenario.baseTemplates.length} base plans
                  </p>
                </div>

                {!isActive && (
                  <Button size="sm" variant="ghost" onClick={() => setActiveScenario(scenario.id)} title="Switch to this scenario">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => duplicate(scenario)} title="Duplicate as a draft">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {file.scenarios.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => remove(scenario.id)} title="Delete scenario">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
