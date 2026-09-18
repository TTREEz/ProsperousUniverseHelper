/**
 * Minimal promise wrapper over a single IndexedDB key/value store.
 *
 * Used for the autosaved working copy and the FIO reference cache. Both can be
 * several megabytes, which rules out localStorage.
 */

const DB_NAME = "pu-toolset";
const STORE = "kv";

/**
 * Some origins accept `indexedDB.open` and then never fire any event — not
 * success, not error, not blocked. A plain promise around it would hang
 * forever, and because every caller awaits this, that hang reaches app start
 * and leaves the whole UI stuck. Nothing here is important enough to block on,
 * so a stalled open is treated as "no storage available".
 */
const OPEN_TIMEOUT_MS = 3000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };

    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    const done = (db: IDBDatabase | null) => {
      clearTimeout(timer);
      finish(db);
    };

    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });

  return dbPromise;
}

export async function storageAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
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
