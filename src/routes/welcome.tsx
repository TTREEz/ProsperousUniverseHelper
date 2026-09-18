import { FilePlus2, FolderOpen, Rocket } from "lucide-react";
import { Button } from "@/components/ui";
import { storageDescription } from "@/storage";
import { useAppStore } from "@/store/app-store";

export function Welcome() {
  const { newFile, openFile, status } = useAppStore();

  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <Rocket className="h-6 w-6 text-accent" />
          <h1 className="text-xl font-semibold text-slate-100">PU Toolset</h1>
        </div>

        <p className="text-sm leading-relaxed text-slate-400">
          Base optimization and production planning for Prosperous Universe. Everything you do lives in a single
          file you control — open one to pick up where you left off, or start a new one.
        </p>

        <div className="mt-6 flex gap-3">
          <Button variant="primary" onClick={() => void newFile()}>
            <FilePlus2 className="h-4 w-4" /> New file
          </Button>
          <Button onClick={() => void openFile()}>
            <FolderOpen className="h-4 w-4" /> Open file
          </Button>
        </div>

        {status && (
          <p className={status.tone === "error" ? "mt-4 text-xs text-red-300" : "mt-4 text-xs text-slate-400"}>
            {status.message}
          </p>
        )}

        <p className="mt-8 border-t border-edge pt-4 text-xs text-slate-500">{storageDescription()}</p>
      </div>
    </div>
  );
}
