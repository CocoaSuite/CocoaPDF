// Crash recovery: the working copy of each edited document is kept in this
// browser's IndexedDB (never uploaded), and removed when the tab is closed.

export interface RecoveryEntry {
  key: string;
  name: string;
  bytes: Uint8Array;
  savedAt: number;
}

const DB = "cocoapdf";
const STORE = "recovery";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
      }),
  );
}

export const recovery = {
  put: (e: RecoveryEntry) => tx("readwrite", (s) => s.put(e)).then(() => undefined),
  remove: (key: string) => tx("readwrite", (s) => s.delete(key)).then(() => undefined),
  list: () => tx<RecoveryEntry[]>("readonly", (s) => s.getAll() as IDBRequest<RecoveryEntry[]>).then((l) => l.sort((a, b) => b.savedAt - a.savedAt)),
  clear: () => tx("readwrite", (s) => s.clear()).then(() => undefined),
};
