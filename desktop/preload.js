// Preload script - exposes a limited API from main to renderer
const { contextBridge, ipcRenderer } = require('electron');

// For overlay.html and settings.html we use nodeIntegration: true
// so preload is minimal - just ensure ipcRenderer is available
window.ipcRenderer = ipcRenderer;
