let state = {
  folders: [],
  pagesByFolder: new Map(),
  activePage: null,
  activeView: "note",
  drawMode: false,
  rulerOn: false,
  query: "",
  themeMode: "system",
  sidebarHidden: false,
  sidebarWidth: 300,
  collapsedFolders: new Set(),
  selectedFolderId: null,
  drag: { pageId: null, fromFolderId: null },
  selectedSymbol: null,
  selectedEmoji: null,
  selectedEmojiCategory: "smileys",
  editingLink: null
};

const el = (id) => document.getElementById(id);

function debounce(fn, ms=400){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------------- Sidebar divider resize ---------------- */

function initSidebarDivider() {
  const divider = el("sidebar-divider");
  const sidebar = el("sidebar");
  if (!divider || !sidebar) return;

  let isResizing = false;

  divider.addEventListener("mousedown", (e) => {
    isResizing = true;
    divider.classList.add("dragging");
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(150, Math.min(600, e.clientX));
    sidebar.style.width = newWidth + "px";
    state.sidebarWidth = newWidth;
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      divider.classList.remove("dragging");
      Storage.kvSet("sidebarWidth", state.sidebarWidth).catch(()=>{});
    }
  });

  document.addEventListener("selectstart", (e) => {
    if (isResizing) e.preventDefault();
  });
}

/* ---------------- Toast ---------------- */

function toast(msg, ms=1600){
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => t.classList.add("hidden"), ms);
}

window.addEventListener("teja-toast", (e) => { if (e?.detail) toast(String(e.detail)); });

/* ---------------- Modal (single input) ---------------- */

function openModal({
  title,
  message = "",
  label = "Name",
  value = "",
  placeholder = "",
  okText = "Save",
  cancelText = "Cancel",
  altText = "",
  showInput = true
}) {
  return new Promise((resolve) => {
    const modal = el("modal");
    const titleEl = el("modal-title");
    const msgEl = el("modal-msg");
    const field = el("modal-field");
    const labelEl = el("modal-label");
    const input = el("modal-input");
    const ok = el("modal-ok");
    const cancel = el("modal-cancel");
    const alt = el("modal-alt");

    titleEl.textContent = title;
    msgEl.textContent = message;

    field.style.display = showInput ? "flex" : "none";
    labelEl.textContent = label;
    input.value = value || "";
    input.placeholder = placeholder || "";

    ok.textContent = okText;
    cancel.textContent = cancelText;

    if (altText) {
      alt.textContent = altText;
      alt.classList.remove("hidden");
    } else {
      alt.classList.add("hidden");
    }

    const cleanup = () => {
      ok.onclick = null;
      cancel.onclick = null;
      alt.onclick = null;
      modal.onclick = null;
      window.onkeydown = null;
    };

    const close = (val) => {
      modal.classList.add("hidden");
      cleanup();
      resolve(val);
    };

    ok.onclick = () => {
      if (showInput) {
        const v = input.value.trim();
        if (!v) return;
        close({ action: "ok", value: v });
      } else {
        close({ action: "ok", value: true });
      }
    };

    cancel.onclick = () => close({ action: "cancel", value: null });
    alt.onclick = () => close({ action: "alt", value: null });

    modal.onclick = (e) => {
      if (e.target === modal) close({ action: "dismiss", value: null });
    };

    window.onkeydown = (e) => {
      if (e.key === "Escape") close({ action: "dismiss", value: null });
      if (e.key === "Enter") ok.click();
    };

    modal.classList.remove("hidden");
    if (showInput) {
      input.focus();
      input.select();
    }
  });
}

async function confirmModal(title, message, confirmText="Confirm") {
  const res = await openModal({
    title,
    message,
    showInput: false,
    okText: confirmText,
    cancelText: "Cancel"
  });
  return res.action === "ok";
}

/* ---------------- Theme ---------------- */

function applyThemeMode(mode) {
  state.themeMode = mode;
  const root = document.documentElement;

  const applyResolved = (resolved) => root.setAttribute("data-theme", resolved);

  if (applyThemeMode._mql) applyThemeMode._mql.onchange = null;

  if (mode === "light" || mode === "dark") {
    applyResolved(mode);
  } else {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    applyThemeMode._mql = mql;
    applyResolved(mql.matches ? "dark" : "light");
    mql.onchange = () => applyResolved(mql.matches ? "dark" : "light");
  }

  Storage.kvSet("themeMode", mode).catch(()=>{});
  updateThemeChecks();
}

function updateThemeChecks() {
  document.querySelectorAll(".radio[data-theme]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.theme === state.themeMode);
  });
}

/* ---------------- Sidebar toggle ---------------- */

function setSidebarHidden(hidden) {
  state.sidebarHidden = hidden;
  document.body.classList.toggle("sidebar-hidden", hidden);
  Storage.kvSet("sidebarHidden", hidden).catch(()=>{});
}

function toggleSidebar() {
  setSidebarHidden(!state.sidebarHidden);
}

/* ---------------- Ribbon tabs ---------------- */

function showRibbon(tab) {
  document.querySelectorAll(".top-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  el("ribbon-home").classList.toggle("hidden", tab !== "home");
  el("ribbon-insert").classList.toggle("hidden", tab !== "insert");
  el("ribbon-draw").classList.toggle("hidden", tab !== "draw");
  el("ribbon-view").classList.toggle("hidden", tab !== "view");
  el("ribbon-backup").classList.toggle("hidden", tab !== "backup");

  state.drawMode = (tab === "draw");
  Draw.setEnabled(state.drawMode);
}

/* ---------------- Rich formatting helpers ---------------- */

function getEditorSelectionRange() {
  const editor = el("editor");
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!editor.contains(r.commonAncestorContainer)) return null;
  return r;
}

function applyInlineStyle(styleObj) {
  if (Editor?.restoreSelection) Editor.restoreSelection();
  const range = getEditorSelectionRange();
  if (!range) return;

  const sel = window.getSelection();
  if (range.collapsed) {
    const span = document.createElement("span");
    Object.assign(span.style, styleObj);
    span.appendChild(document.createTextNode("\u200b"));
    range.insertNode(span);

    const newRange = document.createRange();
    newRange.setStart(span.firstChild, 1);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    if (Editor?.saveSelection) Editor.saveSelection();
    return;
  }

  const frag = range.extractContents();
  const span = document.createElement("span");
  Object.assign(span.style, styleObj);
  span.appendChild(frag);
  range.insertNode(span);

  // Keep the styled content selected so user can see the change
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  sel.removeAllRanges();
  sel.addRange(newRange);
  if (Editor?.saveSelection) Editor.saveSelection();
}

function exec(cmd) {
  if (Editor?.restoreSelection) Editor.restoreSelection();
  document.execCommand(cmd, false, null);
  if (Editor?.saveSelection) Editor.saveSelection();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function clearTextColor() {
  if (Editor?.restoreSelection) Editor.restoreSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  
  const range = sel.getRangeAt(0);
  const content = range.extractContents();
  
  // Remove color from all elements in the fragment
  const wrapper = document.createElement('div');
  wrapper.appendChild(content);
  
  // Clear color from wrapper itself and all descendants
  wrapper.style.color = 'inherit';
  wrapper.querySelectorAll('*').forEach(el => { 
    el.style.color = ''; 
  });
  
  // Get all children back and insert
  while (wrapper.firstChild) {
    range.insertNode(wrapper.firstChild);
  }
  
  // Restore selection after insertion
  sel.removeAllRanges();
  sel.addRange(range);
  autosave();
}

function clearHighlightColor() {
  if (Editor?.restoreSelection) Editor.restoreSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  
  const range = sel.getRangeAt(0);
  const content = range.extractContents();
  
  // Remove backgroundColor from all elements in the fragment
  const wrapper = document.createElement('div');
  wrapper.appendChild(content);
  
  // Clear backgroundColor from wrapper itself and all descendants
  wrapper.style.backgroundColor = 'inherit';
  wrapper.querySelectorAll('*').forEach(el => { 
    el.style.backgroundColor = ''; 
  });
  
  // Get all children back and insert
  while (wrapper.firstChild) {
    range.insertNode(wrapper.firstChild);
  }
  
  // Restore selection after insertion
  sel.removeAllRanges();
  sel.addRange(range);
  autosave();
}

/* ---------------- Data ---------------- */

async function refreshData() {
  state.folders = await Storage.getFolders();
  state.pagesByFolder = new Map();
  for (const f of state.folders) {
    const pages = await Storage.getPagesByFolder(f.id);
    pages.sort((a,b) => {
      const ao = Number.isFinite(a.order) ? a.order : null;
      const bo = Number.isFinite(b.order) ? b.order : null;
      if (ao !== null && bo !== null) return ao - bo;
      if (ao !== null && bo === null) return -1;
      if (ao === null && bo !== null) return 1;
      return (b.updatedAt||0) - (a.updatedAt||0);
    });
    state.pagesByFolder.set(f.id, pages);
  }
}

async function persistFolderOrder(folderId, pages) {
  for (let i = 0; i < pages.length; i++) {
    pages[i].order = i;
    await Storage.putPage(pages[i]);
  }
}

/* ---------------- Tree + Drag&Drop ---------------- */

function renderTree() {
  const tree = el("tree");
  tree.innerHTML = "";

  const q = state.query.trim().toLowerCase();

  for (const folder of state.folders) {
    const wrap = document.createElement("div");
    wrap.className = "folder" + (state.selectedFolderId === folder.id ? " folder-selected" : "");

    wrap.addEventListener("dragover", (e) => {
      if (!state.drag.pageId) return;
      e.preventDefault();
      wrap.classList.add("drag-over");
    });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("drag-over"));
    wrap.addEventListener("drop", async (e) => {
      e.preventDefault();
      wrap.classList.remove("drag-over");
      if (!state.drag.pageId) return;
      await movePageToFolder(state.drag.pageId, state.drag.fromFolderId, folder.id, null);
      state.drag.pageId = null;
      state.drag.fromFolderId = null;
      toast("Page moved");
    });

    const title = document.createElement("div");
    title.className = "folder-title";
    
    // Click on folder title to select it
    title.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.tagName === "SMALL") return;
      state.selectedFolderId = folder.id;
      renderTree();
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "folder-toggle" + (state.collapsedFolders.has(folder.id) ? " collapsed" : "");
    toggleBtn.textContent = "▼";
    toggleBtn.title = "Toggle folder";
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      if (state.collapsedFolders.has(folder.id)) {
        state.collapsedFolders.delete(folder.id);
      } else {
        state.collapsedFolders.add(folder.id);
      }
      Storage.kvSet("collapsedFolders", Array.from(state.collapsedFolders)).catch(()=>{});
      renderTree();
    };

    const titleText = document.createElement("span");
    titleText.className = "folder-title-text";
    titleText.innerHTML = '<i class="material-icons" style="font-size:inherit;vertical-align:middle;margin-right:4px;">folder</i>' + folder.name;

    const menuBtn = document.createElement("button");
    menuBtn.className = "folder-menu-btn";
    menuBtn.textContent = "⋯";
    menuBtn.title = "Collection actions";
    menuBtn.onclick = async (e) => {
      e.stopPropagation();
      showFolderContextMenu(e, folder);
    };

    title.appendChild(toggleBtn);
    title.appendChild(titleText);
    title.appendChild(menuBtn);

    const pagesWrap = document.createElement("div");
    pagesWrap.className = "pages" + (state.collapsedFolders.has(folder.id) ? " collapsed" : "");

    const pages = state.pagesByFolder.get(folder.id) || [];
    for (const page of pages) {
      const hay = ((page.title||"") + " " + (page.noteHtml||"")).toLowerCase();
      if (q && !hay.includes(q)) continue;

      const row = document.createElement("div");
      row.className = "node-row " + (state.activePage?.id === page.id ? "active" : "");
      row.draggable = true;

      row.addEventListener("dragstart", (e) => {
        state.drag.pageId = page.id;
        state.drag.fromFolderId = folder.id;
        try { e.dataTransfer.setData("text/plain", page.id); } catch {}
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        state.drag.pageId = null;
        state.drag.fromFolderId = null;
        document.querySelectorAll(".drag-over").forEach(x => x.classList.remove("drag-over"));
      });

      row.addEventListener("dragover", (e) => {
        if (!state.drag.pageId) return;
        e.preventDefault();
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        if (!state.drag.pageId) return;
        await movePageToFolder(state.drag.pageId, state.drag.fromFolderId, folder.id, page.id);
        state.drag.pageId = null;
        state.drag.fromFolderId = null;
        toast("Page moved");
      });

      const titleSpan = document.createElement("div");
      titleSpan.className = "node-title";
      titleSpan.innerHTML = '<i class="material-icons" style="font-size:inherit;vertical-align:middle;margin-right:4px;">note_stack</i>' + (page.title || "Untitled");
      titleSpan.onclick = async () => openPage(page.id);

      const actions = document.createElement("div");
      actions.className = "node-actions";

      const menuBtn = document.createElement("button");
      menuBtn.className = "icon-btn";
      menuBtn.title = "Page actions";
      menuBtn.textContent = "⋯";
      menuBtn.onclick = async (e) => {
        e.stopPropagation();
        showPageContextMenu(e, page, folder.id);
      };

      actions.appendChild(menuBtn);

      row.appendChild(titleSpan);
      row.appendChild(actions);
      pagesWrap.appendChild(row);
    }

    wrap.appendChild(title);
    wrap.appendChild(pagesWrap);
    tree.appendChild(wrap);
  }
}

async function movePageToFolder(pageId, fromFolderId, toFolderId, beforePageIdOrNull) {
  if (!pageId) return;

  const fromPages = (state.pagesByFolder.get(fromFolderId) || []).slice();
  const toPages = (state.pagesByFolder.get(toFolderId) || []).slice();

  const moving = fromPages.find(p => p.id === pageId) || await Storage.getPage(pageId);
  if (!moving) return;

  const fromIdx = fromPages.findIndex(p => p.id === pageId);
  if (fromIdx >= 0) fromPages.splice(fromIdx, 1);

  const existingTargetIdx = toPages.findIndex(p => p.id === pageId);
  if (existingTargetIdx >= 0) toPages.splice(existingTargetIdx, 1);

  moving.folderId = toFolderId;

  if (beforePageIdOrNull) {
    const idx = toPages.findIndex(p => p.id === beforePageIdOrNull);
    if (idx >= 0) toPages.splice(idx, 0, moving);
    else toPages.push(moving);
  } else {
    toPages.push(moving);
  }

  await Storage.putPage(moving);
  await persistFolderOrder(toFolderId, toPages);
  if (fromFolderId !== toFolderId) await persistFolderOrder(fromFolderId, fromPages);

  await refreshData();
  renderTree();
}

/* ---------------- Page view ---------------- */

function formatTimestamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${day}/${year} ${hours}:${mins}`;
}

async function openPage(pageId) {
  const page = await Storage.getPage(pageId);
  if (!page) return;

  state.activePage = page;
  state.selectedFolderId = page.folderId;
  await Storage.kvSet("activePageId", pageId);

  // Hide welcome screen and show content
  hideWelcomeScreen();

  // Update breadcrumb
  const folder = state.folders.find(f => f.id === page.folderId);
  const breadcrumb = el("breadcrumb");
  if (folder) {
    breadcrumb.innerHTML = `<span>${folder.name}</span> <span>/</span> <span>${page.title || "Untitled"}</span>`;
  } else {
    breadcrumb.innerHTML = `<span>${page.title || "Untitled"}</span>`;
  }

  // Update timestamps
  el("created-info").textContent = `CREATED AT: ${formatTimestamp(page.createdAt)}`;
  el("updated-info").textContent = `UPDATED AT: ${formatTimestamp(page.updatedAt)}`;

  el("page-title").value = page.title || "";
  el("editor").innerHTML = page.noteHtml || "";
  await Draw.loadDataUrl(page.drawingDataUrl || "");

  // Initialize enhanced tables and links
  setTimeout(() => {
    TableEnhanced.init();
    LinkEnhanced.init();
  }, 100);

  renderTree();
  setView(state.activeView);
}

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));

  el("note-view").classList.toggle("hidden", view !== "note");
  el("todo-view").classList.toggle("hidden", view !== "todo");

  if (view === "todo") renderTodos();
}

function showWelcomeScreen() {
  el("welcome-screen").classList.remove("hidden");
  el("note-view").classList.add("hidden");
  el("todo-view").classList.add("hidden");
  el("content-header").classList.add("hidden");
}

function hideWelcomeScreen() {
  el("welcome-screen").classList.add("hidden");
  el("content-header").classList.remove("hidden");
}

function closePage() {
  state.activePage = null;
  Storage.kvSet("activePageId", null);
  showWelcomeScreen();
  renderTree();
}

function renderTodos() {
  const todos = state.activePage?.todos || [];
  
  // Separate todos by status
  const todoItems = todos.filter(t => !t.status || t.status === "todo");
  const inProgressItems = todos.filter(t => t.status === "inprogress");
  const completedItems = todos.filter(t => t.status === "completed");
  
  // Update counts
  el("todo-count").textContent = todoItems.length;
  el("inprogress-count").textContent = inProgressItems.length;
  el("completed-count").textContent = completedItems.length;
  
  // Render To Do column
  renderTodoColumn(el("todo-list"), todoItems, "todo");
  
  // Render In Progress column
  renderTodoColumn(el("inprogress-list"), inProgressItems, "inprogress");
  
  // Render Completed column
  renderTodoColumn(el("completed-list"), completedItems, "completed");
}

function renderTodoColumn(listEl, todos, status) {
  listEl.innerHTML = "";

  for (const t of todos) {
    const li = document.createElement("li");
    li.className = "todo-item";
    li.draggable = true;
    li.dataset.todoId = t.id;

    // Determine task urgency based on end date (only for non-completed tasks)
    if (t.endDate && status !== "completed") {
      const today = new Date(new Date().toDateString());
      const endDate = new Date(t.endDate);
      const diffTime = endDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        // Overdue - due today or past due date (RED)
        li.classList.add("overdue");
      } else if (diffDays <= 60) {
        // 1-60 days away - green (urgent)
        li.classList.add("task-urgent");
      } else {
        // More than 60 days away - blue (far future)
        li.classList.add("task-far");
      }
    }

    // Build task HTML with name and optional description
    const taskName = t.name || t.text || "Untitled Task";

    // Truncate description to first 50 characters for card display
    let taskDescription = "";
    if (t.description) {
      const truncated = t.description.length > 50
        ? t.description.substring(0, 50) + "..."
        : t.description;
      taskDescription = `<div class="todo-description" title="${escapeHtml(t.description)}">${escapeHtml(truncated)}</div>`;
    }

    const taskDates = (t.startDate || t.endDate) ? `
      <div class="todo-dates">
        ${t.startDate ? `<span>📅 ${formatDate(t.startDate)}</span>` : ""}
        ${t.endDate ? `<span>⏰ ${formatDate(t.endDate)}</span>` : ""}
      </div>
    ` : "";

    li.innerHTML = `
      <div class="todo-content">
        <div class="todo-name">${escapeHtml(taskName)}</div>
        ${taskDescription}
        ${taskDates}
      </div>
      <button title="Delete" class="icon-btn danger">✕</button>
    `;

    // Click on task to edit
    li.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      openTaskModal(t);
    });

    // Drag start
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.id);
      li.classList.add("dragging");
    });

    // Drag end
    li.addEventListener("dragend", (e) => {
      li.classList.remove("dragging");
    });

    // Delete button
    li.querySelector("button").onclick = async (e) => {
      e.stopPropagation();
      state.activePage.todos = state.activePage.todos.filter(x => x.id !== t.id);
      await saveActivePage();
      renderTodos();
    };

    listEl.appendChild(li);
  }

  // Setup drop zone for this column
  setupDropZone(listEl, status);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function setupDropZone(listEl, targetStatus) {
  // Dragover - allow drop
  listEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    listEl.classList.add("drag-over");
  });

  // Dragleave - remove highlight
  listEl.addEventListener("dragleave", (e) => {
    // Only remove if leaving the list itself, not child elements
    if (e.target === listEl) {
      listEl.classList.remove("drag-over");
    }
  });

  // Drop - move the task
  listEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    listEl.classList.remove("drag-over");

    const todoId = e.dataTransfer.getData("text/plain");
    if (!todoId || !state.activePage) return;

    // Find and update the todo
    const todo = state.activePage.todos.find(t => t.id === todoId);
    if (todo) {
      todo.status = targetStatus;
      await saveActivePage();
      renderTodos();
    }
  });
}

/* ---------------- Task Modal ---------------- */

let currentTask = null;

function openTaskModal(task) {
  currentTask = task;
  const modal = el("task-modal");
  const titleEl = el("task-modal-title");

  if (task) {
    // Edit existing task
    titleEl.textContent = "Edit Task";
    el("task-name").value = task.name || task.text || "";
    el("task-description").value = task.description || "";
    el("task-start-date").value = task.startDate || "";
    el("task-end-date").value = task.endDate || "";
    el("task-status").value = task.status || "todo";
  } else {
    // Create new task
    titleEl.textContent = "Add Task";
    el("task-name").value = "";
    el("task-description").value = "";
    el("task-start-date").value = "";
    el("task-end-date").value = "";
    el("task-status").value = "todo";
  }

  modal.classList.remove("hidden");
  el("task-name").focus();
}

function closeTaskModal() {
  el("task-modal").classList.add("hidden");
  currentTask = null;
}

async function saveTask() {
  const name = el("task-name").value.trim();
  if (!name) {
    toast("Task name is required");
    return;
  }

  const description = el("task-description").value.trim();
  const startDate = el("task-start-date").value;
  const endDate = el("task-end-date").value;
  const status = el("task-status").value;

  // Validate dates
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    toast("Start date cannot be after end date");
    return;
  }

  if (currentTask) {
    // Update existing task
    currentTask.name = name;
    currentTask.text = name; // Keep for backwards compatibility
    currentTask.description = description;
    currentTask.startDate = startDate;
    currentTask.endDate = endDate;
    currentTask.status = status;
  } else {
    // Create new task
    state.activePage.todos = state.activePage.todos || [];
    state.activePage.todos.push({
      id: Storage.uid(),
      name,
      text: name,
      description,
      startDate,
      endDate,
      status
    });
  }

  await saveActivePage();
  renderTodos();
  closeTaskModal();
  toast(currentTask ? "Task updated" : "Task created");
}

async function saveActivePage() {
  if (!state.activePage) return;

  state.activePage.title = el("page-title").value.trim() || "Untitled";
  state.activePage.noteHtml = el("editor").innerHTML;
  state.activePage.drawingDataUrl = Draw.toDataUrl();

  await Storage.putPage(state.activePage);
  await refreshData();
  renderTree();
}

const autosave = debounce(saveActivePage, 600);

/* ---------------- Backup (downloads API) ---------------- */

async function backupExport() {
  const payload = await Storage.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const filename = `mini-note-backup-${Date.now()}.json`;

  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
    toast("Backup exported");
  } catch (e) {
    // Fallback (should be rare)
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    toast("Backup exported");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

function backupImport() {
  el("import-json").value = "";
  el("import-json").click();
}

/* ---------------- Symbol / Emoji / Math dialogs ---------------- */

const SYMBOLS = [
  "•","€","£","¥","©","®","™","±","≠","≤","≥","÷","×","∞","µ",
  "α","β","π","Ω","Σ","Δ","☺","♥","₹","¿","¡","—","…","À","Á","Â","Ã","Ä","Å","Æ","Ç","È","É","Ê","Ë",
  "Ñ","Ò","Ó","Ô","Õ","Ö","Ù","Ú","Û","Ü","ß","à","á","â","ã","ä","å","æ","ç","è","é","ê","ë",
  "ð","ñ","ò","ó","ô","õ","ö","ù","ú","û","ü","ÿ","Ğ","ğ","İ","ı","Œ","œ","Ş","ş"
];

const SYMBOL_NAMES = new Map([
  ["•","Bullet"],["©","Copyright"],["®","Registered"],["™","Trademark"],["≤","Less-than or equal"],["≥","Greater-than or equal"],
  ["÷","Division"],["×","Multiplication"],["∞","Infinity"],["µ","Micro sign"],["Ω","Omega"],["Σ","Sigma"],["Δ","Delta"],["π","Pi"]
]);

const EMOJI = {
  smileys: ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😍","😘","😜","🤪","🤓","😎","🥳","😇","🙂","🙃","😴","🤯","😡","😭","😱","🤔","🫡","🤝","✅","❌","⚠️"],
  animals: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄"],
  food: ["☕","🍵","🥤","🍺","🍕","🍔","🍟","🌭","🌮","🌯","🥗","🍣","🍜","🍝","🍱","🍰","🧁","🍩","🍪","🍫","🍎","🍌","🍇","🍉","🍓","🍒","🥑","🍳","🥐","🍞"],
  travel: ["🚗","🚕","🚌","🚎","🚓","🚑","🚒","🚜","✈️","🚀","🛸","🚢","⛴️","🛳️","🚤","🚆","🚇","🚉","🗺️","🧭","🏖️","🏕️","🏟️","🏛️","🏙️"],
  sports: ["⚽","🏀","🏈","⚾","🎾","🏐","🏉","🎱","🏓","🏸","🥊","🥋","⛳","🏹","🥏","🛹","⛷️","🏂","🏊","🚴","🏋️","🧘","🥇","🥈","🥉"],
  symbols: ["💡","📌","✏️","🖊️","🗑️","🔍","🔔","⭐","❤️","🖤","💜","💙","💚","🧡","💛","✔️","➕","➖","➗","✖️","➡️","⬅️","⬆️","⬇️","🔒","🔓","🧠","🧩","🧾"]
};

const EMOJI_TABS = [
  { key:"smileys", icon:"😊" },
  { key:"animals", icon:"🐸" },
  { key:"food", icon:"☕" },
  { key:"travel", icon:"🚢" },
  { key:"sports", icon:"⚽" },
  { key:"symbols", icon:"💡" }
];

function showDialog(id) { el(id).classList.remove("hidden"); }
function hideDialog(id) {
  el(id).classList.add("hidden");
  // Clear editing link state when link dialog closes
  if (id === "link-dialog") {
    state.editingLink = null;
  }
}

function buildSymbolGrid() {
  const grid = el("symbol-grid");
  grid.innerHTML = "";
  state.selectedSymbol = SYMBOLS[0];

  for (const s of SYMBOLS) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.textContent = s;
    cell.onclick = () => {
      state.selectedSymbol = s;
      grid.querySelectorAll(".cell").forEach(c => c.classList.remove("selected"));
      cell.classList.add("selected");
      el("symbol-name").textContent = SYMBOL_NAMES.get(s) || "";
    };
    if (s === state.selectedSymbol) cell.classList.add("selected");
    grid.appendChild(cell);
  }
  el("symbol-name").textContent = SYMBOL_NAMES.get(state.selectedSymbol) || "";
}

function buildEmoji() {
  const tabs = el("emoji-tabs");
  tabs.innerHTML = "";
  for (const t of EMOJI_TABS) {
    const b = document.createElement("button");
    b.className = "emoji-tab" + (t.key === state.selectedEmojiCategory ? " active" : "");
    b.textContent = t.icon;
    b.title = t.key;
    b.onclick = () => { state.selectedEmojiCategory = t.key; buildEmoji(); };
    tabs.appendChild(b);
  }

  const grid = el("emoji-grid");
  grid.innerHTML = "";
  const list = EMOJI[state.selectedEmojiCategory] || [];
  state.selectedEmoji = list[0] || "😀";

  for (const e of list) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.textContent = e;
    cell.onclick = () => {
      state.selectedEmoji = e;
      grid.querySelectorAll(".cell").forEach(c => c.classList.remove("selected"));
      cell.classList.add("selected");
    };
    if (e === state.selectedEmoji) cell.classList.add("selected");
    grid.appendChild(cell);
  }
}

// ===== LINK DIALOG MODULE (Exactly like TablePicker) =====
const LinkDialog = (() => {
  function show() {
    Editor.saveSelection();  // Save INSIDE show(), like TablePicker

    // Clear input fields
    el("link-url-input").value = "";
    el("link-text-input").value = "";

    showDialog("link-dialog");
  }

  function insert() {
    const url = el("link-url-input").value.trim();
    const text = el("link-text-input").value.trim();

    if (!url) {
      toast("Please enter a URL");
      return;
    }

    const linkText = text || url;
    const safeUrl = escapeHtml(url);
    const safeText = escapeHtml(linkText);

    Editor.insertHTML(`<a href="${safeUrl}" target="_blank" rel="noreferrer" class="editor-link">${safeText}</a>`);
    hideDialog("link-dialog");
    autosave();

    // Initialize link handlers after insertion
    setTimeout(() => LinkEnhanced.init(), 50);
  }

  return { show, insert };
})();

// ===== LINK ENHANCED MODULE =====
const LinkEnhanced = (() => {
  function init() {
    const editor = el("editor");
    if (!editor) return;

    const links = editor.querySelectorAll("a");
    links.forEach(link => {
      if (link.dataset.linkInit) return; // Skip if already initialized
      link.dataset.linkInit = "true";

      // Add editor-link class for styling
      if (!link.classList.contains("editor-link")) {
        link.classList.add("editor-link");
      }

      // Click to open in browser (Ctrl/Cmd + Click)
      link.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const href = link.getAttribute("href");
          if (href) {
            window.open(href, "_blank");
          }
        }
      });

      // Right-click context menu
      link.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showLinkContextMenu(e, link);
      });
    });
  }

  function showLinkContextMenu(event, link) {
    // Remove any existing context menus
    document.querySelectorAll(".context-menu").forEach(m => m.remove());

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.position = "fixed";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";
    menu.style.zIndex = "100000";

    // Open Link
    const openItem = document.createElement("div");
    openItem.className = "context-menu-item";
    openItem.textContent = "Open Link";
    openItem.onclick = () => {
      const href = link.getAttribute("href");
      if (href) {
        window.open(href, "_blank");
      }
      menu.remove();
    };
    menu.appendChild(openItem);

    // Edit Link
    const editItem = document.createElement("div");
    editItem.className = "context-menu-item";
    editItem.textContent = "Edit Link";
    editItem.onclick = () => {
      menu.remove();
      editLink(link);
    };
    menu.appendChild(editItem);

    // Remove Link (unlink)
    const removeItem = document.createElement("div");
    removeItem.className = "context-menu-item";
    removeItem.textContent = "Remove Link";
    removeItem.onclick = () => {
      menu.remove();
      removeLink(link);
      autosave();
    };
    menu.appendChild(removeItem);

    document.body.appendChild(menu);

    // Close menu on outside click
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener("click", closeHandler);
        }
      };
      document.addEventListener("click", closeHandler);
    }, 0);
  }

  function removeLink(link) {
    // Replace link with its text content
    const textNode = document.createTextNode(link.textContent);
    link.parentNode.replaceChild(textNode, link);
  }

  function editLink(link) {
    // Save the current link for editing
    const currentUrl = link.getAttribute("href") || "";
    const currentText = link.textContent || "";

    // Save selection at link position
    const range = document.createRange();
    range.selectNode(link);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    Editor.saveSelection();

    // Populate dialog with current values
    el("link-url-input").value = currentUrl;
    el("link-text-input").value = currentText;

    showDialog("link-dialog");

    // Store reference to the link being edited
    state.editingLink = link;
  }

  return { init };
})();

function wireDialogs() {
  document.querySelectorAll("[data-close]").forEach(b => {
    b.addEventListener("click", () => {
      if (b.dataset.close === "task-modal") {
        closeTaskModal();
      } else {
        hideDialog(b.dataset.close);
      }
    });
  });

  ["symbol-dialog","emoji-dialog","task-modal","table-dialog","table-shading-dialog","link-dialog"].forEach(id => {
    el(id)?.addEventListener("click", (e) => {
      if (e.target === el(id)) {
        if (id === "task-modal") {
          closeTaskModal();
        } else {
          hideDialog(id);
        }
      }
    });
  });

  // Task modal save button
  el("task-save").onclick = () => saveTask();

  el("symbol-insert").onclick = () => {
    if (!state.selectedSymbol) return;
    Editor.insertText(state.selectedSymbol);
    hideDialog("symbol-dialog");
    autosave();
  };

  el("emoji-insert").onclick = () => {
    if (!state.selectedEmoji) return;
    Editor.insertText(state.selectedEmoji);
    hideDialog("emoji-dialog");
    autosave();
  };

  el("link-insert").onclick = () => {
    // Check if editing existing link
    if (state.editingLink) {
      const url = el("link-url-input").value.trim();
      const text = el("link-text-input").value.trim();

      if (!url) {
        toast("Please enter a URL");
        return;
      }

      const linkText = text || url;
      state.editingLink.setAttribute("href", escapeHtml(url));
      state.editingLink.textContent = escapeHtml(linkText);

      hideDialog("link-dialog");
      state.editingLink = null;
      autosave();
    } else {
      LinkDialog.insert();
    }
  };

  // Table dialog handlers
  el("table-insert").onclick = () => {
    TablePicker.insertTable();
  };

  el("shading-apply").onclick = () => {
    TableShading.apply();
  };

  el("shading-clear").onclick = () => {
    TableShading.clear();
  };
}

/* ---------------- Ribbon wiring ---------------- */

function wireTabs() {
  document.querySelectorAll(".top-tab").forEach(btn => {
    btn.onclick = () => showRibbon(btn.dataset.tab);
  });
}

// Keep the editor caret/selection when clicking toolbar buttons.
// Without this, clicking the ribbon can collapse the selection to the start of the note.
function wireKeepCaretOnToolbar() {
  const inDialog = (node) => {
    if (!node || !(node instanceof Element)) return false;
    return !!node.closest(".dialog") || !!node.closest("#modal");
  };

  // Buttons: save selection *before* focus changes, and prevent the button from stealing focus.
  const btnSelector = ".topbar button, .ribbon button";
  document.querySelectorAll(btnSelector).forEach((b) => {
    b.addEventListener(
      "mousedown",
      (e) => {
        if (inDialog(e.target)) return;
        Editor?.saveSelection?.();
        // Prevent focus change (keeps selection stable)
        e.preventDefault();
      },
      { capture: true }
    );
    b.addEventListener(
      "pointerdown",
      (e) => {
        if (inDialog(e.target)) return;
        Editor?.saveSelection?.();
        if (e.pointerType !== "touch") e.preventDefault();
      },
      { capture: true }
    );
  });

  // Inputs/selects: just save selection (can't prevent default or the control won't work).
  const ctlSelector = ".ribbon select, .ribbon input, .searchbox input";
  document.querySelectorAll(ctlSelector).forEach((c) => {
    c.addEventListener(
      "mousedown",
      (e) => {
        if (inDialog(e.target)) return;
        Editor?.saveSelection?.();
      },
      { capture: true }
    );
    c.addEventListener(
      "pointerdown",
      (e) => {
        if (inDialog(e.target)) return;
        Editor?.saveSelection?.();
      },
      { capture: true }
    );
  });
}

function getSelectedTextFormatting() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return {};
  const range = sel.getRangeAt(0);
  if (range.collapsed) return {};
  
  // Get computed style from first text node in selection
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  
  const style = window.getComputedStyle(node);
  return {
    color: style.color || '',
    backgroundColor: style.backgroundColor || '',
    fontSize: style.fontSize || '',
    fontFamily: style.fontFamily || ''
  };
}

function rgbToHex(rgb) {
  if (!rgb) return '#000000';
  if (rgb.startsWith('#')) return rgb;
  
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return '#000000';
  
  const r = parseInt(match[0]);
  const g = parseInt(match[1]);
  const b = parseInt(match[2]);
  
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase();
}

/* ---------------- ColorManager (unified color handling) ---------------- */
const ColorManager = (() => {
  const COLORS = ['#FFFF00','#00FF00','#00FFFF','#FF00FF','#0000FF','#FF0000','#000080','#008080','#008000','#800080','#800000','#808000','#808080','#C0C0C0','#000000'];

  function apply(type, col) {
    if (Editor?.restoreSelection) Editor.restoreSelection();

    const editor = el("editor");
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      // No selection - focus editor
      editor.focus();
      return;
    }

    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      // Selection not in editor - focus editor
      editor.focus();
      return;
    }

    // Apply the color
    if (type === 'color') applyInlineStyle({ color: col });
    else applyInlineStyle({ backgroundColor: col });

    autosave();
    try { updateRibbonFormatting(); } catch (e) {}
  }

  function clear(type) {
    if (Editor?.restoreSelection) Editor.restoreSelection();
    const editor = el("editor");
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      editor.focus();
      return;
    }

    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      editor.focus();
      return;
    }

    // Handle empty selection
    if (range.collapsed) {
      editor.focus();
      return;
    }

    // Clone the range to preserve the original selection
    const originalRange = range.cloneRange();

    // Get all element nodes in the selection
    const selectedNodes = new Set();
    const commonAncestor = range.commonAncestorContainer;

    // Helper to collect all element nodes
    function collectNodes(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        selectedNodes.add(node);
      }
      if (node.childNodes) {
        for (let child of node.childNodes) {
          collectNodes(child);
        }
      }
    }

    // Collect from common ancestor
    if (commonAncestor.nodeType === Node.ELEMENT_NODE) {
      collectNodes(commonAncestor);
    } else if (commonAncestor.parentElement) {
      collectNodes(commonAncestor.parentElement);
    }

    // Also check start and end containers and their parents
    let node = range.startContainer;
    while (node && editor.contains(node)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        selectedNodes.add(node);
      }
      node = node.parentElement;
    }

    node = range.endContainer;
    while (node && editor.contains(node)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        selectedNodes.add(node);
      }
      node = node.parentElement;
    }

    // Clear the styles from all collected nodes
    const clearProperties = type === 'color'
      ? ['color']
      : ['backgroundColor', 'background-color'];

    selectedNodes.forEach(node => {
      if (node.style) {
        clearProperties.forEach(prop => {
          node.style.removeProperty(prop);
        });
      }
    });

    // Restore the original selection
    try {
      sel.removeAllRanges();
      sel.addRange(originalRange);
    } catch (e) {
      // If restoring fails, just focus the editor
      editor.focus();
    }

    if (Editor?.saveSelection) Editor.saveSelection();

    autosave();
    try { updateRibbonFormatting(); } catch (e) {}
  }

  return { colors: COLORS, apply, clear };
})();


function updateRibbonFormatting() {
  const fmt = getSelectedTextFormatting();
  if (fmt.color && fmt.color !== 'rgba(0, 0, 0, 0)') {
    try { el("fmt-color").value = rgbToHex(fmt.color); } catch(e) {}
  }
  if (fmt.backgroundColor && fmt.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    try { el("fmt-highlight").value = rgbToHex(fmt.backgroundColor); } catch(e) {}
  }
  if (fmt.fontSize) {
    try { el("font-size").value = parseInt(fmt.fontSize); } catch(e) {}
  }
}

function wireHomeRibbon() {
  el("font-family").onchange = (e) => { if (Editor?.restoreSelection) Editor.restoreSelection(); applyInlineStyle({ fontFamily: e.target.value }); autosave(); updateRibbonFormatting(); };
  el("font-size").onchange = (e) => { if (Editor?.restoreSelection) Editor.restoreSelection(); applyInlineStyle({ fontSize: `${e.target.value}px` }); autosave(); updateRibbonFormatting(); };

  el("fmt-bold").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("bold"); autosave(); updateRibbonFormatting(); };
  el("fmt-italic").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("italic"); autosave(); updateRibbonFormatting(); };
  el("fmt-underline").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("underline"); autosave(); updateRibbonFormatting(); };

  // Text color picker - save selection before opening, apply on input/change
  el("fmt-color").addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
  el("fmt-color").addEventListener('focus', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
  el("fmt-color").oninput = (e) => { ColorManager.apply('color', e.target.value); };
  el("fmt-color").onchange = (e) => { ColorManager.apply('color', e.target.value); };

  // Text color label - click to clear color
  el("fmt-color-label").addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  el("fmt-color-label").onclick = (ev) => { ev.preventDefault(); ColorManager.clear('color'); };

  el("fmt-color-clear").addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  el("fmt-color-clear").onclick = (ev) => { ev.preventDefault(); ColorManager.clear('color'); };

  // Highlight color picker - save selection before opening, apply on input/change
  el("fmt-highlight").addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
  el("fmt-highlight").addEventListener('focus', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
  el("fmt-highlight").oninput = (e) => { ColorManager.apply('highlight', e.target.value); };
  el("fmt-highlight").onchange = (e) => { ColorManager.apply('highlight', e.target.value); };

  // Highlight label - click to clear highlight
  el("fmt-highlight-label").addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  el("fmt-highlight-label").onclick = (ev) => { ev.preventDefault(); ColorManager.clear('highlight'); };

  el("fmt-highlight-clear").addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  el("fmt-highlight-clear").onclick = (ev) => { ev.preventDefault(); ColorManager.clear('highlight'); };

  // Bullet dropdown
  el("fmt-bullets").onclick = (ev) => {
    ev.stopPropagation();
    const dropdown = el("bullets-dropdown");
    const isHidden = dropdown.classList.toggle("hidden");
    dropdown.style.display = isHidden ? "none" : "block";
    el("number-dropdown")?.classList.add("hidden");
    if (!isHidden) el("fmt-bullets").focus();
  };
  
  document.querySelectorAll("#bullets-dropdown button").forEach(btn => {
    btn.addEventListener("mousedown", (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
    btn.onclick = (ev) => {
      ev.stopPropagation();
      if (Editor?.restoreSelection) Editor.restoreSelection();
      const bulletType = btn.dataset.bulletType;
      if (bulletType === "remove") {
        exec("insertUnorderedList");
      } else {
        exec("insertUnorderedList");
        setTimeout(() => {
          try {
            const editor = el("editor");
            if (editor) {
              const uls = editor.querySelectorAll("ul");
              const lastUl = uls[uls.length - 1];
              if (lastUl) {
                lastUl.style.listStyleType = bulletType === "•" ? "disc" : bulletType === "○" ? "circle" : "square";
              }
            }
          } catch(e) { console.error("Bullet style error:", e); }
        }, 10);
      }
      autosave();
      updateRibbonFormatting();
      el("bullets-dropdown").classList.add("hidden");
    };
  });

  // Number dropdown
  el("fmt-number").onclick = (ev) => {
    ev.stopPropagation();
    const dropdown = el("number-dropdown");
    const isHidden = dropdown.classList.toggle("hidden");
    dropdown.style.display = isHidden ? "none" : "block";
    el("bullets-dropdown")?.classList.add("hidden");
    if (!isHidden) el("fmt-number").focus();
  };
  
  document.querySelectorAll("#number-dropdown button").forEach(btn => {
    btn.addEventListener("mousedown", (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
    btn.onclick = (ev) => {
      ev.stopPropagation();
      if (Editor?.restoreSelection) Editor.restoreSelection();
      const numType = btn.dataset.numberType;
      if (numType === "remove") {
        exec("insertOrderedList");
      } else {
        exec("insertOrderedList");
        setTimeout(() => {
          try {
            const editor = el("editor");
            if (editor) {
              const ols = editor.querySelectorAll("ol");
              const lastOl = ols[ols.length - 1];
              if (lastOl) {
                lastOl.type = numType;
              }
            }
          } catch(e) { console.error("Number type error:", e); }
        }, 10);
      }
      autosave();
      updateRibbonFormatting();
      el("number-dropdown").classList.add("hidden");
    };
  });

  el("fmt-checkbox").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); Editor.insertText("☐ "); autosave(); updateRibbonFormatting(); };

  el("align-left").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("justifyLeft"); autosave(); updateRibbonFormatting(); };
  el("align-center").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("justifyCenter"); autosave(); updateRibbonFormatting(); };
  el("align-right").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("justifyRight"); autosave(); updateRibbonFormatting(); };

  el("undo").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("undo"); };
  el("redo").onclick = () => { if (Editor?.restoreSelection) Editor.restoreSelection(); exec("redo"); };

  el("clear-format").onclick = () => {
    if (Editor?.restoreSelection) Editor.restoreSelection();
    const r = getEditorSelectionRange();
    if (!r) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const text = sel.toString();
    if (!text) return;
    Editor.insertText(text);
    autosave();
  };
}

// ===== TABLE PICKER MODULE =====
const TablePicker = (() => {
  let selectedRows = 1;
  let selectedCols = 1;
  const MAX_ROWS = 10;
  const MAX_COLS = 10;

  function buildTableSizeGrid() {
    const grid = el("table-size-grid");
    grid.innerHTML = "";

    for (let r = 0; r < MAX_ROWS; r++) {
      for (let c = 0; c < MAX_COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "table-size-cell";
        cell.dataset.row = r;
        cell.dataset.col = c;

        cell.addEventListener("mouseenter", () => {
          selectedRows = r + 1;
          selectedCols = c + 1;
          updateHighlight();
        });

        cell.addEventListener("click", () => {
          insertTable();
        });

        grid.appendChild(cell);
      }
    }

    selectedRows = 3;
    selectedCols = 3;
    updateHighlight();
  }

  function updateHighlight() {
    const cells = document.querySelectorAll(".table-size-cell");
    cells.forEach(cell => {
      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);

      if (r < selectedRows && c < selectedCols) {
        cell.classList.add("highlighted");
      } else {
        cell.classList.remove("highlighted");
      }
    });

    el("table-size-display").textContent = `${selectedRows} × ${selectedCols}`;
  }

  function insertTable() {
    const includeHeader = el("table-header-row").checked;

    let html = '<div class="table-wrapper">';
    html += '<div class="table-drag-handle">⠿</div>';
    html += `<table class="enhanced-table" data-has-header="${includeHeader}">`;

    if (includeHeader) {
      html += "<thead><tr>";
      for (let c = 0; c < selectedCols; c++) {
        html += `<th contenteditable="true">Header ${c + 1}</th>`;
      }
      html += "</tr></thead>";
    }

    html += "<tbody>";
    for (let r = 0; r < selectedRows; r++) {
      html += "<tr>";
      for (let c = 0; c < selectedCols; c++) {
        html += `<td contenteditable="true">&nbsp;</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody></table></div><p>&nbsp;</p>";

    Editor.insertHTML(html);
    hideDialog("table-dialog");
    autosave();

    setTimeout(() => TableEnhanced.init(), 100);
  }

  function show() {
    Editor.saveSelection();
    buildTableSizeGrid();
    el("table-header-row").checked = true;
    showDialog("table-dialog");
  }

  return { show };
})();

/* ---------------- Table Enhanced Features ---------------- */

// ===== TABLE CONTEXT MENU MODULE =====
const TableContextMenu = (() => {
  let currentTable = null;
  let currentCell = null;
  let selectedCells = [];

  function show(event, table, cell) {
    event.preventDefault();
    event.stopPropagation();

    document.querySelectorAll(".context-menu").forEach(m => m.remove());

    currentTable = table;
    currentCell = cell;

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.position = "fixed";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";
    menu.style.zIndex = "100000";

    const menuItems = buildMenuItems(table, cell);
    menuItems.forEach(item => menu.appendChild(item));

    document.body.appendChild(menu);

    setTimeout(() => {
      const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener("click", closeHandler);
        }
      };
      document.addEventListener("click", closeHandler);
    }, 0);
  }

  function buildMenuItems(table, cell) {
    const items = [];

    items.push(createMenuItem("Insert Table...", () => TablePicker.show()));
    items.push(createSeparator());

    items.push(createMenuItem("Insert Column Left", () => insertColumn(table, cell, "before")));
    items.push(createMenuItem("Insert Column Right", () => insertColumn(table, cell, "after")));
    items.push(createMenuItem("Insert Row Above", () => insertRow(table, cell, "before")));
    items.push(createMenuItem("Insert Row Below", () => insertRow(table, cell, "after")));

    items.push(createSeparator());

    items.push(createMenuItem("Delete Table", () => deleteTable(table)));
    items.push(createMenuItem("Delete Columns", () => deleteColumn(table, cell)));
    items.push(createMenuItem("Delete Rows", () => deleteRow(table, cell)));

    items.push(createSeparator());

    if (selectedCells.length > 1) {
      items.push(createMenuItem("Merge Cells", () => mergeCells(table, selectedCells)));
    } else {
      items.push(createMenuItem("Merge Cells", null, "disabled"));
    }

    if (cell && (cell.colSpan > 1 || cell.rowSpan > 1)) {
      items.push(createMenuItem("Split Cells...", () => splitCell(table, cell)));
    } else {
      items.push(createMenuItem("Split Cells...", null, "disabled"));
    }

    items.push(createSeparator());

    items.push(createMenuItem("Select Table", () => selectTable(table)));
    items.push(createMenuItem("Select Columns", () => selectColumn(table, cell)));
    items.push(createMenuItem("Select Rows", () => selectRow(table, cell)));
    items.push(createMenuItem("Select Cell", () => selectCell(cell)));

    items.push(createSeparator());

    items.push(createMenuItem("Hide Borders", () => toggleBorders(table)));
    items.push(createMenuItem("Shading", () => showShadingPicker()));

    items.push(createSeparator());

    items.push(createMenuItem("Sort Ascending", () => sortTable(table, getColumnIndex(cell), "asc")));
    items.push(createMenuItem("Sort Descending", () => sortTable(table, getColumnIndex(cell), "desc")));

    items.push(createSeparator());

    items.push(createMenuItem("Header Row", () => toggleHeaderRow(table)));

    return items;
  }

  function createMenuItem(text, onClick, className = "") {
    const item = document.createElement("div");
    item.className = `context-menu-item ${className}`;
    item.textContent = text;

    if (onClick && !className.includes("disabled")) {
      item.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll(".context-menu").forEach(m => m.remove());
        onClick();
        autosave();
      };
    }

    return item;
  }

  function createSeparator() {
    const sep = document.createElement("div");
    sep.className = "context-menu-separator";
    return sep;
  }

  function getRowIndex(cell) {
    if (!cell) return -1;
    const row = cell.closest("tr");
    const rows = Array.from(row.parentElement.children);
    return rows.indexOf(row);
  }

  function getColumnIndex(cell) {
    if (!cell) return -1;
    return Array.from(cell.parentElement.children).indexOf(cell);
  }

  function insertColumn(table, cell, position) {
    const colIndex = getColumnIndex(cell);
    const rows = table.querySelectorAll("tr");

    rows.forEach(row => {
      const cells = Array.from(row.children);
      const isHeader = row.parentElement.tagName === "THEAD";
      const newCell = document.createElement(isHeader ? "th" : "td");
      newCell.contentEditable = true;
      newCell.innerHTML = "&nbsp;";

      if (position === "before") {
        row.insertBefore(newCell, cells[colIndex]);
      } else {
        if (cells[colIndex + 1]) {
          row.insertBefore(newCell, cells[colIndex + 1]);
        } else {
          row.appendChild(newCell);
        }
      }
    });

    setTimeout(() => TableEnhanced.init(), 50);
  }

  function insertRow(table, cell, position) {
    const row = cell.closest("tr");
    const colCount = row.children.length;
    const newRow = document.createElement("tr");

    for (let i = 0; i < colCount; i++) {
      const newCell = document.createElement("td");
      newCell.contentEditable = true;
      newCell.innerHTML = "&nbsp;";
      newRow.appendChild(newCell);
    }

    if (position === "before") {
      row.parentElement.insertBefore(newRow, row);
    } else {
      if (row.nextElementSibling) {
        row.parentElement.insertBefore(newRow, row.nextElementSibling);
      } else {
        row.parentElement.appendChild(newRow);
      }
    }
  }

  function deleteTable(table) {
    const wrapper = table.closest(".table-wrapper");
    if (wrapper) {
      wrapper.remove();
    } else {
      table.remove();
    }
  }

  function deleteColumn(table, cell) {
    const colIndex = getColumnIndex(cell);
    const rows = table.querySelectorAll("tr");

    let canDelete = false;
    rows.forEach(row => {
      if (row.children.length > 1) canDelete = true;
    });

    if (!canDelete) {
      toast("Cannot delete the last column");
      return;
    }

    rows.forEach(row => {
      if (row.children[colIndex]) {
        row.children[colIndex].remove();
      }
    });
  }

  function deleteRow(table, cell) {
    const tbody = table.querySelector("tbody");
    if (tbody && tbody.querySelectorAll("tr").length <= 1) {
      toast("Cannot delete the last row");
      return;
    }

    const row = cell.closest("tr");
    row.remove();
  }

  function mergeCells(table, cells) {
    if (cells.length < 2) return;

    let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;

    cells.forEach(cell => {
      const row = getRowIndex(cell);
      const col = getColumnIndex(cell);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    });

    const rowSpan = maxRow - minRow + 1;
    const colSpan = maxCol - minCol + 1;

    const firstCell = cells[0];
    const contents = cells.map(c => c.innerHTML).filter(h => h !== "&nbsp;" && h.trim());
    firstCell.innerHTML = contents.join(" ") || "&nbsp;";
    firstCell.rowSpan = rowSpan;
    firstCell.colSpan = colSpan;

    cells.slice(1).forEach(c => c.remove());
    clearSelection();
  }

  function splitCell(table, cell) {
    const rowSpan = cell.rowSpan || 1;
    const colSpan = cell.colSpan || 1;

    if (rowSpan === 1 && colSpan === 1) return;

    cell.rowSpan = 1;
    cell.colSpan = 1;

    const row = cell.closest("tr");
    const colIndex = getColumnIndex(cell);

    for (let c = 1; c < colSpan; c++) {
      const newCell = document.createElement(cell.tagName);
      newCell.contentEditable = true;
      newCell.innerHTML = "&nbsp;";
      row.insertBefore(newCell, cell.nextSibling);
    }

    const tbody = row.parentElement;
    const rowIndex = getRowIndex(cell);

    for (let r = 1; r < rowSpan; r++) {
      const targetRow = tbody.children[rowIndex + r];
      if (targetRow) {
        for (let c = 0; c < colSpan; c++) {
          const newCell = document.createElement("td");
          newCell.contentEditable = true;
          newCell.innerHTML = "&nbsp;";
          if (targetRow.children[colIndex]) {
            targetRow.insertBefore(newCell, targetRow.children[colIndex]);
          } else {
            targetRow.appendChild(newCell);
          }
        }
      }
    }
  }

  function selectTable(table) {
    clearSelection();
    selectedCells = Array.from(table.querySelectorAll("td, th"));
    selectedCells.forEach(c => c.classList.add("table-cell-selected"));
  }

  function selectColumn(table, cell) {
    clearSelection();
    const colIndex = getColumnIndex(cell);
    const rows = table.querySelectorAll("tr");

    rows.forEach(row => {
      if (row.children[colIndex]) {
        row.children[colIndex].classList.add("table-col-selected");
        selectedCells.push(row.children[colIndex]);
      }
    });
  }

  function selectRow(table, cell) {
    clearSelection();
    const row = cell.closest("tr");
    Array.from(row.children).forEach(c => {
      c.classList.add("table-row-selected");
      selectedCells.push(c);
    });
  }

  function selectCell(cell) {
    clearSelection();
    cell.classList.add("table-cell-selected");
    selectedCells = [cell];
  }

  function clearSelection() {
    document.querySelectorAll(".table-cell-selected, .table-row-selected, .table-col-selected")
      .forEach(el => {
        el.classList.remove("table-cell-selected", "table-row-selected", "table-col-selected");
      });
    selectedCells = [];
  }

  function toggleBorders(table) {
    const hideBorders = table.dataset.hideBorders !== "true";
    table.dataset.hideBorders = hideBorders;

    if (hideBorders) {
      table.style.border = "none";
      table.querySelectorAll("td, th").forEach(cell => {
        cell.style.border = "none";
      });
    } else {
      table.style.border = "";
      table.querySelectorAll("td, th").forEach(cell => {
        cell.style.border = "";
      });
    }
  }

  function showShadingPicker() {
    Editor.saveSelection();
    TableShading.build(selectedCells.length ? selectedCells : [currentCell]);
    showDialog("table-shading-dialog");
  }

  function toggleHeaderRow(table) {
    const hasHeader = table.dataset.hasHeader === "true";

    if (hasHeader) {
      const thead = table.querySelector("thead");
      if (thead) {
        const headerRow = thead.querySelector("tr");
        if (headerRow) {
          Array.from(headerRow.children).forEach(th => {
            const td = document.createElement("td");
            td.innerHTML = th.innerHTML;
            td.contentEditable = true;
            Object.assign(td.style, th.style);
            th.replaceWith(td);
          });

          const tbody = table.querySelector("tbody");
          tbody.insertBefore(headerRow, tbody.firstChild);
          thead.remove();
        }
      }
      table.dataset.hasHeader = "false";
    } else {
      const tbody = table.querySelector("tbody");
      const firstRow = tbody?.querySelector("tr");

      if (firstRow) {
        Array.from(firstRow.children).forEach(td => {
          const th = document.createElement("th");
          th.innerHTML = td.innerHTML;
          th.contentEditable = true;
          Object.assign(th.style, td.style);
          td.replaceWith(th);
        });

        let thead = table.querySelector("thead");
        if (!thead) {
          thead = document.createElement("thead");
          table.insertBefore(thead, tbody);
        }
        thead.appendChild(firstRow);
      }
      table.dataset.hasHeader = "true";
    }
  }

  function sortTable(table, colIndex, direction) {
    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll("tr"));

    rows.sort((a, b) => {
      const aText = a.children[colIndex]?.textContent.trim() || "";
      const bText = b.children[colIndex]?.textContent.trim() || "";

      const aNum = parseFloat(aText);
      const bNum = parseFloat(bText);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return direction === "asc" ? aNum - bNum : bNum - aNum;
      }

      return direction === "asc"
        ? aText.localeCompare(bText)
        : bText.localeCompare(aText);
    });

    rows.forEach(row => tbody.appendChild(row));
  }

  return { show, clearSelection };
})();

// ===== TABLE SHADING MODULE =====
const TableShading = (() => {
  const COLORS = [
    "#ffffff", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280",
    "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706",
    "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626",
    "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb",
    "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a",
    "#f3e8ff", "#e9d5ff", "#d8b4fe", "#c084fc", "#a855f7", "#9333ea"
  ];

  let targetCells = [];

  function build(cells) {
    targetCells = cells;
    const grid = el("shading-color-grid");
    grid.innerHTML = "";

    COLORS.forEach(color => {
      const cell = document.createElement("div");
      cell.className = "shading-color-cell";
      cell.style.backgroundColor = color;
      cell.title = color;

      cell.onclick = () => {
        grid.querySelectorAll(".shading-color-cell").forEach(c =>
          c.classList.remove("selected")
        );
        cell.classList.add("selected");
      };

      grid.appendChild(cell);
    });
  }

  function apply() {
    const selected = document.querySelector(".shading-color-cell.selected");
    if (!selected) {
      toast("Please select a color");
      return;
    }

    const color = selected.style.backgroundColor;
    targetCells.forEach(cell => {
      cell.style.backgroundColor = color;
    });

    hideDialog("table-shading-dialog");
    autosave();
  }

  function clear() {
    targetCells.forEach(cell => {
      cell.style.backgroundColor = "";
    });
    hideDialog("table-shading-dialog");
    autosave();
  }

  return { build, apply, clear };
})();

// ===== TABLE ENHANCED MODULE =====
const TableEnhanced = (() => {
  function init() {
    const editor = el("editor");
    if (!editor) return;

    const tables = editor.querySelectorAll("table.enhanced-table");
    tables.forEach(table => {
      if (table.dataset.enhancedInit) return;
      table.dataset.enhancedInit = "true";

      addContextMenu(table);
      addColumnResizing(table);
      addRowDragging(table);
      addTableDragging(table);
    });

    const legacyTables = editor.querySelectorAll("table.resizable-table");
    legacyTables.forEach(table => {
      if (!table.classList.contains("enhanced-table")) {
        table.classList.add("enhanced-table");

        if (!table.closest(".table-wrapper")) {
          const wrapper = document.createElement("div");
          wrapper.className = "table-wrapper";
          const handle = document.createElement("div");
          handle.className = "table-drag-handle";
          handle.textContent = "⠿";
          wrapper.appendChild(handle);
          table.parentNode.insertBefore(wrapper, table);
          wrapper.appendChild(table);
        }

        init();
      }
    });
  }

  function addContextMenu(table) {
    table.addEventListener("contextmenu", (e) => {
      let cell = e.target;

      while (cell && cell !== table && cell.tagName !== "TD" && cell.tagName !== "TH") {
        cell = cell.parentElement;
      }

      if (cell && (cell.tagName === "TD" || cell.tagName === "TH")) {
        TableContextMenu.show(e, table, cell);
      }
    });
  }

  function addColumnResizing(table) {
    const cells = table.querySelectorAll("th, td");
    cells.forEach(cell => {
      if (cell.querySelector(".table-resize-handle")) return;

      cell.style.position = "relative";

      const resizer = document.createElement("div");
      resizer.className = "table-resize-handle";
      resizer.style.cssText = `
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        background: transparent;
        z-index: 10;
      `;
      cell.appendChild(resizer);

      let startX, startWidth;

      resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.pageX;
        startWidth = cell.offsetWidth;

        const onMouseMove = (e) => {
          const width = startWidth + (e.pageX - startX);
          if (width > 30) {
            cell.style.width = width + "px";
            cell.style.minWidth = width + "px";
          }
        };

        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          autosave();
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });

      resizer.addEventListener("mouseenter", () => {
        resizer.style.background = "var(--accent)";
      });

      resizer.addEventListener("mouseleave", () => {
        resizer.style.background = "transparent";
      });
    });
  }

  function addRowDragging(table) {
    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const rows = tbody.querySelectorAll("tr");
    rows.forEach(row => {
      row.draggable = true;

      row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });

      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over"));
      });

      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const dragging = tbody.querySelector("tr.dragging");
        if (dragging && dragging !== row) {
          row.classList.add("drag-over");
        }
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const dragging = tbody.querySelector("tr.dragging");
        if (!dragging || dragging === row) return;

        const allRows = Array.from(tbody.querySelectorAll("tr"));
        const dragIdx = allRows.indexOf(dragging);
        const dropIdx = allRows.indexOf(row);

        if (dragIdx < dropIdx) {
          tbody.insertBefore(dragging, row.nextSibling);
        } else {
          tbody.insertBefore(dragging, row);
        }

        row.classList.remove("drag-over");
        autosave();
      });
    });
  }

  function addTableDragging(table) {
    const wrapper = table.closest(".table-wrapper");
    if (!wrapper) return;

    const handle = wrapper.querySelector(".table-drag-handle");
    if (!handle) return;

    let isDragging = false;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      wrapper.draggable = true;
      isDragging = true;
    });

    wrapper.addEventListener("dragstart", (e) => {
      if (!isDragging) {
        e.preventDefault();
        return;
      }

      e.dataTransfer.effectAllowed = "move";
      wrapper.classList.add("dragging");
    });

    wrapper.addEventListener("dragend", () => {
      wrapper.classList.remove("dragging");
      wrapper.draggable = false;
      isDragging = false;

      const indicator = el("editor").querySelector(".drop-indicator");
      if (indicator) indicator.remove();
    });

    const editor = el("editor");
    let dropIndicator = null;

    editor.addEventListener("dragover", (e) => {
      if (!isDragging) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      if (!dropIndicator) {
        dropIndicator = document.createElement("div");
        dropIndicator.className = "drop-indicator";
      }

      const target = e.target;
      if (target && target !== wrapper && editor.contains(target)) {
        const targetEl = target.closest("p, h1, h2, h3, h4, h5, h6, ul, ol, .table-wrapper");
        if (targetEl && targetEl !== wrapper) {
          const rect = targetEl.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            targetEl.parentNode.insertBefore(dropIndicator, targetEl);
          } else {
            targetEl.parentNode.insertBefore(dropIndicator, targetEl.nextSibling);
          }
        }
      }
    });

    editor.addEventListener("drop", (e) => {
      if (!isDragging) return;

      e.preventDefault();

      if (dropIndicator && dropIndicator.parentNode) {
        dropIndicator.parentNode.insertBefore(wrapper, dropIndicator);
        dropIndicator.remove();
        dropIndicator = null;
        autosave();
      }
    });
  }

  return { init };
})();

function wireInsertRibbon() {
  el("btn-insert-table").onclick = () => TablePicker.show();
  el("btn-insert-picture").onclick = () => Editor.insertPicture();
  el("btn-insert-link").onclick = () => LinkDialog.show();

  el("btn-insert-symbol").onclick = () => { if (Editor?.saveSelection) Editor.saveSelection(); buildSymbolGrid(); showDialog("symbol-dialog"); };
  el("btn-insert-emoji").onclick = () => { if (Editor?.saveSelection) Editor.saveSelection(); buildEmoji(); showDialog("emoji-dialog"); };
}

function wireDrawRibbon() {
  el("tool-select").onclick = () => Draw.setEnabled(false);
  el("tool-pen").onclick = () => { Draw.setEnabled(true); Draw.setTool("pen"); };
  el("tool-highlighter").onclick = () => { Draw.setEnabled(true); Draw.setTool("highlighter"); };
  el("tool-eraser").onclick = () => { Draw.setEnabled(true); Draw.setTool("eraser"); };

  document.querySelectorAll(".color-dot").forEach(b => {
    b.style.background = b.dataset.color;
    b.onclick = () => Draw.setColor(b.dataset.color);
  });

  el("stroke-width").onchange = (e) => Draw.setWidth(e.target.value);

  el("toggle-ruler").onclick = () => {
    state.rulerOn = !state.rulerOn;
    el("ruler").classList.toggle("hidden", !state.rulerOn);
  };

  el("clear-drawing").onclick = async () => {
    const ok = await confirmModal("Clear drawing?", "This will clear ink on this page.", "Clear");
    if (!ok) return;
    Draw.clear();
    autosave();
    toast("Drawing cleared");
  };
}

function wireViewRibbon() {
  el("toggle-sidebar").onclick = toggleSidebar;
  document.querySelectorAll(".radio[data-theme]").forEach(b => {
    b.onclick = () => {
      applyThemeMode(b.dataset.theme);
      toast(`Theme: ${b.dataset.theme}`);
    };
  });
}

function wireBackupRibbon() {
  el("backup-export").onclick = backupExport;
  el("backup-import").onclick = backupImport;

  el("import-json").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const payload = JSON.parse(text);
      await Storage.importAll(payload);
      await boot(false);
      toast("Backup imported");
    } catch (err) {
      console.error(err);
      toast("Import failed");
    }
  };
}

/* ---------------- Sidebar create buttons ---------------- */

function wireSidebar() {
  el("add-folder").onclick = async () => {
    const res = await openModal({
      title: "New collection",
      message: "Create a new collection (folder).",
      label: "Collection name",
      placeholder: "e.g. Work",
      okText: "Create"
    });
    if (res.action !== "ok") return;
    await Storage.putFolder({ id: Storage.uid(), name: res.value, createdAt: Date.now() });
    await boot(false);
    toast("Collection created");
  };

  el("add-page").onclick = async () => {
    if (!state.folders.length) return;

    // Use selected folder, or first folder if none selected
    const defaultFolderId = state.selectedFolderId || state.activePage?.folderId || state.folders[0].id;
    const folder = state.folders.find(f => f.id === defaultFolderId) || state.folders[0];

    const res = await openModal({
      title: "New page",
      message: `Create a new page in "${folder.name}".`,
      label: "Page title",
      placeholder: "e.g. Meeting notes",
      okText: "Create"
    });
    if (res.action !== "ok") return;

    const pages = state.pagesByFolder.get(folder.id) || [];
    const order = pages.length;

    const page = {
      id: Storage.uid(),
      folderId: folder.id,
      title: res.value,
      noteHtml: "<p></p>",
      todos: [],
      drawingDataUrl: "",
      order,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await Storage.putPage(page);
    await boot(false);
    await openPage(page.id);
    toast("Page created");
  };
}

/* ---------------- Editor + Todo wiring ---------------- */

function wireEditorAndTodos() {
  el("page-title").addEventListener("input", autosave);
  el("editor").addEventListener("input", autosave);
  el("editor").addEventListener("blur", autosave);

  document.querySelectorAll(".view-btn").forEach(b => {
    b.onclick = () => setView(b.dataset.view);
  });

  // Add task button
  el("add-task-btn").onclick = () => {
    openTaskModal(null);
  };

  el("search").addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      el("search-results").classList.add("hidden");
      return;
    }
    
    const results = [];
    
    // Search collections
    for (const folder of state.folders) {
      if (folder.name.toLowerCase().includes(query)) {
        results.push({
          type: "folder",
          id: folder.id,
          name: folder.name,
          label: "Collection"
        });
      }
    }
    
    // Search pages
    for (const folder of state.folders) {
      const pages = state.pagesByFolder.get(folder.id) || [];
      for (const page of pages) {
        const pageText = (page.title || "").toLowerCase();
        if (pageText.includes(query)) {
          results.push({
            type: "page",
            id: page.id,
            folderId: folder.id,
            name: page.title || "Untitled",
            folder: folder.name,
            label: "Page"
          });
        }
      }
    }
    
    renderSearchResults(results);
  });
  
  // Close search results when clicking outside
  document.addEventListener("click", (e) => {
    if (!el("searchbox") || !el("searchbox").contains(e.target)) {
      el("search-results").classList.add("hidden");
    }
  });
  
  // Close search results on Escape
  el("search").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      el("search-results").classList.add("hidden");
      el("search").value = "";
    }
  });

  // Custom editor right-click menu
  const editorEl = el("editor");
  if (editorEl) {
    editorEl.addEventListener('contextmenu', (ev) => {
      if (Editor?.saveSelection) Editor.saveSelection();
      showEditorContextMenu(ev);
    });
  }
}

function renderSearchResults(results) {
  const resultsEl = el("search-results");
  
  if (results.length === 0) {
    resultsEl.classList.add("hidden");
    return;
  }
  
  resultsEl.innerHTML = "";
  resultsEl.classList.remove("hidden");
  
  for (const result of results) {
    const item = document.createElement("div");
    item.className = "search-result-item";
    
    if (result.type === "folder") {
      item.innerHTML = `
        <div class="search-result-label">Collection</div>
        <div class="search-result-text">${result.name}</div>
      `;
      item.onclick = () => {
        state.selectedFolderId = result.id;
        el("search").value = "";
        resultsEl.classList.add("hidden");
        renderTree();
        toast("Collection selected");
      };
    } else {
      item.innerHTML = `
        <div class="search-result-label">Page in ${result.folder}</div>
        <div class="search-result-text">${result.name}</div>
      `;
      item.onclick = () => {
        openPage(result.id);
        el("search").value = "";
        resultsEl.classList.add("hidden");
        toast("Page opened");
      };
    }
    
    resultsEl.appendChild(item);
  }
}

/* ---------------- Context Menus (Dropdown) ---------------- */

function closeAllContextMenus() {
  document.querySelectorAll(".context-menu").forEach(m => m.remove());
  document.querySelectorAll(".editor-context").forEach(m => m.remove());
}

function showFolderContextMenu(e, folder) {
  closeAllContextMenus();
  
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.position = "absolute";
  menu.style.left = e.pageX + "px";
  menu.style.top = e.pageY + "px";
  
  const renameItem = document.createElement("div");
  renameItem.className = "context-menu-item";
  renameItem.textContent = "Rename";
  renameItem.onclick = async () => {
    closeAllContextMenus();
    const res = await openModal({
      title: "Rename collection",
      label: "Collection name",
      value: folder.name,
      okText: "Rename"
    });
    if (res.action !== "ok") return;
    const name = res.value;
    if (name && name !== folder.name) {
      await Storage.putFolder({ ...folder, name });
      await boot(false);
      toast("Collection renamed");
    }
  };
  
  const deleteItem = document.createElement("div");
  deleteItem.className = "context-menu-item danger";
  deleteItem.textContent = "Delete";
  deleteItem.onclick = async () => {
    closeAllContextMenus();
    const del = await confirmModal("Delete collection?", "This will delete all pages inside it.", "Delete");
    if (!del) return;
    await Storage.deleteFolder(folder.id);
    await boot(false);
    toast("Collection deleted");
  };
  
  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  
  setTimeout(() => {
    document.addEventListener("click", closeAllContextMenus, { once: true });
  }, 0);
}

function showPageContextMenu(e, page, folderId) {
  closeAllContextMenus();
  
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.position = "absolute";
  menu.style.left = e.pageX + "px";
  menu.style.top = e.pageY + "px";
  
  const renameItem = document.createElement("div");
  renameItem.className = "context-menu-item";
  renameItem.textContent = "Rename";
  renameItem.onclick = async () => {
    closeAllContextMenus();
    const res = await openModal({
      title: "Rename page",
      label: "Page title",
      value: page.title || "",
      okText: "Rename"
    });
    if (res.action !== "ok") return;
    page.title = res.value;
    await Storage.putPage(page);
    await boot(false);
    if (state.activePage?.id === page.id) el("page-title").value = page.title;
    toast("Page renamed");
  };
  
  const deleteItem = document.createElement("div");
  deleteItem.className = "context-menu-item danger";
  deleteItem.textContent = "Delete";
  deleteItem.onclick = async () => {
    closeAllContextMenus();
    const ok = await confirmModal("Delete page?", `This will delete "${page.title || "Untitled"}".`, "Delete");
    if (!ok) return;
    await Storage.deletePage(page.id);
    if (state.activePage?.id === page.id) state.activePage = null;
    await boot(false);
    toast("Page deleted");
  };
  
  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  
  setTimeout(() => {
    document.addEventListener("click", closeAllContextMenus, { once: true });
  }, 0);
}

/* ---------------- Editor custom context menu ---------------- */

function closeEditorContextMenu() {
  document.querySelectorAll('.editor-context').forEach(n => n.remove());
}

function showEditorContextMenu(e) {
  e.preventDefault();
  if (Editor?.saveSelection) Editor.saveSelection();
  closeAllContextMenus();

  const editor = el('editor');
  const x = e.pageX;
  const y = e.pageY;
  
  // Get current formatting from selection
  const fmt = getSelectedTextFormatting();

  const wrap = document.createElement('div');
  wrap.className = 'editor-context';
  wrap.style.position = 'absolute';
  wrap.style.left = x + 'px';
  wrap.style.top = y + 'px';
  wrap.style.zIndex = 60;

  // Toolbar (mini)
  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';

  // Font family
  const fam = document.createElement('select');
  fam.className = 'ctx-font-family';
  const fontOptions = [
    // System fonts
    'Calibri Light','Calibri','Arial','Times New Roman','Verdana','Georgia','Consolas',
    // Google Fonts - Sans Serif
    'Roboto','Open Sans','Lato','Poppins','Inter',
    // Google Fonts - Serif
    'Playfair Display','Merriweather','IBM Plex Serif',
    // Google Fonts - Monospace
    'Fira Code','Inconsolata'
  ];
  fontOptions.forEach(o => {
    const op = document.createElement('option'); op.value = o; op.textContent = o; fam.appendChild(op);
  });
  if (fmt.fontFamily) {
    try { fam.value = fmt.fontFamily.replace(/['\"]/g, '').split(',')[0].trim(); } catch(e) {}
  }
  fam.onchange = (ev) => { if (Editor?.restoreSelection) Editor.restoreSelection(); applyInlineStyle({ fontFamily: ev.target.value }); autosave(); };
  fam.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
  fam.addEventListener('pointerdown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });

  // Size
  const size = document.createElement('select');
  size.className = 'ctx-font-size';
  ['10','12','14','15','16','18','20','24','28','32'].forEach(v => { const op=document.createElement('option'); op.value=v; op.textContent=v; if(v==='15') op.selected=true; size.appendChild(op); });
  if (fmt.fontSize) {
    try { size.value = parseInt(fmt.fontSize); } catch(e) {}
  }
  size.onchange = (ev) => { if (Editor?.restoreSelection) Editor.restoreSelection(); applyInlineStyle({ fontSize: `${ev.target.value}px` }); autosave(); };
  size.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });
  size.addEventListener('pointerdown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); }, { capture: true });

  const btn = (txt, fn) => {
    const b = document.createElement('button');
    b.className = 'ctx-btn';
    b.textContent = txt;
    b.onclick = (ev) => { ev.stopPropagation(); if (Editor?.restoreSelection) Editor.restoreSelection(); fn(); closeEditorContextMenu(); };
    // Save selection and prevent the button from stealing focus so the editor caret can be restored
    b.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      if (Editor?.saveSelection) Editor.saveSelection();
      ev.preventDefault();
    }, { capture: true });
    b.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch' && Editor?.saveSelection) Editor.saveSelection();
      if (ev.pointerType !== 'touch') ev.preventDefault();
    }, { capture: true });
    return b;
  };

  const bold = btn('B', () => { exec('bold'); autosave(); });
  const italic = btn('I', () => { exec('italic'); autosave(); });
  const underline = btn('U', () => { exec('underline'); autosave(); });

  // Color palette
  const COLORS = ['#FFFF00','#00FF00','#00FFFF','#FF00FF','#0000FF','#FF0000','#000080','#008080','#008000','#800080','#800000','#808000','#808080','#C0C0C0','#000000'];
  
  // Create color dropdown
  const colorDropdown = document.createElement('div');
  colorDropdown.className = 'ctx-color-dropdown';
  colorDropdown.style.position = 'relative';
  
  const colorBtn = document.createElement('button');
  colorBtn.className = 'ctx-color-trigger';
  colorBtn.style.display = 'flex';
  colorBtn.style.alignItems = 'center';
  colorBtn.style.gap = '4px';
  colorBtn.style.border = '1px solid var(--border)';
  colorBtn.style.background = 'var(--bg)';
  colorBtn.style.padding = '6px 8px';
  colorBtn.style.borderRadius = '8px';
  colorBtn.style.cursor = 'pointer';
  colorBtn.textContent = 'A▼';
  colorBtn.title = 'Text Color';
  
  const colorPaletteContainer = document.createElement('div');
  colorPaletteContainer.className = 'ctx-color-palette-container hidden';
  colorPaletteContainer.style.position = 'absolute';
  colorPaletteContainer.style.top = '100%';
  colorPaletteContainer.style.left = '0';
  colorPaletteContainer.style.background = 'var(--bg)';
  colorPaletteContainer.style.border = '1px solid var(--border)';
  colorPaletteContainer.style.borderRadius = '8px';
  colorPaletteContainer.style.padding = '6px';
  colorPaletteContainer.style.gridTemplateColumns = 'repeat(5, 1fr)';
  colorPaletteContainer.style.gap = '4px';
  colorPaletteContainer.style.zIndex = '100';
  colorPaletteContainer.style.marginTop = '4px';
  colorPaletteContainer.style.minWidth = '150px';
  
  COLORS.forEach(col => {
    const dot = document.createElement('button');
    dot.style.width = '24px';
    dot.style.height = '24px';
    dot.style.backgroundColor = col;
    dot.style.border = '1px solid var(--border)';
    dot.style.borderRadius = '4px';
    dot.style.cursor = 'pointer';
    dot.title = col;
    dot.onclick = (ev) => {
      ev.stopPropagation();
      if (Editor?.restoreSelection) Editor.restoreSelection();
      ColorManager.apply('color', col);
      colorPaletteContainer.classList.add('hidden');
      colorPaletteContainer.style.display = 'none';
    };
    dot.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
    colorPaletteContainer.appendChild(dot);
  });
  
  const noColorOption = document.createElement('button');
  noColorOption.style.gridColumn = '1 / -1';
  noColorOption.style.padding = '6px';
  noColorOption.style.border = '1px solid var(--border)';
  noColorOption.style.borderRadius = '4px';
  noColorOption.style.background = 'var(--bg)';
  noColorOption.style.cursor = 'pointer';
  noColorOption.style.display = 'flex';
  noColorOption.style.alignItems = 'center';
  noColorOption.style.gap = '4px';
  noColorOption.textContent = '⭕ No Color';
  noColorOption.style.fontSize = '12px';
  noColorOption.onclick = (ev) => {
    ev.stopPropagation();
    if (Editor?.restoreSelection) Editor.restoreSelection();
    ColorManager.clear('color');
    colorPaletteContainer.classList.add('hidden');
    colorPaletteContainer.style.display = 'none';
  };
  noColorOption.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  colorPaletteContainer.appendChild(noColorOption);
  
  colorPaletteContainer.addEventListener('mousedown', (ev) => { ev.stopPropagation(); }, { capture: true });
  colorBtn.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  colorBtn.onclick = (ev) => { 
    ev.stopPropagation(); 
    const isHidden = colorPaletteContainer.classList.toggle('hidden');
    colorPaletteContainer.style.display = isHidden ? 'none' : 'grid';
    highlightPaletteContainer.classList.add('hidden');
    highlightPaletteContainer.style.display = 'none';
  };
  
  colorDropdown.appendChild(colorBtn);
  colorDropdown.appendChild(colorPaletteContainer);
  
  // Create highlight dropdown
  const highlightDropdown = document.createElement('div');
  highlightDropdown.className = 'ctx-highlight-dropdown';
  highlightDropdown.style.position = 'relative';
  
  const highlightBtn = document.createElement('button');
  highlightBtn.className = 'ctx-highlight-trigger';
  highlightBtn.style.display = 'flex';
  highlightBtn.style.alignItems = 'center';
  highlightBtn.style.gap = '4px';
  highlightBtn.style.border = '1px solid var(--border)';
  highlightBtn.style.background = 'var(--bg)';
  highlightBtn.style.padding = '6px 8px';
  highlightBtn.style.borderRadius = '8px';
  highlightBtn.style.cursor = 'pointer';
  highlightBtn.textContent = '🖍▼';
  highlightBtn.title = 'Highlight';
  
  const highlightPaletteContainer = document.createElement('div');
  highlightPaletteContainer.className = 'ctx-highlight-palette-container hidden';
  highlightPaletteContainer.style.position = 'absolute';
  highlightPaletteContainer.style.top = '100%';
  highlightPaletteContainer.style.left = '0';
  highlightPaletteContainer.style.background = 'var(--bg)';
  highlightPaletteContainer.style.border = '1px solid var(--border)';
  highlightPaletteContainer.style.borderRadius = '8px';
  highlightPaletteContainer.style.padding = '6px';
  highlightPaletteContainer.style.gridTemplateColumns = 'repeat(5, 1fr)';
  highlightPaletteContainer.style.gap = '4px';
  highlightPaletteContainer.style.zIndex = '100';
  highlightPaletteContainer.style.marginTop = '4px';
  highlightPaletteContainer.style.minWidth = '150px';
  
  COLORS.forEach(col => {
    const dot = document.createElement('button');
    dot.style.width = '24px';
    dot.style.height = '24px';
    dot.style.backgroundColor = col;
    dot.style.border = '1px solid var(--border)';
    dot.style.borderRadius = '4px';
    dot.style.cursor = 'pointer';
    dot.title = col;
    dot.onclick = (ev) => {
      ev.stopPropagation();
      if (Editor?.restoreSelection) Editor.restoreSelection();
      ColorManager.apply('highlight', col);
      highlightPaletteContainer.classList.add('hidden');
      highlightPaletteContainer.style.display = 'none';
    };
    dot.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
    highlightPaletteContainer.appendChild(dot);
  });
  
  const noHighlightOption = document.createElement('button');
  noHighlightOption.style.gridColumn = '1 / -1';
  noHighlightOption.style.padding = '6px';
  noHighlightOption.style.border = '1px solid var(--border)';
  noHighlightOption.style.borderRadius = '4px';
  noHighlightOption.style.background = 'var(--bg)';
  noHighlightOption.style.cursor = 'pointer';
  noHighlightOption.style.display = 'flex';
  noHighlightOption.style.alignItems = 'center';
  noHighlightOption.style.gap = '4px';
  noHighlightOption.textContent = '⭕ No Color';
  noHighlightOption.style.fontSize = '12px';
  noHighlightOption.onclick = (ev) => {
    ev.stopPropagation();
    if (Editor?.restoreSelection) Editor.restoreSelection();
    ColorManager.clear('highlight');
    highlightPaletteContainer.classList.add('hidden');
    highlightPaletteContainer.style.display = 'none';
  };
  noHighlightOption.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  highlightPaletteContainer.appendChild(noHighlightOption);
  
  highlightPaletteContainer.addEventListener('mousedown', (ev) => { ev.stopPropagation(); }, { capture: true });
  highlightBtn.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  highlightBtn.onclick = (ev) => { 
    ev.stopPropagation(); 
    const isHidden = highlightPaletteContainer.classList.toggle('hidden');
    highlightPaletteContainer.style.display = isHidden ? 'none' : 'grid';
    colorPaletteContainer.classList.add('hidden');
    colorPaletteContainer.style.display = 'none';
  };
  
  highlightDropdown.appendChild(highlightBtn);
  highlightDropdown.appendChild(highlightPaletteContainer);

  // Bullet dropdown for context menu
  const bulletDropdown = document.createElement('div');
  bulletDropdown.style.position = 'relative';
  const bulletBtn = document.createElement('button');
  bulletBtn.className = 'ctx-btn';
  bulletBtn.textContent = '• ▼';
  bulletBtn.style.flex = '1';
  const bulletMenuContainer = document.createElement('div');
  bulletMenuContainer.style.position = 'absolute';
  bulletMenuContainer.style.top = '100%';
  bulletMenuContainer.style.left = '0';
  bulletMenuContainer.style.background = 'var(--bg)';
  bulletMenuContainer.style.border = '1px solid var(--border)';
  bulletMenuContainer.style.borderRadius = '8px';
  bulletMenuContainer.style.padding = '6px';
  bulletMenuContainer.style.zIndex = '100';
  bulletMenuContainer.style.marginTop = '4px';
  bulletMenuContainer.style.minWidth = '140px';
  bulletMenuContainer.style.display = 'none';
  ['•', '○', '■'].forEach(bulletChar => {
    const b = document.createElement('button');
    b.style.display = 'block';
    b.style.width = '100%';
    b.style.padding = '6px 10px';
    b.style.border = 'none';
    b.style.background = 'transparent';
    b.style.color = 'var(--text)';
    b.style.cursor = 'pointer';
    b.style.textAlign = 'left';
    b.style.fontSize = '12px';
    b.textContent = bulletChar + ' Bullet';
    b.onclick = (ev) => {
      ev.stopPropagation();
      if (Editor?.restoreSelection) Editor.restoreSelection();
      exec('insertUnorderedList');
      setTimeout(() => {
        try {
          const editor = el("editor");
          if (editor) {
            const uls = editor.querySelectorAll("ul");
            const lastUl = uls[uls.length - 1];
            if (lastUl) {
              lastUl.style.listStyleType = bulletChar === "•" ? "disc" : bulletChar === "○" ? "circle" : "square";
            }
          }
        } catch(e) { console.error("Context bullet style error:", e); }
      }, 10);
      autosave();
      updateRibbonFormatting();
      closeEditorContextMenu();
    };
    b.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
    bulletMenuContainer.appendChild(b);
  });
  const removeBullet = document.createElement('button');
  removeBullet.style.display = 'block';
  removeBullet.style.width = '100%';
  removeBullet.style.padding = '6px 10px';
  removeBullet.style.border = '1px solid var(--border)';
  removeBullet.style.borderRadius = '4px';
  removeBullet.style.background = 'var(--muted)';
  removeBullet.style.color = 'var(--text)';
  removeBullet.style.cursor = 'pointer';
  removeBullet.style.textAlign = 'left';
  removeBullet.style.fontSize = '12px';
  removeBullet.style.marginTop = '4px';
  removeBullet.textContent = 'Remove';
  removeBullet.onclick = (ev) => { ev.stopPropagation(); if (Editor?.restoreSelection) Editor.restoreSelection(); exec('insertUnorderedList'); autosave(); updateRibbonFormatting(); closeEditorContextMenu(); };
  removeBullet.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  bulletMenuContainer.appendChild(removeBullet);
  bulletBtn.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  bulletBtn.onclick = (ev) => { ev.stopPropagation(); bulletMenuContainer.style.display = bulletMenuContainer.style.display === 'none' ? 'block' : 'none'; };
  bulletDropdown.appendChild(bulletBtn);
  bulletDropdown.appendChild(bulletMenuContainer);

  // Number dropdown for context menu
  const numberDropdown = document.createElement('div');
  numberDropdown.style.position = 'relative';
  const numberBtn = document.createElement('button');
  numberBtn.className = 'ctx-btn';
  numberBtn.textContent = '1. ▼';
  numberBtn.style.flex = '1';
  const numberMenuContainer = document.createElement('div');
  numberMenuContainer.style.position = 'absolute';
  numberMenuContainer.style.top = '100%';
  numberMenuContainer.style.left = '0';
  numberMenuContainer.style.background = 'var(--bg)';
  numberMenuContainer.style.border = '1px solid var(--border)';
  numberMenuContainer.style.borderRadius = '8px';
  numberMenuContainer.style.padding = '6px';
  numberMenuContainer.style.zIndex = '100';
  numberMenuContainer.style.marginTop = '4px';
  numberMenuContainer.style.minWidth = '140px';
  numberMenuContainer.style.display = 'none';
  [
    { label: '1. 2. 3.', type: '1' },
    { label: 'a. b. c.', type: 'a' },
    { label: 'i. ii. iii.', type: 'i' },
    { label: 'A. B. C.', type: 'A' },
    { label: 'I. II. III.', type: 'I' }
  ].forEach(num => {
    const b = document.createElement('button');
    b.style.display = 'block';
    b.style.width = '100%';
    b.style.padding = '6px 10px';
    b.style.border = 'none';
    b.style.background = 'transparent';
    b.style.color = 'var(--text)';
    b.style.cursor = 'pointer';
    b.style.textAlign = 'left';
    b.style.fontSize = '12px';
    b.textContent = num.label;
    b.onclick = (ev) => {
      ev.stopPropagation();
      if (Editor?.restoreSelection) Editor.restoreSelection();
      exec('insertOrderedList');
      setTimeout(() => {
        try {
          const editor = el("editor");
          if (editor) {
            const ols = editor.querySelectorAll("ol");
            const lastOl = ols[ols.length - 1];
            if (lastOl) {
              lastOl.type = num.type;
            }
          }
        } catch(e) { console.error("Context number type error:", e); }
      }, 10);
      autosave();
      updateRibbonFormatting();
      closeEditorContextMenu();
    };
    b.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
    numberMenuContainer.appendChild(b);
  });
  const removeNumber = document.createElement('button');
  removeNumber.style.display = 'block';
  removeNumber.style.width = '100%';
  removeNumber.style.padding = '6px 10px';
  removeNumber.style.border = '1px solid var(--border)';
  removeNumber.style.borderRadius = '4px';
  removeNumber.style.background = 'var(--muted)';
  removeNumber.style.color = 'var(--text)';
  removeNumber.style.cursor = 'pointer';
  removeNumber.style.textAlign = 'left';
  removeNumber.style.fontSize = '12px';
  removeNumber.style.marginTop = '4px';
  removeNumber.textContent = 'Remove';
  removeNumber.onclick = (ev) => { ev.stopPropagation(); if (Editor?.restoreSelection) Editor.restoreSelection(); exec('insertOrderedList'); autosave(); updateRibbonFormatting(); closeEditorContextMenu(); };
  removeNumber.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  numberMenuContainer.appendChild(removeNumber);
  numberBtn.addEventListener('mousedown', (ev) => { if (Editor?.saveSelection) Editor.saveSelection(); ev.preventDefault(); }, { capture: true });
  numberBtn.onclick = (ev) => { ev.stopPropagation(); numberMenuContainer.style.display = numberMenuContainer.style.display === 'none' ? 'block' : 'none'; };
  numberDropdown.appendChild(numberBtn);
  numberDropdown.appendChild(numberMenuContainer);

  const alignLeft = btn('⯇', () => { exec('justifyLeft'); autosave(); updateRibbonFormatting(); });
  const alignCenter = btn('≡', () => { exec('justifyCenter'); autosave(); updateRibbonFormatting(); });
  const alignRight = btn('⯈', () => { exec('justifyRight'); autosave(); updateRibbonFormatting(); });

  toolbar.appendChild(fam);
  toolbar.appendChild(size);
  toolbar.appendChild(bold);
  toolbar.appendChild(italic);
  toolbar.appendChild(underline);
  toolbar.appendChild(colorDropdown);
  toolbar.appendChild(highlightDropdown);
  toolbar.appendChild(bulletDropdown);
  toolbar.appendChild(numberDropdown);
  toolbar.appendChild(alignLeft);
  toolbar.appendChild(alignCenter);
  toolbar.appendChild(alignRight);

  // Menu
  const menu = document.createElement('div');
  menu.className = 'editor-menu';

  const addItem = (label, fn, cls) => {
    const it = document.createElement('div');
    it.className = 'editor-menu-item' + (cls ? ' ' + cls : '');
    it.textContent = label;
    // Save selection before click and prevent the menu from stealing focus
    it.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      if (Editor?.saveSelection) Editor.saveSelection();
      ev.preventDefault();
    }, { capture: true });
    it.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch' && Editor?.saveSelection) Editor.saveSelection();
      if (ev.pointerType !== 'touch') ev.preventDefault();
    }, { capture: true });
    it.onclick = async (ev) => { ev.stopPropagation(); if (Editor?.restoreSelection) Editor.restoreSelection(); try { await fn(); } catch(err){} closeAllContextMenus(); };
    menu.appendChild(it);
  };

  addItem('Cut', () => { try { document.execCommand('cut'); autosave(); } catch{} });
  addItem('Copy', () => { try { document.execCommand('copy'); } catch{} });
  addItem('Paste', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const txt = await navigator.clipboard.readText();
        // try to paste as HTML if it looks like HTML
        if (/</.test(txt)) Editor.insertHTML(txt);
        else Editor.insertText(txt);
        autosave();
      } else {
        document.execCommand('paste');
        autosave();
      }
    } catch (err) {
      try { document.execCommand('paste'); } catch{}
    }
  });

  addItem('Paste Text Only', async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) Editor.insertText(txt);
      autosave();
    } catch (err) {
      try { document.execCommand('paste'); } catch{}
    }
  });

  addItem('Set Proofing Language...', async () => {
    await openModal({ title: 'Set proofing language', message: 'Choose language (placeholder).', label: 'Language', value: 'English', okText: 'Set' });
  });

  addItem('Insert Link', async () => { await insertLinkFlow(); });

  addItem('Paragraph Options...', async () => {
    await openModal({ title: 'Paragraph options', message: 'Adjust paragraph settings (placeholder).', label: 'Spacing', value: '1.5', okText: 'Apply' });
  });

  wrap.appendChild(toolbar);
  wrap.appendChild(menu);
  document.body.appendChild(wrap);

  // Only close on clicks outside the context menu
  setTimeout(() => {
    const closeHandler = (ev) => {
      if (!wrap.contains(ev.target)) {
        closeAllContextMenus();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

/* ---------------- Boot ---------------- */

async function boot() {
  await Storage.initIfEmpty();
  await refreshData();
  renderTree();

  // Check if this is the first visit
  const isFirstVisit = await Storage.kvGet("isFirstVisit");

  if (isFirstVisit === true) {
    // Show welcome screen on first install
    showWelcomeScreen();
    // Mark as no longer first visit
    await Storage.kvSet("isFirstVisit", false);
    return;
  }

  // Try to open last active page
  const activeId = await Storage.kvGet("activePageId");
  if (activeId) {
    const page = await Storage.getPage(activeId);
    if (page) {
      await openPage(activeId);
      return;
    }
  }

  // Fallback to first available page
  const firstFolder = state.folders[0];
  const firstPage = firstFolder ? (state.pagesByFolder.get(firstFolder.id) || [])[0] : null;

  if (firstPage) {
    await openPage(firstPage.id);
  } else {
    // No pages available - show welcome screen
    showWelcomeScreen();
  }
}

async function initializeUI() {
  // Restore sidebar width
  const savedWidth = await Storage.kvGet("sidebarWidth");
  if (savedWidth && typeof savedWidth === "number") {
    state.sidebarWidth = savedWidth;
    el("sidebar").style.width = savedWidth + "px";
  }

  // Restore collapsed folders
  const collapsedIds = await Storage.kvGet("collapsedFolders");
  if (Array.isArray(collapsedIds)) {
    state.collapsedFolders = new Set(collapsedIds);
  }
}

(async function main() {
  Editor.setEditor(el("editor"), el("file-picker"));
  Draw.setup(el("draw-canvas"));
  Draw.setEnabled(false);

  // Helps keep insertions (table/link/etc.) at the user's caret position.
  wireKeepCaretOnToolbar();

  wireTabs();
  wireHomeRibbon();
  wireInsertRibbon();
  wireDrawRibbon();
  wireViewRibbon();
  wireBackupRibbon();
  wireDialogs();

  wireSidebar();
  wireEditorAndTodos();

  el("sidebar-toggle").onclick = toggleSidebar;
  el("close-page-btn").onclick = closePage;

  // App title click - navigate to Mini Note website
  document.querySelector(".app-title").onclick = () => {
    window.open("https://tejaadusumilli21.github.io/Mini-Note/", "_blank", "noopener,noreferrer");
  };

  el("supporter-btn").onclick = () => {
    window.open("https://buymeacoffee.com/teamteja3q", "_blank", "noopener,noreferrer");
  };

  const mode = (await Storage.kvGet("themeMode")) || "system";
  applyThemeMode(mode);

  const hidden = (await Storage.kvGet("sidebarHidden")) || false;
  setSidebarHidden(!!hidden);

  await initializeUI();
  initSidebarDivider();

  showRibbon("home");
  await boot();
})();
