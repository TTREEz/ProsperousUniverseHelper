import type { StorageAdapter } from "@/storage/adapter";
import { createBrowserAdapter } from "@/storage/browser-adapter";
import { createElectronAdapter, isDesktop } from "@/storage/electron-adapter";

let adapter: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (!adapter) adapter = isDesktop() ? createElectronAdapter() : createBrowserAdapter();
  return adapter;
}

export function storageDescription(): string {
  switch (storage().kind) {
    case "electron":
      return "Desktop — saves directly to the file you opened.";
    case "fs-access":
      return "Browser — saves directly to the file you opened.";
    case "download":
      return "Browser — this browser can only download a new copy on save. Chrome or Edge can save in place.";
  }
}

export * from "@/storage/adapter";
