import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Boxes, FilePlus2, FolderOpen, Gauge, Layers, Save, Rocket } from "lucide-react";
import { Badge, Button, cn } from "@/components/ui";
import { activeScenario, useAppStore } from "@/store/app-store";
import { storageDescription } from "@/storage";

const NAV = [
  { to: "/", label: "Overview", icon: Gauge, end: true },
  { to: "/optimizer", label: "Base Optimizer", icon: Rocket, end: false },
  { to: "/planets", label: "Planets", icon: Boxes, end: false },
  { to: "/scenarios", label: "Scenarios", icon: Layers, end: false },
];

export function AppShell() {
  const { file, fileName, dirty, status, save, saveAs, openFile, newFile, setStatus } = useAppStore();
  const scenario = activeScenario(file);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void (event.shiftKey ? saveAs() : save());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, saveAs]);

  // Browsers only honour a leave-confirmation when there is genuinely unsaved
  // work, so this is gated on the dirty flag rather than always registered.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [status, setStatus]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-edge bg-surface-raised px-4 py-2">
        <div className="flex items-center gap-2 pr-2">
          <Rocket className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold tracking-tight text-slate-100">PU Toolset</span>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition",
                  isActive ? "bg-surface-overlay text-slate-100" : "text-slate-400 hover:text-slate-200",
                )
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {file && (
            <div className="mr-1 flex items-center gap-2 text-xs text-slate-400" title={storageDescription()}>
              <span className="max-w-[16rem] truncate">{fileName ?? "Unsaved file"}</span>
              {dirty ? <Badge tone="warn">Unsaved</Badge> : <Badge tone="good">Saved</Badge>}
              {scenario && <Badge tone="accent">{scenario.name}</Badge>}
            </div>
          )}
          <Button size="sm" onClick={() => void newFile()} title="Start a new save file">
            <FilePlus2 className="h-3.5 w-3.5" /> New
          </Button>
          <Button size="sm" onClick={() => void openFile()} title="Open a save file">
            <FolderOpen className="h-3.5 w-3.5" /> Open
          </Button>
          <Button size="sm" variant="primary" disabled={!file} onClick={() => void save()} title="Save (Ctrl+S)">
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </header>

      {status && (
        <div
          className={cn(
            "border-b px-4 py-2 text-xs",
            status.tone === "error"
              ? "border-red-900/60 bg-red-950/40 text-red-200"
              : "border-edge bg-surface-overlay text-slate-300",
          )}
        >
          {status.message}
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
