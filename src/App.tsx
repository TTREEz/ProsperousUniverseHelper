import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { useAppStore } from "@/store/app-store";
import { Welcome } from "@/routes/welcome";
import { Overview } from "@/routes/overview";
import { OptimizerRoute } from "@/routes/optimizer";
import { MaterialsRoute } from "@/routes/materials";
import { PlanetsRoute } from "@/routes/planets";
import { TradeRoutesRoute } from "@/routes/trade-routes";
import { ScenariosRoute } from "@/routes/scenarios";

export default function App() {
  const { file, booted, boot } = useAppStore();

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!booted) {
    return <div className="grid h-full place-items-center text-sm text-slate-500">Loading…</div>;
  }

  if (!file) return <Welcome />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="optimizer" element={<OptimizerRoute />} />
        <Route path="materials" element={<MaterialsRoute />} />
        <Route path="planets" element={<PlanetsRoute />} />
        <Route path="trade-routes" element={<TradeRoutesRoute />} />
        <Route path="scenarios" element={<ScenariosRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
