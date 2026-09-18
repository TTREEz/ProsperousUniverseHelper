import { produce } from "immer";
import { create } from "zustand";
import { loadAndMigrate } from "@/schema/migrate";
import { APP_VERSION, createEmptyFile } from "@/schema/defaults";
import type { PuDataFile, Scenario } from "@/schema/types";
import { storage } from "@/storage";
import { clearWorkingCopy, readWorkingCopy, saveWorkingCopy } from "@/storage/working-copy";

/**
 * The single in-memory copy of the save file, plus everything that reads or
 * writes it. Every screen goes through here; nothing else touches storage.
 */

type Status = { tone: "info" | "error"; message: string } | null;

type AppState = {
  file: PuDataFile | null;
  fileName: string | null;
  dirty: boolean;
  booted: boolean;
  status: Status;

  boot: () => Promise<void>;
  newFile: (name?: string) => Promise<void>;
  openFile: () => Promise<void>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  setStatus: (status: Status) => void;

  /** Applies an immer-style edit, marks the file dirty, and schedules autosave. */
  update: (recipe: (file: PuDataFile) => void) => void;

  setActiveScenario: (scenarioId: string) => void;
};

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(get: () => AppState) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const { file, fileName, dirty } = get();
    if (file) void saveWorkingCopy(file, fileName, !dirty);
  }, 800);
}

export const useAppStore = create<AppState>((set, get) => ({
  file: null,
  fileName: null,
  dirty: false,
  booted: false,
  status: null,

  setStatus: (status) => set({ status }),

  async boot() {
    const restored = await readWorkingCopy();
    if (restored) {
      const result = loadAndMigrate(restored.data);
      if (result.ok) {
        set({
          file: result.data,
          fileName: restored.fileName,
          dirty: !restored.clean,
          booted: true,
          status: restored.clean
            ? null
            : { tone: "info", message: "Restored unsaved changes from your last session." },
        });
        return;
      }
    }
    set({ booted: true });
  },

  async newFile(name) {
    const file = createEmptyFile(name);
    storage().clearTarget();
    set({ file, fileName: null, dirty: true, status: null });
    await saveWorkingCopy(file, null, false);
  },

  async openFile() {
    try {
      const opened = await storage().open();
      if (!opened) return;

      const result = loadAndMigrate(opened.raw);
      if (!result.ok) {
        set({ status: { tone: "error", message: `Could not open ${opened.name} — ${result.error}` } });
        return;
      }

      set({
        file: result.data,
        fileName: opened.name,
        dirty: result.migratedFrom !== null,
        status: result.migratedFrom
          ? {
              tone: "info",
              message: `Opened ${opened.name} and upgraded it from schema ${result.migratedFrom}. Save to keep the upgrade.`,
            }
          : { tone: "info", message: `Opened ${opened.name}.` },
      });
      await saveWorkingCopy(result.data, opened.name, result.migratedFrom === null);
    } catch (error) {
      set({ status: { tone: "error", message: `Could not open file — ${describe(error)}` } });
    }
  },

  async save() {
    const { file } = get();
    if (!file) return;
    try {
      const stamped = produce(file, (draft) => {
        draft.meta.updatedAt = new Date().toISOString();
        draft.meta.appVersion = APP_VERSION;
      });
      const saved = await storage().save(stamped);
      if (!saved) return;
      set({ file: stamped, fileName: saved.name, dirty: false, status: { tone: "info", message: `Saved ${saved.name}.` } });
      await saveWorkingCopy(stamped, saved.name, true);
    } catch (error) {
      set({ status: { tone: "error", message: `Could not save — ${describe(error)}` } });
    }
  },

  async saveAs() {
    const { file } = get();
    if (!file) return;
    try {
      const stamped = produce(file, (draft) => {
        draft.meta.updatedAt = new Date().toISOString();
        draft.meta.appVersion = APP_VERSION;
      });
      const saved = await storage().saveAs(stamped);
      if (!saved) return;
      set({ file: stamped, fileName: saved.name, dirty: false, status: { tone: "info", message: `Saved ${saved.name}.` } });
      await saveWorkingCopy(stamped, saved.name, true);
    } catch (error) {
      set({ status: { tone: "error", message: `Could not save — ${describe(error)}` } });
    }
  },

  update(recipe) {
    const { file } = get();
    if (!file) return;
    set({ file: produce(file, recipe), dirty: true });
    scheduleAutosave(get);
  },

  setActiveScenario(scenarioId) {
    get().update((file) => {
      file.settings.activeScenarioId = scenarioId;
    });
  },
}));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function activeScenario(file: PuDataFile | null): Scenario | null {
  if (!file) return null;
  const byId = file.scenarios.find((scenario) => scenario.id === file.settings.activeScenarioId);
  return byId ?? file.scenarios[0] ?? null;
}

export async function discardWorkingCopy(): Promise<void> {
  await clearWorkingCopy();
}
