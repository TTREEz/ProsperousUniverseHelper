import { FILE_EXTENSION, serialize, suggestedFileName, type OpenedFile, type SavedFile, type StorageAdapter } from "@/storage/adapter";
import type { PuDataFile } from "@/schema/types";

/**
 * Browser storage, in two flavours.
 *
 * Chromium exposes the File System Access API, which hands back a handle we can
 * keep and write to again — so "Save" really overwrites the file the user
 * opened. Firefox and Safari have no equivalent, so there the best available
 * behaviour is upload-to-open and download-to-save, which is Save As every time.
 */

type FilePickerOptions = {
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
  suggestedName?: string;
};

type WritableStream = { write(data: string): Promise<void>; close(): Promise<void> };

type FileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStream>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (options?: FilePickerOptions & { multiple?: boolean }) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileHandle>;
};

const pickerWindow = window as PickerWindow;

export function supportsFileSystemAccess(): boolean {
  return typeof pickerWindow.showOpenFilePicker === "function" && typeof pickerWindow.showSaveFilePicker === "function";
}

const PICKER_TYPES = [
  { description: "PU Toolset save", accept: { "application/json": [FILE_EXTENSION, ".json"] } },
];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class FileSystemAccessAdapter implements StorageAdapter {
  readonly kind = "fs-access" as const;
  readonly canSaveInPlace = true;
  private handle: FileHandle | null = null;

  hasTarget(): boolean {
    return this.handle !== null;
  }

  currentName(): string | null {
    return this.handle?.name ?? null;
  }

  async open(): Promise<OpenedFile | null> {
    try {
      const [handle] = await pickerWindow.showOpenFilePicker!({ types: PICKER_TYPES, multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      const raw = JSON.parse(await file.text()) as unknown;
      this.handle = handle;
      return { raw, name: handle.name };
    } catch (error) {
      if (isAbortError(error)) return null;
      throw error;
    }
  }

  async save(data: PuDataFile): Promise<SavedFile | null> {
    if (!this.handle) return this.saveAs(data);
    const writable = await this.handle.createWritable();
    await writable.write(serialize(data));
    await writable.close();
    return { name: this.handle.name };
  }

  async saveAs(data: PuDataFile): Promise<SavedFile | null> {
    try {
      const handle = await pickerWindow.showSaveFilePicker!({
        types: PICKER_TYPES,
        suggestedName: suggestedFileName(data),
      });
      this.handle = handle;
      return this.save(data);
    } catch (error) {
      if (isAbortError(error)) return null;
      throw error;
    }
  }

  clearTarget(): void {
    this.handle = null;
  }
}

class DownloadAdapter implements StorageAdapter {
  readonly kind = "download" as const;
  readonly canSaveInPlace = false;
  private name: string | null = null;

  hasTarget(): boolean {
    return false;
  }

  currentName(): string | null {
    return this.name;
  }

  open(): Promise<OpenedFile | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = `${FILE_EXTENSION},.json,application/json`;

      // A cancelled file dialog fires no event in most browsers. Resolving on
      // window focus keeps the promise from hanging forever.
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        setTimeout(() => {
          if (!input.files?.length) resolve(null);
        }, 500);
      };
      window.addEventListener("focus", onFocus);

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try {
          const raw = JSON.parse(await file.text()) as unknown;
          this.name = file.name;
          resolve({ raw, name: file.name });
        } catch (error) {
          reject(error);
        }
      };
      input.click();
    });
  }

  async save(data: PuDataFile): Promise<SavedFile | null> {
    return this.saveAs(data);
  }

  async saveAs(data: PuDataFile): Promise<SavedFile | null> {
    const name = this.name ?? suggestedFileName(data);
    const blob = new Blob([serialize(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    this.name = name;
    return { name };
  }

  clearTarget(): void {
    this.name = null;
  }
}

export function createBrowserAdapter(): StorageAdapter {
  return supportsFileSystemAccess() ? new FileSystemAccessAdapter() : new DownloadAdapter();
}
