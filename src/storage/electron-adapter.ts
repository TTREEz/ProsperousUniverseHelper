import { serialize, suggestedFileName, type OpenedFile, type SavedFile, type StorageAdapter } from "@/storage/adapter";
import type { PuDataFile } from "@/schema/types";

type DesktopFile = { text: string; filePath: string; name: string };
type DesktopSave = { filePath: string; name: string };

type DesktopBridge = {
  open(): Promise<DesktopFile | null>;
  save(filePath: string, text: string): Promise<DesktopSave>;
  saveAs(suggestedName: string, text: string): Promise<DesktopSave | null>;
};

declare global {
  interface Window {
    puDesktop?: DesktopBridge;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && typeof window.puDesktop !== "undefined";
}

class ElectronAdapter implements StorageAdapter {
  readonly kind = "electron" as const;
  readonly canSaveInPlace = true;
  private filePath: string | null = null;
  private name: string | null = null;

  private get bridge(): DesktopBridge {
    const bridge = window.puDesktop;
    if (!bridge) throw new Error("Desktop bridge unavailable.");
    return bridge;
  }

  hasTarget(): boolean {
    return this.filePath !== null;
  }

  currentName(): string | null {
    return this.name;
  }

  async open(): Promise<OpenedFile | null> {
    const result = await this.bridge.open();
    if (!result) return null;
    const raw = JSON.parse(result.text) as unknown;
    this.filePath = result.filePath;
    this.name = result.name;
    return { raw, name: result.name };
  }

  async save(data: PuDataFile): Promise<SavedFile | null> {
    if (!this.filePath) return this.saveAs(data);
    const result = await this.bridge.save(this.filePath, serialize(data));
    this.name = result.name;
    return { name: result.name };
  }

  async saveAs(data: PuDataFile): Promise<SavedFile | null> {
    const result = await this.bridge.saveAs(suggestedFileName(data), serialize(data));
    if (!result) return null;
    this.filePath = result.filePath;
    this.name = result.name;
    return { name: result.name };
  }

  clearTarget(): void {
    this.filePath = null;
    this.name = null;
  }
}

export function createElectronAdapter(): StorageAdapter {
  return new ElectronAdapter();
}
