/**
 * Minimal promise wrapper over a single IndexedDB key/value store.
 *
 * Used for the autosaved working copy and the FIO reference cache. Both can be
 * several megabytes, which rules out localStorage.
 */

const DB_NAME = "pu-toolset";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const value = await transact<T>("readonly", (store) => store.get(key) as IDBRequest<T>);
    return value ?? null;
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    await transact("readwrite", (store) => store.put(value, key) as IDBRequest<unknown>);
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The file on
    // disk is the source of truth, so a failed mirror is not fatal.
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await transact("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
  } catch {
    // See idbSet.
  }
}
