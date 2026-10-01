// SPDX-License-Identifier: GPL-3.0-or-later
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('remastered', Object.freeze({
    invoke: (action, payload) => ipcRenderer.invoke('remastered:action', action, payload),
    progress: callback => {
        const listener = (_event, text) => callback(text);
        ipcRenderer.on('remastered:progress', listener);
        return () => ipcRenderer.removeListener('remastered:progress', listener);
    },
    route: callback => ipcRenderer.on('remastered:route', (_event, route) => callback(route))
}));
