const Editor = (() => {
  let editorEl;
  let filePickerEl;
  let lastRange = null;
  let _boundSelectionChange = null;
  const MARKER_ID = "caret-marker-" + Date.now();

  function saveSelection() {
    if (!editorEl) return;
    
    // Remove old marker if it exists
    const oldMarker = editorEl.querySelector(`#${MARKER_ID}`);
    if (oldMarker) oldMarker.remove();
    
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!editorEl.contains(r.commonAncestorContainer)) return;
    
    // Save range for fallback
    lastRange = r.cloneRange();
    
    // Insert a marker element at the cursor position
    try {
      const marker = document.createElement("span");
      marker.id = MARKER_ID;
      marker.style.display = "none";
      marker.textContent = "";
      r.insertNode(marker);
    } catch (e) {
      // Fallback if marker insertion fails
    }
  }

  function restoreSelection() {
    if (!editorEl) return;
    editorEl.focus();
    
    // Try to find and restore from marker
    const marker = editorEl.querySelector(`#${MARKER_ID}`);
    if (marker) {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStartBefore(marker);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        marker.remove();
        return;
      }
    }
    
    // Fallback: try to restore from saved range
    const sel = window.getSelection();
    if (!sel) return;

    if (lastRange && editorEl.contains(lastRange.commonAncestorContainer)) {
      try {
        sel.removeAllRanges();
        sel.addRange(lastRange);
        return;
      } catch (e) {
        // Range is invalid, continue to next fallback
      }
    }

    // Final fallback: place caret at end of editor
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function setEditor(el, filePicker) {
    editorEl = el;
    filePickerEl = filePicker;

    // Track the last caret/selection inside the editor so toolbar/modal insertions
    // happen where the cursor was (not at the start).
    ["keyup", "mouseup", "touchend", "input", "focus", "blur"].forEach((evt) => {
      editorEl.addEventListener(evt, saveSelection);
    });

    // Don't let toolbar clicks overwrite the last caret position.
    // Only update on selectionchange when the editor itself is focused.
    if (_boundSelectionChange) document.removeEventListener("selectionchange", _boundSelectionChange);
    _boundSelectionChange = () => {
      if (document.activeElement === editorEl) saveSelection();
    };
    document.addEventListener("selectionchange", _boundSelectionChange);

    // Prime selection on first load
    queueMicrotask(saveSelection);
  }

  function insertHTML(html) {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editorEl || !editorEl.contains(range.commonAncestorContainer)) return;

    range.deleteContents();
    const t = document.createElement("template");
    t.innerHTML = html;
    const nodes = Array.from(t.content.childNodes);
    const last = nodes[nodes.length - 1] || null;
    range.insertNode(t.content);

    // Place caret after the inserted content
    if (last) {
      const r2 = document.createRange();
      r2.setStartAfter(last);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
    }
    saveSelection();
  }

  function insertText(text) {
    restoreSelection();
    // execCommand keeps native editing behavior (smart insert, undo stack, etc.)
    document.execCommand("insertText", false, text);
    saveSelection();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function insertPicture() {
    if (!filePickerEl) return;
    saveSelection();
    filePickerEl.value = "";
    filePickerEl.onchange = async () => {
      const f = filePickerEl.files?.[0];
      if (!f) return;
      const dataUrl = await fileToDataUrl(f);
      insertHTML(`<img src="${dataUrl}" style="max-width:100%; border-radius:12px; border:1px solid #d1d5db;" />`);
    };
    filePickerEl.click();
  }

  function insertAudio() {
    window.dispatchEvent(new CustomEvent("teja-toast", { detail: "Audio insert is a placeholder (offline storage coming soon)." }));
  }

  return {
    setEditor,
    insertHTML,
    insertText,
    insertPicture,
    insertAudio,
    saveSelection,
    restoreSelection
  };
})();
