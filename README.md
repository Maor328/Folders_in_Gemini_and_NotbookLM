## 📁 Gemini & NotebookLM Folders

Gemini & NotebookLM Folders is a lightweight, productivity-focused browser extension designed to provide hierarchical organization for Google Gemini conversational histories and Google NotebookLM projects. This extension integrates a custom, color-coded folder system directly into the native Google Material Design interface.

# ✨ Features

Seamless Native Integration: The UI is designed to blend perfectly with Google's native interfaces, interacting safely with Angular Material (CDK) DOM elements to maintain stability during site updates.

Dynamic Folder Management: Create an unlimited number of folders to categorize your chats and projects.

Hierarchical Order: The sidebar automatically re-renders to prioritize pinned folders at the top for quick access.

Visual Organization: Assign custom colors to individual folders for instant visual identification and use pinning to fast-track critical work streams.

Safe & Private: All data is persisted locally using the chrome.storage.local API. The extension operates completely client-side with no external server dependencies, data tracking, or data collection.

# 🛠 Technical Details

Platform: Chrome Extension Manifest V3.

Technologies: Plain JavaScript (ES6+), CSS3.

Permissions: storage (for local data persistence).

Architecture: Dual content scripts optimized specifically for Gemini and NotebookLM DOM structures.

# 🚀 Installation (Developer Mode)

Currently, the extension is available for manual installation only. Follow these steps to get started:

Download the Code: Download or clone this repository to your local machine.

Open Extensions Page: Navigate to chrome://extensions in your Google Chrome browser.

Enable Developer Mode: Toggle the "Developer mode" switch in the upper right corner.

Load the Extension: Click the "Load unpacked" button.

Select Directory: Select the directory containing the extension files (where manifest.json is located).

Refresh & Use: The extension is now active! Refresh your Gemini or NotebookLM pages to initialize the interface.

# 📖 Usage Guide

Creating Folders: Use the "+ Add Folder" button located in the newly injected sidebar panel.

Adding Items: Access the native context menu (⋮) on any Gemini chat or NotebookLM project and select the "Add to folder" option.

Managing Folders: Hover over a folder and use its context menu (⋮) to pin, rename, or delete it. Click the folder icon to open the custom color picker.

Managing Folder Items: Items inside a folder have their own context menu (⋮), allowing for native actions (Share, Rename, Delete) or the "Remove from folder" action.

# 🤝 Contributing

Contributions are welcome! Please submit feature requests or bug reports via the GitHub issues page.

# ⚖ License

This project is licensed under the MIT License.
