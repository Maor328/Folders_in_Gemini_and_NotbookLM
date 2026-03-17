# GitHub Copilot Instructions

## Project Overview

This is a **Manifest V3 browser extension** that adds a custom folder system to [Gemini](https://gemini.google.com) and [NotebookLM](https://notebooklm.google.com), allowing users to organize their chats and notebooks into folders.

## Repository Structure

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) — declares permissions, content scripts, and icons |
| `content.js` | Content script injected into `gemini.google.com` |
| `NotebookLM-content.js` | Content script injected into `notebooklm.google.com` |
| `styles.css` | Shared CSS for both content scripts |
| `icon.png` | Extension icon (16 × 16, 48 × 48, 128 × 128) |

## Tech Stack & Conventions

- **Plain JavaScript (ES2020+)** — no bundler, no TypeScript, no npm packages.
- **CSS** — vanilla CSS; no preprocessors.
- **Chrome Extensions Manifest V3** — use `chrome.storage.local` (already declared in `manifest.json`) for all persistence; avoid `localStorage`.
- **No build step** — files are loaded directly by Chrome; changes are reflected immediately after reloading the extension in `chrome://extensions`.
- **UI language** — the UI text is Hebrew (RTL). Keep new user-visible strings in Hebrew and preserve `direction: rtl` where applicable.
- **Dark-theme palette** — match the existing Google dark-surface colours (`#282a2c`, `#1e2022`, `#e3e3e3`, `#a8c7fa`, etc.) for any new UI elements.

## Coding Conventions

- Use `const` / `let`; never `var`.
- Prefer `async/await` over raw Promise chains.
- DOM queries: use `document.querySelector` / `querySelectorAll`; cache results in `const` where reused.
- CSS class names follow the pattern `folder-*` (Gemini) or `nblm-*` (NotebookLM). Follow the same namespace when adding new classes.
- Keep Gemini-specific code in `content.js` and NotebookLM-specific code in `NotebookLM-content.js`; shared visual styles go in `styles.css`.
- Do **not** use `eval`, `innerHTML` with unsanitised strings, or external network requests.

## Key APIs in Use

- `chrome.storage.local` — persisting folder data.
- `MutationObserver` — detecting dynamic DOM changes in the single-page apps.
- `chrome.runtime.onMessage` / `sendMessage` — if inter-script messaging is needed.

## Testing & Debugging

There is no automated test suite. To test changes:
1. Go to `chrome://extensions`, enable **Developer mode**, and load the repo as an unpacked extension.
2. Open [gemini.google.com](https://gemini.google.com) or [notebooklm.google.com](https://notebooklm.google.com).
3. Open DevTools → **Console** to inspect logs and errors.
4. After any code change, click **Reload** on the extension card and refresh the target tab.

## What to Avoid

- Do **not** add external dependencies or a build system unless explicitly requested.
- Do **not** use `manifest_version: 2` APIs (e.g., `background.persistent`, `browser_action`).
- Do **not** break RTL layout or change Hebrew strings without explicit instruction.
- Do **not** introduce `!important` overrides beyond what already exists unless targeting host-page styles that cannot be overridden otherwise.
