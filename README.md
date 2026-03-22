# Gemini & NotebookLM Folders Extension

A lightweight, productivity-focused browser extension designed to provide hierarchical organization for Google Gemini conversational histories and Google NotebookLM projects. This extension integrates a custom, color-coded folder system directly into the native Google Material Design interface.

## Features

### Seamless Native Integration

The extension UI is designed to blend perfectly with Google's native interfaces. ItSafely interacts with Angular Material (CDK) DOM elements to maintain UI stability during Google updates.

### Dynamic Folder Management

- **Custom Folders:** Create an unlimited number of folders to categorize chats and projects.
- **Hierarchical Order:** The sidebar is automatically re-rendered to prioritize pinned folders at the top.

### Visual Organization

- **Color Coding:** Assign custom colors to individual folders for instant visual identification.
- **Pinning:** Fast-track access to critical work streams by pinning essential folders.

### Safe Implementation

All data is persisted locally using the `chrome.storage.local` API. The extension operates completely client-side, with no external server dependencies, data tracking, or data collection.

## Technical Details

- **Platform:** Chrome Extension Manifest V3
- **Technologies:** JavaScript (ES6+), CSS3
- **Permissions:** `storage` (for local data persistence)
- **Architecture:** Dual content scripts optimized for Gemini and NotebookLM DOM structures.

## Installation (Developer Mode)

Currently, the extension is available for manual installation only.

1.  Download or clone this repository to your local machine.
2.  Navigate to `chrome://extensions` in your Google Chrome browser.
3.  Enable **"Developer mode"** via the toggle switch in the upper right corner.
4.  Click the **"Load unpacked"** button.
5.  Select the directory containing the extension files.
6.  The extension is now active. Refresh your Gemini or NotebookLM pages to initialize the interface.

## Usage Guide

1.  **Creating Folders:** Utilize the "+ Add Folder" button located in the newly injected sidebar panel.
2.  **Adding Items:** Access the native context menu (⋮) on any Gemini chat or NotebookLM project and select the "Add to folder" option.
3.  **Managing Folders:** Hover over a folder and utilize its context menu (⋮) to pin, rename, or delete the folder. Click the folder icon to activate the custom color picker.
4.  **Managing Folder Items:** Items inside a folder contain their own context menu (⋮), allowing for native actions (Share, Rename, Delete) or the "Remove from folder" action.

## Contributing

Contributions are welcome. Please submit feature requests or bug reports via the GitHub issues page.

## License

This project is licensed under the [MIT License](LICENSE).
