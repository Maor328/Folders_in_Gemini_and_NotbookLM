// ============================================================
// NotebookLM Folders — content script
// ============================================================
// Injects a custom folder panel on the NotebookLM home page,
// letting users group notebooks into named folder collections.
//
// Storage : chrome.storage.local → key "notebooklmFolders"
//           (fully independent from Gemini's "geminiFolders")
// Styles  : shared styles.css (same CSS variables / components)
//
// HOW IDENTIFICATION WORKS
// NotebookLM's home page uses an Angular data-table with NO
// anchor tags — navigation is done by Angular Router on click.
// Each notebook is identified by the `title` attribute of its
// <span class="project-table-title"> element, which equals the
// notebook's display name and is unique per user.
//
// ⚠️  If the user renames a notebook inside NotebookLM, the
//     folder entry will no longer match until renamed here too
//     (via the ⋮ menu → "שינוי שם"). This is a known limitation.
// ============================================================

"use strict";

// ---------------------------------------------------------------------------
// SELECTOR CONSTANTS
// These are derived from the actual NotebookLM DOM (inspected live).
// Update them here if Google ever changes the markup.
// ---------------------------------------------------------------------------

/** The <span> inside each table row that holds the notebook name.
 *  Its `title` attribute is the canonical notebook identifier. */
const NB_TITLE_SEL = "span.project-table-title";

/** The table row that wraps a single notebook entry (list view). */
const NB_ROW_SEL = 'tr[role="row"]';

/** The card element that wraps a single notebook entry (grid view). */
const NB_CARD_SEL = "project-button";

/** The ⋮ "Project Actions Menu" button inside each list row. */
const NB_MENU_BTN_SEL = "button.project-button-more";

/** Selectors tried in order to locate the notebook list/grid container.
 *  The folder panel is injected immediately before the first match. */
const NB_TABLE_CONTAINER_SELS = [
  "project-grid",
  "div.project-grid-container",
  "mat-table",
  "[mat-table]",
  ".mat-mdc-table",
  ".mdc-data-table__table",
  "table[role='table']",
  "table",
];

/** Selectors tried in order for NotebookLM's native action-menu panel.
 *  Our "Add / Remove from folder" item is injected into whichever matches. */
const NB_NATIVE_MENU_SELS = [
  ".mat-mdc-menu-content",
  "[role='menu']",
  ".mdc-menu__list",
];

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

let nlmFolders = [];

const overlays = {
  dropdown: null,
  chatMenu: null,
  createModal: null,
  deleteModal: null,
};

/** Tracks the notebook the user most recently hovered or clicked.
 *  { title, sources, date, role, fromFolder: folderId|null } */
let lastContextNotebook = null;

let isMainSectionOpen = false;

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------

/**
 * Find the <tr role="row"> ancestor for a given element inside a notebook row.
 */
function getNotebookRow(el) {
  return el.closest(NB_ROW_SEL);
}

/**
 * Return the notebook details (title, sources, date, role) from a list row OR a grid card element.
 */
function getNotebookDetails(el) {
  let title = "";
  let sources = "";
  let date = "";
  let role = "";

  // List view
  const titleSpan = el.querySelector(NB_TITLE_SEL);
  if (titleSpan) {
    title = (titleSpan.getAttribute("title") || titleSpan.textContent || "").trim();
    
    // In list view, typically we can find the other columns by their content or structure.
    // NotebookLM's table columns: Title, Role, Created, Sources (order may vary).
    // Angular Material might use td, mat-cell, role="gridcell", role="cell", or just plain divs.
    let cells = Array.from(el.querySelectorAll("td, th, [role='cell'], [role='gridcell'], mat-cell, .mat-mdc-cell, .mdc-data-table__cell"));
    if (cells.length === 0) {
      // Fallback: just look at all direct children of the row that contain text
      cells = Array.from(el.children);
    }

    cells.forEach(cell => {
      const text = cell.textContent.replace(/\s+/g, " ").trim();
      if (!text || text === title) return;
      
      const lowerText = text.toLowerCase();
      // Role matching (Owner, Editor, Viewer, etc.)
      if (/^(owner|editor|viewer|בעלים|עורך|צופה)$/i.test(text)) {
        role = text;
      } 
      // Sources matching (10 מקורות, 5 sources)
      else if (lowerText.includes("מקורות") || lowerText.includes("source") || /^\d+$/.test(text)) {
        sources = text;
      } 
      // Date matching (22 בפבר׳ 2026, 2024, ב-2, Jan 14)
      else if (/\d{4}/.test(text) || text.includes("ב-") || text.includes("לפני") || text.includes("בר׳") || text.includes("נוב׳") || text.includes("אוק׳") || text.includes("ספט׳") || text.includes("אוג׳") || text.includes("יול׳") || text.includes("יונ׳") || text.includes("מאי") || text.includes("אפר׳") || text.includes("מרץ") || text.includes("פבר׳") || text.includes("ינו׳")) {
        // Only assign if it's not already assigned to sources
        if (!sources || sources !== text) {
          date = text;
        }
      }
    });

    return { title, sources, date, role };
  }

  // Grid view
  const btn = el.querySelector("button.primary-action-button");
  if (btn) {
    const labelId = btn.getAttribute("aria-labelledby");
    if (labelId) {
      const titleId = labelId.split(" ").find((id) => id.endsWith("-title"));
      if (titleId) {
        const titleEl = document.getElementById(titleId);
        if (titleEl) title = titleEl.textContent.trim();
      }
    }
    // Grid cards often have metadata in subtitle spans
    const subtitles = Array.from(el.querySelectorAll(".mat-mdc-card-subtitle, .subtitle, span"));
    subtitles.forEach(sub => {
      const text = sub.textContent.trim();
      if (!text || text === title) return;

      if (text === "Owner" || text === "Editor" || text === "Viewer" || text === "בעלים" || text === "עורך" || text === "צופה") {
        role = text;
      } else if (text.includes("מקורות") || text.includes("sources")) {
        sources = text;
      } else if (text.match(/\d{4}/) || text.includes("ב-")) {
        date = text;
      }
    });
  }
  
  return { title, sources, date, role };
}

/**
 * Clamp a dropdown's preferred left coordinate so it never
 * overflows outside the visible viewport.
 */
function clampLeft(preferredLeft, menuWidth) {
  return Math.min(
    Math.max(preferredLeft, 8),
    window.innerWidth - menuWidth - 8,
  );
}

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

chrome.storage.local.get(["notebooklmFolders"], (result) => {
  if (result.notebooklmFolders) {
    nlmFolders = result.notebooklmFolders;
    // Migrate older saved data that may lack these fields
    nlmFolders.forEach((f) => {
      if (typeof f.isOpen === "undefined") f.isOpen = false;
      if (typeof f.isPinned === "undefined") f.isPinned = false;
    });
    renderFolders();
  }
});

function saveFolders() {
  // Render immediately (synchronous) so the UI updates without waiting
  // for the async storage write to complete.
  renderFolders();
  try {
    chrome.storage.local.set({ notebooklmFolders: nlmFolders });
  } catch (e) {
    if (!e.message?.includes("Extension context invalidated")) throw e;
  }
}

// ---------------------------------------------------------------------------
// OVERLAY MANAGEMENT
// ---------------------------------------------------------------------------

function closeAllOverlays() {
  Object.keys(overlays).forEach((key) => {
    if (overlays[key]) {
      overlays[key].remove();
      overlays[key] = null;
    }
  });
}

// ---------------------------------------------------------------------------
// HIDE / SHOW NOTEBOOK ROWS
// Rows belonging to a folder are hidden from the main table so they only
// appear inside the folder panel.
// ---------------------------------------------------------------------------

function hideMovedNotebooks() {
  const movedTitles = new Set(
    nlmFolders.flatMap((f) => f.notebooks.map((n) => n.title)),
  );

  // List view — hide table rows
  document.querySelectorAll(NB_ROW_SEL).forEach((row) => {
    if (row.closest("#nblm-custom-folders")) return;
    const { title } = getNotebookDetails(row);
    if (!title) return;
    row.classList.toggle("nblm-hidden-notebook", movedTitles.has(title));
  });

  // Grid view — hide project-button cards
  document.querySelectorAll(NB_CARD_SEL).forEach((card) => {
    if (card.closest("#nblm-custom-folders")) return;
    const { title } = getNotebookDetails(card);
    if (!title) return;
    card.classList.toggle("nblm-hidden-notebook", movedTitles.has(title));
  });
}

// ---------------------------------------------------------------------------
// MODALS — Create folder
// ---------------------------------------------------------------------------

function showCreateFolderModal() {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.innerHTML = `
    <div class="folder-modal">
      <h2 style="color:white;margin:0 0 16px;font-size:24px;font-weight:400;">שם תיקייה:</h2>
      <input type="text" id="nblm-new-folder-input" placeholder="הזן שם לתיקייה..." autocomplete="off" spellcheck="false">
      <div style="display:flex;flex-direction:row-reverse;gap:12px;">
        <button class="confirm-btn-blue" id="nblm-confirm-create">אישור</button>
        <button class="cancel-btn-plain" id="nblm-cancel-create">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  overlays.createModal = modal;

  const input = document.getElementById("nblm-new-folder-input");
  input?.focus();

  const confirm = () => {
    const name = input?.value.trim();
    if (name) {
      nlmFolders.push({
        id: "f" + Date.now(),
        name,
        color: "#a8c7fa",
        notebooks: [],
        isOpen: false,
        isPinned: false,
      });
      saveFolders();
      closeAllOverlays();
    }
  };

  document
    .getElementById("nblm-confirm-create")
    ?.addEventListener("click", confirm);
  document
    .getElementById("nblm-cancel-create")
    ?.addEventListener("click", closeAllOverlays);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirm();
    if (e.key === "Escape") closeAllOverlays();
  });
}

// ---------------------------------------------------------------------------
// MODALS — Delete folder
// ---------------------------------------------------------------------------

function showDeleteFolderModal(folder) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.setAttribute("tabindex", "-1");
  modal.innerHTML = `
    <div class="folder-modal">
      <h2 style="color:white;margin:0 0 16px;font-size:24px;font-weight:400;">למחוק את התיקייה?</h2>
      <p style="color:#c4c7c5;margin:0 0 24px;font-size:14px;">מחיקת התיקייה לא תמחק את המחברות שבתוכה.</p>
      <div style="display:flex;flex-direction:row-reverse;gap:12px;">
        <button class="confirm-btn-blue" id="nblm-confirm-del">מחיקה</button>
        <button class="cancel-btn-plain" id="nblm-cancel-del">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  overlays.deleteModal = modal;
  modal.focus();

  const doDelete = () => {
    nlmFolders = nlmFolders.filter((f) => f.id !== folder.id);
    saveFolders();
    closeAllOverlays();
  };
  document
    .getElementById("nblm-cancel-del")
    ?.addEventListener("click", closeAllOverlays);
  document
    .getElementById("nblm-confirm-del")
    ?.addEventListener("click", doDelete);
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doDelete();
    if (e.key === "Escape") closeAllOverlays();
  });
}

// ---------------------------------------------------------------------------
// MODALS — Rename folder
// ---------------------------------------------------------------------------

function showRenameFolderModal(folder) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.innerHTML = `
    <div class="folder-modal">
      <h2 style="color:white;margin:0 0 16px;font-size:24px;font-weight:400;">שינוי שם תיקייה:</h2>
      <input type="text" id="nblm-rename-folder-input" autocomplete="off" spellcheck="false">
      <div style="display:flex;flex-direction:row-reverse;gap:12px;">
        <button class="confirm-btn-blue" id="nblm-confirm-rename-folder">אישור</button>
        <button class="cancel-btn-plain" id="nblm-cancel-rename-folder">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  overlays.createModal = modal;

  const input = document.getElementById("nblm-rename-folder-input");
  if (input) {
    input.value = folder.name;
    input.focus();
    input.select();
  }

  const confirm = () => {
    const newName = input?.value.trim();
    if (newName && newName !== folder.name) {
      folder.name = newName;
      saveFolders();
    }
    closeAllOverlays();
  };
  document
    .getElementById("nblm-confirm-rename-folder")
    ?.addEventListener("click", confirm);
  document
    .getElementById("nblm-cancel-rename-folder")
    ?.addEventListener("click", closeAllOverlays);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirm();
    if (e.key === "Escape") closeAllOverlays();
  });
}

// ---------------------------------------------------------------------------
// MODALS — Rename notebook (local label only — does not rename in NLM itself)
// ---------------------------------------------------------------------------

function showRenameNotebookModal(oldTitle) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.innerHTML = `
    <div class="folder-modal" style="width:360px;padding:28px 24px 20px;">
      <div style="position:relative;margin-bottom:20px;">
        <label style="
          position:absolute;top:-9px;right:12px;
          font-size:11px;color:#a8c7fa;
          background:#282a2c;padding:0 4px;
          font-family:'Google Sans',sans-serif;">הכותרת של ה-Notebook*</label>
        <input type="text" id="nblm-rename-input" autocomplete="off" spellcheck="false"
          style="width:100%;box-sizing:border-box;background:transparent;
            border:2px solid #a8c7fa;border-radius:4px;padding:14px 12px 10px;
            color:white;font-size:15px;outline:none;font-family:'Google Sans',sans-serif;">
      </div>
      <p style="color:#8e918f;font-size:12px;margin:0 0 20px;text-align:right;">
        הערה: שינוי שם כאן לא ישנה את השם ב-NotebookLM עצמו.
      </p>
      <div style="display:flex;flex-direction:row;gap:12px;justify-content:flex-start;">
        <button class="confirm-btn-blue" id="nblm-confirm-rename">שמירה</button>
        <button class="cancel-btn-plain" id="nblm-cancel-rename">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  overlays.createModal = modal;

  const input = document.getElementById("nblm-rename-input");
  if (input) {
    input.value = oldTitle;
    input.focus();
    input.select();
  }

  const confirm = () => {
    const newTitle = input?.value.trim();
    if (newTitle && newTitle !== oldTitle) {
      nlmFolders.forEach((f) =>
        f.notebooks.forEach((n) => {
          if (n.title === oldTitle) n.title = newTitle;
        }),
      );
      saveFolders();
    }
    closeAllOverlays();
  };
  document
    .getElementById("nblm-confirm-rename")
    ?.addEventListener("click", confirm);
  document
    .getElementById("nblm-cancel-rename")
    ?.addEventListener("click", closeAllOverlays);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirm();
    if (e.key === "Escape") closeAllOverlays();
  });
}

// ---------------------------------------------------------------------------
// MODALS — Remove notebook from folder
// ---------------------------------------------------------------------------

function showRemoveNotebookModal(title, folderId) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.setAttribute("tabindex", "-1");
  modal.innerHTML = `
    <div class="folder-modal">
      <h2 style="color:white;margin:0 0 16px;font-size:24px;font-weight:400;">הסרה מהתיקייה?</h2>
      <p style="color:#c4c7c5;margin:0 0 24px;font-size:14px;">המחברת תחזור לרשימה הראשית.</p>
      <div style="display:flex;flex-direction:row-reverse;gap:12px;">
        <button class="confirm-btn-blue" id="nblm-confirm-remove">הסרה</button>
        <button class="cancel-btn-plain" id="nblm-cancel-remove">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  overlays.deleteModal = modal;
  modal.focus();

  const doRemove = () => {
    const f = nlmFolders.find((f) => f.id === folderId);
    if (f) f.notebooks = f.notebooks.filter((n) => n.title !== title);
    saveFolders();
    closeAllOverlays();
  };
  document
    .getElementById("nblm-cancel-remove")
    ?.addEventListener("click", closeAllOverlays);
  document
    .getElementById("nblm-confirm-remove")
    ?.addEventListener("click", doRemove);
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doRemove();
    if (e.key === "Escape") closeAllOverlays();
  });
}

// ---------------------------------------------------------------------------
// DROPDOWN — Folder options (pin / delete folder)
// ---------------------------------------------------------------------------

function openFolderOptions(e, folder) {
  e.stopPropagation();
  e.preventDefault();
  closeAllOverlays();

  const menu = document.createElement("div");
  menu.className = "folder-dropdown";

  const pinLabel = folder.isPinned ? "הסר הצמדה" : "הצמד תיקייה";
  const pinPath = folder.isPinned
    ? "M19 13H5v-2h14v2z"
    : "M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v7l1 1 1-1v-7h5v-2l-2-2z";

  menu.innerHTML = `
    <div class="folder-dropdown-item" id="nblm-opt-pin">
      <span style="flex-grow:1;text-align:right;">${pinLabel}</span>
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="${pinPath}"/></svg>
    </div>
    <div class="folder-dropdown-item" id="nblm-opt-rename">
      <span style="flex-grow:1;text-align:right;">שינוי שם</span>
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
    </div>
    <div class="folder-dropdown-item" id="nblm-opt-delete">
      <span style="flex-grow:1;text-align:right;">מחק תיקייה</span>
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
    </div>`;

  document.body.appendChild(menu);
  overlays.chatMenu = menu;

  const rect = e.target.getBoundingClientRect();
  const mw = 175;
  menu.style.top = `${rect.top}px`;
  menu.style.left = `${clampLeft(rect.left - mw, mw)}px`;

  menu.querySelector("#nblm-opt-pin")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    folder.isPinned = !folder.isPinned;
    saveFolders();
    closeAllOverlays();
  });
  menu.querySelector("#nblm-opt-rename")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    showRenameFolderModal(folder);
  });
  menu.querySelector("#nblm-opt-delete")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    showDeleteFolderModal(folder);
  });
}

// ---------------------------------------------------------------------------
// DROPDOWN — Pick a folder to add a notebook into
// ---------------------------------------------------------------------------

function openFolderSelectionMenu(x, y, details) {
  closeAllOverlays();
  const menu = document.createElement("div");
  menu.className = "folder-dropdown nblm-top";

  // Prevent menu-internal clicks from reaching the document mousedown handler
  menu.addEventListener("mousedown", (e) => e.stopPropagation());
  menu.addEventListener("click", (e) => e.stopPropagation());

  if (nlmFolders.length === 0) {
    menu.innerHTML = `<div class="folder-dropdown-item" style="color:#c4c7c5;justify-content:center;">אין תיקיות עדיין</div>`;
  }

  nlmFolders.forEach((f) => {
    const item = document.createElement("div");
    item.className = "folder-dropdown-item";
    item.innerHTML = `
      <span style="flex-grow:1;text-align:right;font-size:14px;">${f.name}</span>
      <svg width="18" height="18" style="fill:${f.color};" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>`;
    item.onclick = (e) => {
      e.stopPropagation();
      // Avoid duplicates
      if (!f.notebooks.find((n) => n.title === details.title)) {
        // Include the rich details
        f.notebooks.push({ 
          title: details.title, 
          sources: details.sources, 
          date: details.date, 
          role: details.role 
        });
        saveFolders();
      }
      closeAllOverlays();
    };
    menu.appendChild(item);
  });

  // Appending after the CDK overlay container guarantees DOM order wins
  // even when z-index values are identical (same stacking context).
  const cdkOverlay = document.querySelector(".cdk-overlay-container");
  if (cdkOverlay && cdkOverlay.parentNode) {
    cdkOverlay.insertAdjacentElement("afterend", menu);
  } else {
    document.body.appendChild(menu);
  }
  overlays.dropdown = menu;

  const mw = 230;
  const menuHeight = menu.offsetHeight;
  let top = y - 10;
  if (top + menuHeight > window.innerHeight)
    top = window.innerHeight - menuHeight - 20;
  menu.style.top = `${top}px`;
  menu.style.left = `${clampLeft(x - mw, mw)}px`;
}

// ---------------------------------------------------------------------------
// DROPDOWN — Per-notebook context menu (⋮ inside a folder row)
// ---------------------------------------------------------------------------

function openNotebookContextMenu(e, title, folderId) {
  closeAllOverlays();

  const menu = document.createElement("div");
  menu.className = "folder-dropdown";
  menu.style.zIndex = "2147483647";

  const options = [
    {
      label: "שינוי השם",
      icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
      action: "rename",
    },
    {
      label: "הסר מהתיקייה",
      icon: "M19 13H5v-2h14v2z",
      action: "remove",
    },
  ];

  options.forEach((opt) => {
    const item = document.createElement("div");
    item.className = "folder-dropdown-item";
    item.innerHTML = `
      <span style="flex-grow:1;text-align:right;font-size:14px;">${opt.label}</span>
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="${opt.icon}"/></svg>`;
    item.onclick = (event) => {
      event.stopPropagation();
      closeAllOverlays();

      if (opt.action === "remove") {
        showRemoveNotebookModal(title, folderId);
        return;
      }

      // Rename: delegate to NLM's native rename dialog.
      // Find the hidden row/card, reveal it off-screen, click its ⋮ button,
      // then click the native "עריכת השם" item — same pattern as Gemini.
      const allSpans = Array.from(document.querySelectorAll(NB_TITLE_SEL));
      const titleSpan = allSpans.find(
        (s) =>
          !s.closest("#nblm-custom-folders") &&
          (s.getAttribute("title") || s.textContent).trim() === title,
      );
      const row = titleSpan ? getNotebookRow(titleSpan) : null;
      const menuBtn = row?.querySelector(NB_MENU_BTN_SEL);

      if (!menuBtn) {
        // Fallback: row not in DOM (e.g. grid view) — show our own modal
        showRenameNotebookModal(title);
        return;
      }

      // Reveal the row using the same off-screen technique as Gemini's
      // Delete/Share flow. Programmatic .click() bypasses pointer-events and
      // visibility — Angular's event binding still receives the click.
      const wasHidden = row.classList.contains("nblm-hidden-notebook");
      if (wasHidden) {
        row.classList.remove("nblm-hidden-notebook");
        row.classList.add("nblm-temp-reveal");
      }

      menuBtn.click();

      const restore = () => {
        if (wasHidden) {
          row.classList.remove("nblm-temp-reveal");
          row.classList.add("nblm-hidden-notebook");
        }
        blocker.remove();
      };

      // Cover the page so the native menu (which opens at real coordinates)
      // is not visible to the user while we auto-click "עריכת השם".
      const blocker = document.createElement("div");
      blocker.style.cssText =
        "position:fixed;inset:0;z-index:2147483645;background:transparent;pointer-events:none;";
      document.body.appendChild(blocker);

      const safetyTimer = setTimeout(() => {
        obs.disconnect();
        restore();
        showRenameNotebookModal(title); // fallback after 3s
      }, 3000);

      // KEY FIX: keep watching until "עריכת השם" specifically appears.
      // Angular adds menu items asynchronously after the container is injected,
      // so we must NOT disconnect on the first mutation — only when we find
      // the exact button we need.
      const obs = new MutationObserver(() => {
        const allItems = Array.from(
          document.querySelectorAll(
            ".mat-mdc-menu-content button, .mat-mdc-menu-item, [role='menuitem']",
          ),
        );
        const renameBtn = allItems.find((btn) =>
          btn.textContent.trim().includes("עריכת השם"),
        );
        if (!renameBtn) return; // not ready yet — keep watching

        obs.disconnect();
        clearTimeout(safetyTimer);
        renameBtn.click();
        restore();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  overlays.chatMenu = menu;

  const rect = e.target.getBoundingClientRect();
  const mw = 190;
  let top = rect.top;
  if (top + 120 > window.innerHeight) top = window.innerHeight - 130;
  menu.style.top = `${top}px`;
  menu.style.left = `${clampLeft(rect.left - mw, mw)}px`;
}

// ---------------------------------------------------------------------------
// NATIVE MENU INJECTION
// When the user opens NotebookLM's ⋮ menu on a notebook row, we inject an
// "Add to folder" / "Remove from folder" item at the top of the native panel.
// ---------------------------------------------------------------------------

function injectFolderOptionIntoNativeMenu(menuContainer) {
  // Idempotent — never inject twice into the same menu instance
  if (menuContainer.querySelector(".nblm-folder-option")) return;

  const anchorItem = menuContainer.querySelector(
    "button, li, [role='menuitem'], .mat-mdc-menu-item",
  );
  if (!anchorItem) return;

  const details = lastContextNotebook ? { 
    title: lastContextNotebook.title, 
    sources: lastContextNotebook.sources, 
    date: lastContextNotebook.date, 
    role: lastContextNotebook.role 
  } : null;
  const isFromFolder = !!lastContextNotebook?.fromFolder;
  const folderId = lastContextNotebook?.fromFolder || null;

  const item = document.createElement("div");
  item.className = "nblm-folder-option";

  const iconPath = isFromFolder
    ? "M19 13H5v-2h14v2z"
    : "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z";

  item.innerHTML = `
    <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="${iconPath}"/></svg>
    <span style="flex-grow:1;text-align:right;direction:rtl;">${isFromFolder ? "הסר מהתיקייה שלי" : "הוסף לתיקייה שלי"}</span>`;

  item.addEventListener("click", (e) => {
    e.stopPropagation();

    if (isFromFolder) {
      // Remove immediately — close the native menu first
      document.querySelector(".cdk-overlay-backdrop")?.click();
      const f = nlmFolders.find((f) => f.id === folderId);
      if (f) {
        f.notebooks = f.notebooks.filter((n) => n.title !== details.title);
        saveFolders();
      }
    } else if (details && details.title) {
      // Freeze click coordinates before closing the native menu
      const x = e.clientX;
      const y = e.clientY;
      // Close the native NLM dropdown — this removes the CDK overlay so our
      // menu can appear on top instead of behind it
      document.querySelector(".cdk-overlay-backdrop")?.click();
      // Open after a single frame so the CDK overlay is gone from the DOM
      requestAnimationFrame(() => openFolderSelectionMenu(x, y, details));
    }
  });

  anchorItem.insertAdjacentElement("afterend", item);
}

// ---------------------------------------------------------------------------
// RENDER FOLDERS PANEL
// ---------------------------------------------------------------------------

function renderFolders() {
  const list = document.getElementById("nblm-folders-list");
  if (!list) return;

  list.classList.toggle("open", isMainSectionOpen);
  document
    .getElementById("nblm-folders-header")
    ?.classList.toggle("is-open", isMainSectionOpen);

  list.innerHTML = "";

  // Pinned folders always float to the top
  const sorted = [...nlmFolders].sort(
    (a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0),
  );

  sorted.forEach((folder) => {
    const color = folder.color || "#a8c7fa";
    const isOpen = folder.isOpen === true;
    const isPinned = folder.isPinned === true;

    const wrapper = document.createElement("div");
    wrapper.className = "folder-group";
    wrapper.innerHTML = `
      <div class="custom-folder-item ${isOpen ? "is-open" : ""} ${isPinned ? "is-pinned" : ""}">
        <div class="folder-icon-wrapper" style="position:relative;display:flex;">
          <svg width="18" height="18" style="fill:${color};" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
          <input type="color" class="folder-color-picker" value="${color}" style="position:absolute;opacity:0;inset:0;cursor:pointer;">
        </div>
        <span class="folder-name">${folder.name}</span>
        <div class="pin-icon-svg" style="display:${isPinned ? "flex" : "none"};margin-left:6px;color:#a8c7fa;align-items:center;">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v7l1 1 1-1v-7h5v-2l-2-2z"/></svg>
        </div>
        <div class="folder-arrow-svg">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="folder-menu-btn">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
        </div>
      </div>
      <div class="folder-chats ${isOpen ? "open" : ""}" style="padding-right:16px;">
        ${folder.notebooks.length > 0 ? `
          <div class="folder-chat-item nblm-table-header" style="cursor:default; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:4px; margin-bottom:8px; display:flex;">
            <div style="flex:1.5; color:#a8c7fa; font-size:12px; font-weight:500; text-align:right;">שם המחברת</div>
            <div style="flex:1; color:#a8c7fa; font-size:12px; font-weight:500; text-align:right; padding-right:8px;">מקורות</div>
            <div style="flex:1; color:#a8c7fa; font-size:12px; font-weight:500; text-align:right; padding-right:8px;">תאריך יצירה</div>
            <div style="flex:0.8; color:#a8c7fa; font-size:12px; font-weight:500; text-align:right; padding-right:8px;">תפקיד</div>
            <div style="width:24px;"></div> <!-- spacer -->
          </div>
        ` : ''}
        ${folder.notebooks
          .map(
            (nb) => `
          <div class="folder-chat-item" style="display:flex;">
            <div class="nblm-nb-title-btn"
                 data-title="${nb.title}"
                 style="flex:1.5; text-align:right; font-size:13px; cursor:pointer; color:#e3e3e3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" 
                 title="${nb.title}">
              ${nb.title}
            </div>
            <div style="flex:1; font-size:13px; color:#c4c7c5; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px;">
              ${nb.sources || '-'}
            </div>
            <div style="flex:1; font-size:13px; color:#c4c7c5; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px;">
              ${nb.date || '-'}
            </div>
            <div style="flex:0.8; font-size:13px; color:#c4c7c5; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px;">
              ${nb.role || '-'}
            </div>
            <div class="folder-chat-menu-btn"
                 data-title="${nb.title}"
                 data-folder="${folder.id}"
                 style="padding:4px; opacity:0.5; width:24px; flex-shrink:0; cursor:pointer; display:flex; justify-content:center;">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
            </div>
          </div>`,
          )
          .join("")}
      </div>`;

    // Toggle folder open / closed
    wrapper
      .querySelector(".custom-folder-item")
      ?.addEventListener("click", (e) => {
        if (e.target.closest(".folder-menu-btn") || e.target.type === "color")
          return;
        folder.isOpen = !folder.isOpen;
        saveFolders();
      });

    wrapper
      .querySelector(".folder-menu-btn")
      ?.addEventListener("click", (e) => {
        openFolderOptions(e, folder);
      });

    wrapper
      .querySelector(".folder-color-picker")
      ?.addEventListener("change", (e) => {
        folder.color = e.target.value;
        saveFolders();
      });

    // Click on a notebook title → find its entry in the live DOM and click it
    // to trigger Angular router navigation. The entry is briefly un-hidden so
    // Angular's click handler can fire, then re-hidden after navigation.
    wrapper.querySelectorAll(".nblm-nb-title-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTitle = btn.dataset.title;

        // Try list view first (span.project-table-title)
        const allSpans = Array.from(document.querySelectorAll(NB_TITLE_SEL));
        const titleSpan = allSpans.find(
          (span) =>
            !span.closest("#nblm-custom-folders") &&
            (span.getAttribute("title") || span.textContent).trim() ===
              targetTitle,
        );

        if (titleSpan) {
          const row = getNotebookRow(titleSpan);
          const entry = row || titleSpan;
          entry.classList.remove("nblm-hidden-notebook");
          titleSpan.click();
          setTimeout(() => entry.classList.add("nblm-hidden-notebook"), 200);
          return;
        }

        // Try grid view (project-button card — click its primary action button)
        const allCards = Array.from(document.querySelectorAll(NB_CARD_SEL));
        const card = allCards.find(
          (c) =>
            !c.closest("#nblm-custom-folders") &&
            getNotebookDetails(c).title === targetTitle,
        );
        if (card) {
          card.classList.remove("nblm-hidden-notebook");
          const actionBtn = card.querySelector("button.primary-action-button");
          (actionBtn || card).click();
          setTimeout(() => card.classList.add("nblm-hidden-notebook"), 200);
        }
      });
    });

    // Per-notebook ⋮ menu (rename / remove from folder)
    wrapper.querySelectorAll(".folder-chat-menu-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNotebookContextMenu(e, btn.dataset.title, btn.dataset.folder);
      });
    });

    list.appendChild(wrapper);
  });

  hideMovedNotebooks();
}

// ---------------------------------------------------------------------------
// INJECT FOLDERS PANEL into the page
// ---------------------------------------------------------------------------

function injectFoldersUI() {
  if (document.getElementById("nblm-custom-folders")) return;

  // Find the notebook table and insert our panel directly above it
  let anchor = null;
  for (const sel of NB_TABLE_CONTAINER_SELS) {
    anchor = document.querySelector(sel);
    if (anchor) break;
  }
  if (!anchor) return;

  const panel = document.createElement("div");
  panel.id = "nblm-custom-folders";
  panel.innerHTML = `
    <div id="nblm-folders-header" class="${isMainSectionOpen ? "is-open" : ""}">
      <h3 id="nblm-folders-title">התיקיות שלי</h3>
      <button id="nblm-add-folder-btn">+ הוספת תיקייה</button>
      <div id="nblm-folders-arrow">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
    <div id="nblm-folders-list" class="${isMainSectionOpen ? "open" : ""}"></div>`;

  anchor.insertAdjacentElement("beforebegin", panel);

  document
    .getElementById("nblm-folders-header")
    ?.addEventListener("click", (e) => {
      if (e.target.closest("#nblm-add-folder-btn")) return;
      isMainSectionOpen = !isMainSectionOpen;
      renderFolders();
    });

  document
    .getElementById("nblm-add-folder-btn")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      showCreateFolderModal();
    });

  renderFolders();
}

// ---------------------------------------------------------------------------
// EVENT LISTENERS
// ---------------------------------------------------------------------------

// Mouseover: track which notebook is hovered so we know which one
// NotebookLM's ⋮ menu will refer to when it opens shortly after.
// Works for both list view (tr rows) and grid view (project-button cards).
document.addEventListener(
  "mouseover",
  (e) => {
    const entry = e.target.closest(NB_ROW_SEL) || e.target.closest(NB_CARD_SEL);
    if (!entry || entry.closest("#nblm-custom-folders")) return;

    const details = getNotebookDetails(entry);
    if (!details.title || details.title === lastContextNotebook?.title) return;

    let fromFolder = null;
    nlmFolders.forEach((f) => {
      if (f.notebooks.some((n) => n.title === details.title)) fromFolder = f.id;
    });
    
    lastContextNotebook = { 
      title: details.title, 
      sources: details.sources, 
      date: details.date, 
      role: details.role,
      fromFolder 
    };
  },
  true,
);

// Mousedown: close overlays when clicking outside our UI.
document.addEventListener(
  "mousedown",
  (e) => {
    const insideOurUI = !!e.target.closest(
      ".folder-dropdown, .folder-modal-overlay, #nblm-custom-folders, .nblm-folder-option",
    );
    if (insideOurUI) return;
    closeAllOverlays();
  },
  true,
);

// ---------------------------------------------------------------------------
// MUTATION OBSERVER
// Watches for new DOM nodes — re-injects our panel after SPA navigation and
// detects NotebookLM's native action menu so we can add our folder option.
//
// PERFORMANCE NOTES
// Angular SPA fires thousands of mutations on initial load. To avoid
// slowing down page render we:
//   1. Don't start the observer until the page is visually settled.
//   2. Only run querySelector on nodes large enough to contain a menu.
//   3. Skip hideMovedNotebooks entirely when no folders exist.
//   4. Increase debounce to 300ms so the callback fires once per navigation
//      instead of dozens of times per second during Angular's render cycle.
// ---------------------------------------------------------------------------

let nbDomTimer = null;

const nbObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;

      // Only run the expensive querySelector on nodes that could plausibly
      // contain a menu (must have child elements — text/leaf nodes are skipped).
      if (!node.firstElementChild) continue;

      for (const sel of NB_NATIVE_MENU_SELS) {
        const menuContainer = node.matches(sel)
          ? node
          : node.querySelector(sel);
        if (menuContainer) {
          injectFolderOptionIntoNativeMenu(menuContainer);
          break;
        }
      }
    }
  }

  // Debounced UI work — 300ms gives Angular time to finish its render batch
  // before we do our own DOM queries, preventing cascade re-renders.
  if (nbDomTimer) clearTimeout(nbDomTimer);
  nbDomTimer = setTimeout(() => {
    injectFoldersUI();
    // Skip the DOM walk entirely when there are no folders to hide
    if (nlmFolders.length > 0) hideMovedNotebooks();
  }, 300);
});

// Delay observer start until the page is visually settled.
// "load" fires after all resources are ready — Angular's initial render
// is complete by then, so we miss none of the meaningful mutations.
window.addEventListener("load", () => {
  nbObserver.observe(document.body, { childList: true, subtree: true });
  // One-time initial run after load
  injectFoldersUI();
  if (nlmFolders.length > 0) hideMovedNotebooks();
});

// ---------------------------------------------------------------------------
// INITIAL RUN (before load — handles cases where script runs late)
// ---------------------------------------------------------------------------

if (document.readyState === "complete") {
  // Script injected after load event already fired
  nbObserver.observe(document.body, { childList: true, subtree: true });
  injectFoldersUI();
  if (nlmFolders.length > 0) hideMovedNotebooks();
}
