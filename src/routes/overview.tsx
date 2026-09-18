import { Link } from "react-router-dom";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { storageDescription } from "@/storage";
import { activeScenario, useAppStore } from "@/store/app-store";

export function Overview() {
  const { file, fileName } = useAppStore();
  const scenario = activeScenario(file);
  if (!file) return null;

  const planets = scenario?.planets.length ?? 0;
  const templates = scenario?.baseTemplates.length ?? 0;
  const routes = scenario?.tradeRoutes.length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader title={file.meta.name} description={fileName ? `Open from ${fileName}` : "Not saved to a file yet"} />
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Scenarios" value={file.scenarios.length} />
          <Stat label="Planets" value={planets} />
          <Stat label="Saved base plans" value={templates} />
          <Stat label="Trade routes" value={routes} />
        </dl>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Start here" />
          <ul className="space-y-2 p-4 text-sm text-slate-400">
            <li>
              <Link className="text-accent hover:underline" to="/optimizer">
                Base Optimizer
              </Link>{" "}
              — work out what to build on a planet within an area budget.
            </li>
            <li>
              <Link className="text-accent hover:underline" to="/planets">
                Planets
              </Link>{" "}
              — track what each planet actually produces and needs.
            </li>
            <li>
              <Link className="text-accent hover:underline" to="/scenarios">
                Scenarios
              </Link>{" "}
              — keep a live plan alongside drafts you are still thinking about.
            </li>
          </ul>
        </Card>

        <Card>
          <CardHeader title="Your data" />
          <div className="space-y-2 p-4 text-sm text-slate-400">
            <p>{storageDescription()}</p>
            <p className="text-xs text-slate-500">
              Everything lives in one file. Copy it to another machine and the app picks up exactly where you left
              off — there is no account and no server holding anything back.
            </p>
          </div>
        </Card>
      </div>

      {planets === 0 && templates === 0 && (
        <Card>
          <EmptyState title="Nothing in this scenario yet">
            Generate a base plan in the optimizer, or add a planet to start tracking production.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-100">{value}</dd>
    </div>
  );
}
