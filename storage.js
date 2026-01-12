const DB_NAME = "teja_notes_db";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("folders")) {
        db.createObjectStore("folders", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("pages")) {
        const store = db.createObjectStore("pages", { keyPath: "id" });
        store.createIndex("by_folder", "folderId", { unique: false });
      }
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const out = fn(store);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

const Storage = {
  uid() {
    return crypto.randomUUID();
  },

  async initIfEmpty() {
    const folders = await this.getFolders();
    if (folders.length) return;

    const folderId = this.uid();
    const pageId = this.uid();

    await this.putFolder({ id: folderId, name: "My Notes", createdAt: Date.now() });
    await this.putPage({
      id: pageId,
      folderId,
      title: "Welcome",
      noteHtml: `<h2>Welcome</h2><p>This is your offline notepad.</p><ul><li>Use <b>Insert</b> to add tables, links, emojis.</li><li>Use <b>Draw</b> to sketch on top.</li></ul>`,
      todos: [{ id: this.uid(), text: "Try adding a new page", done: false }],
      drawingDataUrl: "",
      order: 0,
      updatedAt: Date.now(),
      createdAt: Date.now()
    });

    await this.kvSet("activePageId", pageId);
  },

  async kvGet(key) {
    const db = await openDB();
    return new Promise((resolve) => {
      const t = db.transaction("kv", "readonly");
      const req = t.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  },
  async kvSet(key, value) {
    return tx("kv", "readwrite", (s) => s.put({ key, value }));
  },

  async getFolders() {
    const db = await openDB();
    return new Promise((resolve) => {
      const t = db.transaction("folders", "readonly");
      const req = t.objectStore("folders").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  async putFolder(folder) {
    return tx("folders", "readwrite", (s) => s.put(folder));
  },
  async deleteFolder(folderId) {
    const pages = await this.getPagesByFolder(folderId);
    for (const p of pages) await this.deletePage(p.id);
    return tx("folders", "readwrite", (s) => s.delete(folderId));
  },

  async getPagesByFolder(folderId) {
    const db = await openDB();
    return new Promise((resolve) => {
      const t = db.transaction("pages", "readonly");
      const idx = t.objectStore("pages").index("by_folder");
      const req = idx.getAll(folderId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  async getAllPages() {
    const db = await openDB();
    return new Promise((resolve) => {
      const t = db.transaction("pages", "readonly");
      const req = t.objectStore("pages").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  async getPage(pageId) {
    const db = await openDB();
    return new Promise((resolve) => {
      const t = db.transaction("pages", "readonly");
      const req = t.objectStore("pages").get(pageId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  },
  async putPage(page) {
    page.updatedAt = Date.now();
    return tx("pages", "readwrite", (s) => s.put(page));
  },
  async deletePage(pageId) {
    return tx("pages", "readwrite", (s) => s.delete(pageId));
  },

  async exportAll() {
    const [folders, pages] = await Promise.all([this.getFolders(), this.getAllPages()]);
    return { version: 1, exportedAt: Date.now(), folders, pages };
  },

  async importAll(payload) {
    if (!payload || !Array.isArray(payload.folders) || !Array.isArray(payload.pages)) {
      throw new Error("Invalid import file.");
    }
    for (const f of payload.folders) await this.putFolder(f);
    for (const p of payload.pages) await this.putPage(p);
  }
};
