import { idbDelete, idbGet, idbSet } from "@/storage/idb";
import type { PuDataFile } from "@/schema/types";

/**
 * A mirror of the in-memory state, so closing the tab or crashing does not lose
 * unsaved edits. This is a safety net, not storage: the file on disk stays the
 * source of truth, and the app always tells the user when the two differ.
 */

const KEY = "working-copy";

type StoredWorkingCopy = {
  data: PuDataFile;
  savedAt: string;
  /** Name of the file this was last read from or written to, if any. */
  fileName: string | null;
  /** False when there are edits that have not been written to the file. */
  clean: boolean;
};

export function saveWorkingCopy(data: PuDataFile, fileName: string | null, clean: boolean): Promise<void> {
  const payload: StoredWorkingCopy = { data, savedAt: new Date().toISOString(), fileName, clean };
  return idbSet(KEY, payload);
}

export function readWorkingCopy(): Promise<StoredWorkingCopy | null> {
  return idbGet<StoredWorkingCopy>(KEY);
}

export function clearWorkingCopy(): Promise<void> {
  return idbDelete(KEY);
}
