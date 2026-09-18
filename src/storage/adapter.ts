import type { PuDataFile } from "@/schema/types";

export type OpenedFile = {
  /** Raw parsed JSON. The caller validates and migrates it. */
  raw: unknown;
  name: string;
};

export type SavedFile = { name: string };

/**
 * How the app reads and writes the user's save file. Each runtime target
 * implements this differently, and nothing above this layer knows which one is
 * in play.
 */
export interface StorageAdapter {
  readonly kind: "electron" | "fs-access" | "download";

  /** True when `save` can write without showing a dialog every time. */
  readonly canSaveInPlace: boolean;

  /** True once a save target exists, so `save` will not prompt. */
  hasTarget(): boolean;

  /** Name of the currently open file, if any. */
  currentName(): string | null;

  /** Returns null when the user cancels. */
  open(): Promise<OpenedFile | null>;

  /** Writes to the current target, prompting only if there isn't one. */
  save(data: PuDataFile): Promise<SavedFile | null>;

  /** Always prompts for a destination. */
  saveAs(data: PuDataFile): Promise<SavedFile | null>;

  /** Forgets the current target, e.g. after starting a new file. */
  clearTarget(): void;
}

export function serialize(data: PuDataFile): string {
  return JSON.stringify(data, null, 2);
}

export const FILE_EXTENSION = ".pu.json";

export function suggestedFileName(data: PuDataFile): string {
  const base = data.meta.name.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "pu-save";
  return `${base}${FILE_EXTENSION}`;
}
