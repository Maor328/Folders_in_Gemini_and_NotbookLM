let myFolders = [];
const overlays = {
  dropdown: null,
  chatMenu: null,
  createModal: null,
  deleteModal: null,
};
let lastContextChat = null;
let isMainSectionOpen = false;

// Normalize any Gemini chat href (absolute OR relative) to just the path.
// Gemini sometimes uses absolute URLs like https://gemini.google.com/app/ID
// and sometimes relative like /app/ID — this handles both uniformly.
function chatPath(href) {
  if (!href) return "";
  try {
    // Remove query string then extract pathname for absolute URLs
    const url = new URL(href, window.location.origin);
    return url.pathname; // e.g. "/app/22610c776770c88d"
  } catch {
    return href.split("?")[0];
  }
}

// CSS selector that matches chat links whether href is relative or absolute
const CHAT_LINK_SEL = 'a[href*="/app/"]';

chrome.storage.local.get(["geminiFolders"], function (result) {
  if (result.geminiFolders) {
    myFolders = result.geminiFolders;
    myFolders.forEach((f) => {
      if (typeof f.isOpen === "undefined") f.isOpen = false;
      if (typeof f.isPinned === "undefined") f.isPinned = false;
    });
    renderFolders();
  }
});

function saveFolders() {
  chrome.storage.local.set({ geminiFolders: myFolders }, renderFolders);
}

function closeAllOverlays() {
  Object.keys(overlays).forEach((key) => {
    if (overlays[key]) {
      overlays[key].remove();
      overlays[key] = null;
    }
  });
  // Note: gemini-action-in-progress is NOT removed here.
  // It is managed explicitly by the action handlers in openChatContextMenu
  // to prevent premature exposure of Google's native menu panel.
}

function hideMovedChats() {
  const movedUrls = new Set(
    myFolders.flatMap((f) => f.chats.map((c) => chatPath(c.url))),
  );

  document.querySelectorAll(CHAT_LINK_SEL).forEach((chatLink) => {
    if (chatLink.closest("#gemini-custom-folders")) return;

    const chatUrl = chatPath(chatLink.getAttribute("href"));
    const container =
      chatLink.closest("li") ||
      chatLink.closest(".navigation-item") ||
      chatLink.parentElement;

    if (container) {
      if (movedUrls.has(chatUrl)) {
        // FIX 1: Also skip hiding if the item is temporarily revealed for a
        // Delete/Share action. Without this check, the MutationObserver can
        // re-add gemini-hidden-chat before Google's menu finishes loading,
        // silently breaking those operations.
        if (
          !container.classList.contains("gemini-renaming-chat") &&
          !container.classList.contains("gemini-temp-reveal")
        ) {
          container.classList.add("gemini-hidden-chat");
        }
      } else {
        container.classList.remove("gemini-hidden-chat");
        const props = [
          "position",
          "opacity",
          "pointer-events",
          "height",
          "width",
          "margin",
          "padding",
          "border",
          "overflow",
          "z-index",
          "top",
          "left",
          "display",
        ];
        props.forEach((p) => container.style.removeProperty(p));
      }
    }
  });
}

function showCreateFolderModal() {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.innerHTML = `
        <div class="folder-modal">
            <h2 style="color:white; margin:0 0 16px; font-size:24px; font-weight:400;">שם תיקייה:</h2>
            <input type="text" id="new-folder-name-input" placeholder="הזן שם לתיקייה..." autocomplete="off" spellcheck="false">
            <div style="display:flex; flex-direction: row-reverse; gap:12px;">
                <button class="confirm-btn-blue" id="confirm-create-folder">אישור</button>
                <button class="cancel-btn-plain" id="cancel-create-folder">ביטול</button>
            </div>
        </div>`;
  document.body.appendChild(modal);
  overlays.createModal = modal;

  const input = document.getElementById("new-folder-name-input");
  if (input) input.focus();

  const handleConfirm = () => {
    if (!input) return;
    const name = input.value.trim();
    if (name) {
      myFolders.push({
        id: "f" + Date.now(),
        name,
        color: "#a8c7fa",
        chats: [],
        isOpen: false,
        isPinned: false,
      });
      saveFolders();
      closeAllOverlays();
    }
  };

  document
    .getElementById("confirm-create-folder")
    ?.addEventListener("click", handleConfirm);
  document
    .getElementById("cancel-create-folder")
    ?.addEventListener("click", closeAllOverlays);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") closeAllOverlays();
  });
}

function showDeleteFolderModal(folder) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.setAttribute("tabindex", "-1");
  modal.innerHTML = `
        <div class="folder-modal">
            <h2 style="color:white; margin:0 0 16px; font-size:24px; font-weight:400;">למחוק את התיקייה?</h2>
            <p style="color:#c4c7c5; margin:0 0 24px; font-size:14px;">מחיקת התיקייה לא תמחק את השיחות שבתוכה.</p>
            <div style="display:flex; flex-direction: row-reverse; gap:12px;">
                <button class="confirm-btn-blue" id="confirm-del">מחיקה</button>
                <button class="cancel-btn-plain" id="cancel-del">ביטול</button>
            </div>
        </div>`;
  document.body.appendChild(modal);
  overlays.deleteModal = modal;
  modal.focus();

  const doDelete = () => {
    myFolders = myFolders.filter((f) => f.id !== folder.id);
    saveFolders();
    closeAllOverlays();
  };
  document
    .getElementById("cancel-del")
    ?.addEventListener("click", closeAllOverlays);
  document.getElementById("confirm-del")?.addEventListener("click", doDelete);
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doDelete();
    if (e.key === "Escape") closeAllOverlays();
  });
}

function showRenameChatModal(url, oldTitle) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.innerHTML = `
        <div class="folder-modal">
            <h2 style="color:white; margin:0 0 16px; font-size:24px; font-weight:400;">שינוי שם שיחה:</h2>
            <input type="text" id="rename-chat-input" autocomplete="off" spellcheck="false">
            <div style="display:flex; flex-direction: row-reverse; gap:12px;">
                <button class="confirm-btn-blue" id="confirm-rename">אישור</button>
                <button class="cancel-btn-plain" id="cancel-rename">ביטול</button>
            </div>
        </div>`;
  document.body.appendChild(modal);
  overlays.createModal = modal;

  const input = document.getElementById("rename-chat-input");
  if (input) {
    input.value = oldTitle;
    input.focus();
    input.select();
  }

  const handleConfirm = () => {
    const newTitle = input?.value.trim();
    if (newTitle) {
      myFolders.forEach((f) =>
        f.chats.forEach((c) => {
          if (c.url === url) c.title = newTitle;
        }),
      );
      saveFolders();
    }
    closeAllOverlays();
  };
  document
    .getElementById("confirm-rename")
    ?.addEventListener("click", handleConfirm);
  document
    .getElementById("cancel-rename")
    ?.addEventListener("click", closeAllOverlays);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") closeAllOverlays();
  });
}

function showRemoveChatModal(url, folderId) {
  closeAllOverlays();
  const modal = document.createElement("div");
  modal.className = "folder-modal-overlay";
  modal.setAttribute("tabindex", "-1");
  modal.innerHTML = `
        <div class="folder-modal">
            <h2 style="color:white; margin:0 0 16px; font-size:24px; font-weight:400;">הסרה מהתיקייה?</h2>
            <p style="color:#c4c7c5; margin:0 0 24px; font-size:14px;">השיחה תחזור לרשימת השיחות הרגילה.</p>
            <div style="display:flex; flex-direction: row-reverse; gap:12px;">
                <button class="confirm-btn-blue" id="confirm-remove">הסרה</button>
                <button class="cancel-btn-plain" id="cancel-remove">ביטול</button>
            </div>
        </div>`;
  document.body.appendChild(modal);
  overlays.deleteModal = modal;
  modal.focus();

  const doRemove = () => {
    const f = myFolders.find((f) => f.id === folderId);
    if (f) {
      f.chats = f.chats.filter((c) => c.url !== url);
      saveFolders();
    }
    closeAllOverlays();
  };
  document
    .getElementById("cancel-remove")
    ?.addEventListener("click", closeAllOverlays);
  document
    .getElementById("confirm-remove")
    ?.addEventListener("click", doRemove);
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doRemove();
    if (e.key === "Escape") closeAllOverlays();
  });
}

// FIX 2: Helper that clamps a menu's left position so it never goes off-screen.
function clampMenuLeft(preferredLeft, menuWidth) {
  const minLeft = 8;
  const maxLeft = window.innerWidth - menuWidth - 8;
  return Math.min(Math.max(preferredLeft, minLeft), maxLeft);
}

function openFolderOptions(e, folder) {
  e.stopPropagation();
  e.preventDefault();
  closeAllOverlays();

  const menu = document.createElement("div");
  menu.className = "folder-dropdown";
  menu.style.cssText = `position: fixed; background: #282a2c; border-radius: 12px; padding: 8px 0; z-index: 10001; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'Google Sans', sans-serif;`;

  const pinLabel = folder.isPinned ? "הסר הצמדה" : "הצמד תיקייה";
  const pinIconPath = folder.isPinned
    ? "M19 13H5v-2h14v2z"
    : "M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v7l1 1 1-1v-7h5v-2l-2-2z";

  menu.innerHTML = `
        <div class="folder-dropdown-item" id="opt-pin"><span style="flex-grow:1; text-align:right;">${pinLabel}</span><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="${pinIconPath}"/></svg></div>
        <div class="folder-dropdown-item" id="opt-delete"><span style="flex-grow:1; text-align:right;">מחק תיקייה</span><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></div>
    `;

  document.body.appendChild(menu);
  overlays.chatMenu = menu;

  const rect = e.target.getBoundingClientRect();
  const menuWidth = 170;
  menu.style.top = `${rect.top}px`;
  // FIX 2: Clamp left so the menu never goes off-screen
  menu.style.left = `${clampMenuLeft(rect.left - menuWidth, menuWidth)}px`;

  menu.querySelector("#opt-pin")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    folder.isPinned = !folder.isPinned;
    saveFolders();
    closeAllOverlays();
  });
  menu.querySelector("#opt-delete")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    showDeleteFolderModal(folder);
  });
}

function openFolderSelectionMenu(x, y, url, title) {
  closeAllOverlays();
  const menu = document.createElement("div");
  menu.className = "folder-dropdown";
  menu.style.cssText = `position: fixed; background: #282a2c; border-radius: 12px; padding: 8px 0; z-index: 100000; min-width: 200px; max-height: 300px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'Google Sans', sans-serif;`;

  // Prevent any mousedown/click inside the menu from bubbling to the
  // document listener that would call closeAllOverlays().
  menu.addEventListener("mousedown", (e) => e.stopPropagation());
  menu.addEventListener("click", (e) => e.stopPropagation());

  if (myFolders.length === 0) {
    menu.innerHTML = `<div class="folder-dropdown-item" style="color: #c4c7c5; justify-content: center;">אין תיקיות עדיין</div>`;
  }

  myFolders.forEach((f) => {
    const item = document.createElement("div");
    item.className = "folder-dropdown-item";
    item.innerHTML = `<span style="flex-grow:1; text-align:right; font-family:'Google Sans'; font-size:14px;">${f.name}</span><svg width="18" height="18" style="fill: ${f.color};" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>`;
    item.onclick = (e) => {
      e.stopPropagation();
      if (!f.chats.find((c) => c.url === url)) {
        f.chats.push({ title, url });
        saveFolders();
      }
      closeAllOverlays();
      document.querySelector(".cdk-overlay-backdrop")?.click();
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  overlays.dropdown = menu;

  const menuWidth = 230;
  const menuHeight = menu.offsetHeight;
  let finalTop = y - 10;
  if (finalTop + menuHeight > window.innerHeight)
    finalTop = window.innerHeight - menuHeight - 20;
  menu.style.top = `${finalTop}px`;
  // FIX 2: Clamp left so the menu never goes off-screen
  menu.style.left = `${clampMenuLeft(x - menuWidth, menuWidth)}px`;
}

// --- Helper: find a native Google menu button by aria-label or text content ---
// This replaces brittle SVG-path detection (Bug 3 fix).
function findNativeButton(buttons, keywords) {
  return buttons.find((btn) => {
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    const text = btn.textContent.trim().toLowerCase();
    return keywords.some((kw) => label.includes(kw) || text.includes(kw));
  });
}

function openChatContextMenu(e, url, title, folderId) {
  closeAllOverlays();

  const originalChat = Array.from(
    document.querySelectorAll(CHAT_LINK_SEL),
  ).find((a) => chatPath(a.getAttribute("href")) === url);
  if (!originalChat) return;

  const navItem =
    originalChat.closest(".navigation-item") || originalChat.parentElement;
  if (!navItem) return;

  const googleMenuBtn = navItem.querySelector("button");
  if (!googleMenuBtn) return;

  const rect = e.target.getBoundingClientRect();

  const menu = document.createElement("div");
  menu.className = "folder-dropdown";
  menu.style.cssText = `position: fixed; background: #282a2c; border-radius: 12px; padding: 8px 0; z-index: 2147483647; min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'Google Sans', sans-serif;`;

  const options = [
    {
      label: "שיתוף השיחה",
      icon: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92c0-1.61-1.31-2.92-2.92-2.92z",
      action: "Share",
      keywords: ["share", "שתף", "שיתוף"],
    },
    {
      label: "שינוי השם",
      icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
      action: "Rename",
      keywords: ["rename", "שנה שם", "שינוי שם"],
    },
    {
      label: "מחיקה",
      icon: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
      action: "Delete",
      keywords: ["delete", "מחק", "מחיקה"],
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
    item.innerHTML = `<span style="flex-grow:1; text-align:right; font-size:14px;">${opt.label}</span><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="${opt.icon}"/></svg>`;

    item.onclick = (event) => {
      event.stopPropagation();
      closeAllOverlays();

      if (opt.action === "remove") {
        // Show confirmation modal instead of removing immediately
        closeAllOverlays();
        showRemoveChatModal(url, folderId);
        return;
      }

      const wasHidden = navItem.classList.contains("gemini-hidden-chat");

      if (opt.action === "Rename") {
        // Use our own modal — avoids fragile dependency on Google's native
        // rename button label which may change or differ by locale.
        closeAllOverlays();
        showRenameChatModal(url, title);
        return;
      }

      // Delete / Share
      // Reveal element off-screen (not display:none) so Angular CDK can
      // compute valid (X,Y) coordinates for the action dialog.
      if (wasHidden) {
        navItem.classList.remove("gemini-hidden-chat");
        navItem.classList.add("gemini-temp-reveal");
      }
      document.body.classList.add("gemini-action-in-progress");
      googleMenuBtn.click();

      const restoreNav = () => {
        if (wasHidden) {
          navItem.classList.remove("gemini-temp-reveal");
          navItem.classList.add("gemini-hidden-chat");
        }
        // Keep gemini-action-in-progress a moment longer so the dialog
        // finishes its open animation before we reveal the native menu pane
        setTimeout(
          () => document.body.classList.remove("gemini-action-in-progress"),
          400,
        );
      };

      const safetyTimer = setTimeout(() => {
        menuObs.disconnect();
        restoreNav();
      }, 3000);

      const menuObs = new MutationObserver((_, observer) => {
        const googleBtns = Array.from(
          document.querySelectorAll(
            ".mat-mdc-menu-content button, .mat-menu-item",
          ),
        );
        if (googleBtns.length > 0) {
          observer.disconnect();
          clearTimeout(safetyTimer);
          // Identify button by aria-label / text, not SVG path
          const target = findNativeButton(googleBtns, opt.keywords);
          if (target) {
            target.click();
          } else {
            document.querySelector(".cdk-overlay-backdrop")?.click();
          }
          restoreNav();
        }
      });
      menuObs.observe(document.body, { childList: true, subtree: true });
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  overlays.chatMenu = menu;

  const menuWidth = 190;
  let finalTop = rect.top;
  if (finalTop + 180 > window.innerHeight) finalTop = window.innerHeight - 190;
  menu.style.top = `${finalTop}px`;
  // FIX 2: Clamp left so the menu never goes off-screen
  menu.style.left = `${clampMenuLeft(rect.left - menuWidth, menuWidth)}px`;
}

function renderFolders() {
  const list = document.getElementById("folders-list");
  if (!list) return;

  list.classList.toggle("open", isMainSectionOpen);
  const mainHeader = document.getElementById("main-folders-header");
  if (mainHeader) mainHeader.classList.toggle("is-open", isMainSectionOpen);

  list.innerHTML = "";
  const sortedFolders = [...myFolders].sort(
    (a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0),
  );

  sortedFolders.forEach((folder) => {
    const folderColor = folder.color || "#a8c7fa";
    const isOpen = folder.isOpen === true;
    const isPinned = folder.isPinned === true;
    const folderWrapper = document.createElement("div");
    folderWrapper.className = "folder-group";

    folderWrapper.innerHTML = `
            <div class="custom-folder-item ${isOpen ? "is-open" : ""} ${isPinned ? "is-pinned" : ""}">
                <div class="folder-icon-wrapper" style="position:relative; display:flex;">
                    <svg width="18" height="18" style="fill: ${folderColor};" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
                    <input type="color" class="folder-color-picker" value="${folderColor}" style="position:absolute; opacity:0; inset:0; cursor:pointer;">
                </div>
                <span class="folder-name">${folder.name}</span>
                <div class="pin-icon-svg" style="display: ${folder.isPinned ? "flex" : "none"}; margin-left: 6px; color: #a8c7fa; align-items: center; justify-content: center;"><svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v7l1 1 1-1v-7h5v-2l-2-2z"/></svg></div>
                <div class="folder-arrow-svg"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                <div class="folder-menu-btn" style="padding: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.5;"><svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>
            </div>
            <div class="folder-chats ${isOpen ? "open" : ""}" style="padding-right: 16px;">
                ${folder.chats
                  .map(
                    (chat) => `
                    <div class="folder-chat-item">
                        <div class="chat-title-btn" data-url="${chat.url}" style="flex-grow:1; text-align:right; font-size:13px;">${chat.title}</div>
                        <div class="folder-chat-menu-btn" data-url="${chat.url}" data-title="${chat.title}" data-folder="${folder.id}" style="padding:4px; opacity:0.5;"><svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>
                    </div>`,
                  )
                  .join("")}
            </div>
        `;

    folderWrapper
      .querySelector(".custom-folder-item")
      ?.addEventListener("click", (e) => {
        if (e.target.closest(".folder-menu-btn") || e.target.type === "color")
          return;
        folder.isOpen = !folder.isOpen;
        saveFolders();
      });

    folderWrapper
      .querySelector(".folder-menu-btn")
      ?.addEventListener("click", (e) => {
        openFolderOptions(e, folder);
      });
    folderWrapper
      .querySelector(".folder-color-picker")
      ?.addEventListener("change", (e) => {
        folder.color = e.target.value;
        saveFolders();
      });

    // FIX 5: Prefer exact path-based matching over partial href*= to avoid
    // accidentally activating the wrong chat when URLs share a common prefix.
    folderWrapper.querySelectorAll(".chat-title-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetPath = btn.dataset.url;
        const all = Array.from(document.querySelectorAll(CHAT_LINK_SEL));
        const match = all.find(
          (a) =>
            !a.closest("#gemini-custom-folders") &&
            chatPath(a.getAttribute("href")) === targetPath,
        );
        if (match) {
          match.click();
        } else {
          // Fallback: partial href match (handles edge cases where chatPath
          // normalisation differs between stored value and live DOM attribute)
          const fallback = document.querySelector(
            `${CHAT_LINK_SEL}[href*="${targetPath}"]`,
          );
          fallback?.click();
        }
      });
    });

    folderWrapper.querySelectorAll(".folder-chat-menu-btn").forEach((mBtn) => {
      mBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openChatContextMenu(
          e,
          mBtn.dataset.url,
          mBtn.dataset.title,
          mBtn.dataset.folder,
        );
      });
    });

    list.appendChild(folderWrapper);
  });
  hideMovedChats();
}

function injectFoldersUI() {
  if (document.getElementById("gemini-custom-folders")) return;
  const gemsList =
    document.querySelector(".gems-list-container") ||
    document.querySelector("conversation-list");
  if (gemsList) {
    const div = document.createElement("div");
    div.id = "gemini-custom-folders";
    div.innerHTML = `
            <div id="main-folders-header" class="${isMainSectionOpen ? "is-open" : ""}">
                <h3 id="main-folders-title">התיקיות שלי</h3>
                <button id="add-folder-btn">+ הוספת תיקייה</button>
                <div id="main-folders-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
            </div>
            <div id="folders-list" class="${isMainSectionOpen ? "open" : ""}"></div>
        `;
    if (gemsList.className.includes("gems-list-container")) {
      gemsList.insertAdjacentElement("afterend", div);
    } else {
      gemsList.insertAdjacentElement("afterbegin", div);
    }

    document
      .getElementById("main-folders-header")
      ?.addEventListener("click", (e) => {
        if (e.target.closest("#add-folder-btn")) return;
        isMainSectionOpen = !isMainSectionOpen;
        renderFolders();
      });

    document
      .getElementById("add-folder-btn")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        showCreateFolderModal();
      });
    renderFolders();
  }
}

// FIX 4: Renamed parameter from misleading "delBtn" to "anchorItem"
// (it is not a delete button — it is simply the first menu item used as
//  an insertion anchor for our custom "Add/Remove from folder" option).
function addFolderOptionToMenu(container, anchorItem) {
  const isFromFolder = !!(lastContextChat && lastContextChat.fromFolder);
  if (!anchorItem) return;

  const newItem = anchorItem.cloneNode(true);
  newItem.classList.add("custom-folder-option");
  newItem.removeAttribute("onclick");

  const icon = isFromFolder
    ? "M19 13H5v-2h14v2z"
    : "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z";
  newItem.innerHTML = `<div class="mat-mdc-menu-item-icon" style="display:flex; align-items:center;"><svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24" style="margin-left: 10px;"><path d="${icon}"/></svg></div><span class="mat-mdc-menu-item-text" style="flex-grow:1; text-align:right; font-family:'Google Sans' !important; font-size:14px !important;">${isFromFolder ? "הסר מהתיקייה" : "הוסף לתיקייה"}</span>`;

  // Strategy 1: mousedown handler already set lastContextChat — use it.
  let frozenUrl = lastContextChat?.url || "";
  let frozenTitle = lastContextChat?.title || "";
  const frozenFolder = lastContextChat?.fromFolder || null;

  // Strategy 2: The button that opened the CDK menu has aria-expanded="true".
  // Walk UP the DOM from the trigger until we find an ancestor that contains
  // a chat link — resilient to any Gemini DOM structure.
  if (!frozenUrl) {
    const trigger = document.querySelector('[aria-expanded="true"]');
    if (trigger) {
      let el = trigger.parentElement;
      while (el && el !== document.body) {
        const link = el.querySelector(CHAT_LINK_SEL);
        if (link && !link.closest("#gemini-custom-folders")) {
          frozenUrl = chatPath(link.getAttribute("href"));
          frozenTitle = link.textContent.trim();
          break;
        }
        el = el.parentElement;
      }
    }
  }

  // Strategy 3: Hover fallback (covers edge cases where focus moved quickly).
  if (!frozenUrl) {
    const hoveredLink = Array.from(
      document.querySelectorAll(CHAT_LINK_SEL),
    ).find((a) => !a.closest("#gemini-custom-folders") && a.matches(":hover"));
    if (hoveredLink) {
      frozenUrl = chatPath(hoveredLink.getAttribute("href"));
      frozenTitle = hoveredLink.textContent.trim();
    }
  }

  newItem.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent CDK and mousedown handler from interfering
    const x = e.clientX;
    const y = e.clientY;

    if (isFromFolder) {
      const f = myFolders.find((folder) => folder.id === frozenFolder);
      if (f) {
        f.chats = f.chats.filter((c) => c.url !== frozenUrl);
        saveFolders();
      }
      return;
    }

    if (!frozenUrl) return;
    openFolderSelectionMenu(x, y, frozenUrl, frozenTitle);
  });

  anchorItem.insertAdjacentElement("afterend", newItem);
}

// Single mousedown handler: closes overlays AND tracks last-context chat.
// Using mousedown (not click) means CDK's synthetic 'click' events that fire
// during menu-close animations cannot accidentally close our overlays.
document.addEventListener(
  "mousedown",
  (e) => {
    const insideProtectedUI = !!e.target.closest(
      ".cdk-overlay-pane, .folder-dropdown, .folder-modal-overlay, .custom-folder-option",
    );

    if (!insideProtectedUI) {
      // Real user click outside our UI — close any open overlays
      closeAllOverlays();
    } else {
      // Inside CDK or our dropdowns/modals — do not set lastContextChat
      return;
    }

    // Track which native chat was clicked for the "Add/Remove from folder" button
    const chatLink = e.target.closest(CHAT_LINK_SEL);
    const container = chatLink
      ? chatLink.closest(".navigation-item") || chatLink.parentElement
      : e.target.closest(".navigation-item") || e.target.closest("li");

    if (container && !container.closest("#gemini-custom-folders")) {
      const link =
        container.querySelector(CHAT_LINK_SEL) ||
        (container.tagName.toLowerCase() === "a" &&
        container.href?.includes("/app/")
          ? container
          : null);
      if (link) {
        const urlAttr = link.getAttribute("href");
        if (urlAttr) {
          let belongsTo = null;
          myFolders.forEach((folder) => {
            if (
              folder.chats.some((c) => chatPath(c.url) === chatPath(urlAttr))
            ) {
              belongsTo = folder.id;
            }
          });
          lastContextChat = {
            url: chatPath(urlAttr),
            title: link.textContent.trim(),
            fromFolder: belongsTo,
          };
        }
      }
    }
  },
  true,
);

// Click handler: only kept for certain button-class guards that need
// the bubble phase. Overlay closing is handled by mousedown above.
document.addEventListener("click", (e) => {
  // Folder-menu-btn clicks bubble up here — just let them through.
  // The mousedown already skipped closing because the btn is inside
  // #gemini-custom-folders, and the click handler on the btn itself
  // calls openFolderOptions / openChatContextMenu.
});

// Capture the chat URL on hover — fires when mouse enters a chat link,
// long before the user clicks the 3-dot button (which only appears on hover).
// This is the most reliable way to set lastContextChat.
document.addEventListener(
  "mouseover",
  (e) => {
    const link = e.target.closest(CHAT_LINK_SEL);
    if (!link || link.closest("#gemini-custom-folders")) return;
    const href = link.getAttribute("href");
    if (!href) return;
    const url = chatPath(href);
    if (!url || url === lastContextChat?.url) return;
    let belongsTo = null;
    myFolders.forEach((f) => {
      if (f.chats.some((c) => chatPath(c.url) === url)) belongsTo = f.id;
    });
    lastContextChat = {
      url,
      title: link.textContent.trim(),
      fromFolder: belongsTo,
    };
  },
  true,
);

let domUpdateTimer = null;
const observerCallback = (mutations) => {
  // Menu detection logic for adding our folder option
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        const content = node.matches(".mat-mdc-menu-content")
          ? node
          : node.querySelector(".mat-mdc-menu-content");
        if (content) {
          if (!content.querySelector(".custom-folder-option")) {
            // Unconditionally find the first interactive item (button or link)
            // in the native menu and use it as the anchor for our custom option.
            const anchorItem = content.querySelector(
              "button, a, .mat-mdc-menu-item",
            );
            if (anchorItem) {
              addFolderOptionToMenu(content, anchorItem);
            }
          }
        }
      }
    });
  }

  // Debounced UI Inject and Chat Hiding
  if (domUpdateTimer) clearTimeout(domUpdateTimer);
  domUpdateTimer = setTimeout(() => {
    injectFoldersUI();
    hideMovedChats();
  }, 100);
};

const menuObserver = new MutationObserver(observerCallback);
menuObserver.observe(document.body, { childList: true, subtree: true });

// Initial run
injectFoldersUI();
hideMovedChats();
