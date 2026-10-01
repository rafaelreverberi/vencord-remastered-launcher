// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, dialog, ipcMain, shell, session, protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { Manager, parseLink } = require('./core/manager.cjs');
const { json, writeJson } = require('./core/files.cjs');
const { autoUpdater } = require('electron-updater');
const { latestRelease } = require('./core/launcher-release.cjs');
app.setName('Vencord Remastered');
protocol.registerSchemesAsPrivileged([{ scheme: 'remastered-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let quitAfterOperation = false;
let win, manager, routeUpdate = process.argv.some(parseLink), updateState = { status: 'Not checked' };
const UI_ORIGIN = 'remastered-app://launcher';
const root = app.getPath('userData');
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', (_event, argv) => { if (argv.some(parseLink)) openUpdate(); win?.show(); win?.focus(); });
    app.on('open-url', (event, value) => { event.preventDefault(); if (parseLink(value)) openUpdate(); });
    app.on('window-all-closed', () => app.quit());
    app.whenReady().then(start).catch(e => { dialog.showErrorBox('Launcher could not start', e.message); app.quit(); });
}
function openUpdate() { routeUpdate = true; if (win && !win.webContents.isLoading()) win.webContents.send('remastered:route', 'update'); }
function log(value) { if (win && !win.isDestroyed()) win.webContents.send('remastered:progress', String(value)); }
async function warning() {
    const result = await dialog.showMessageBox(win, { type: 'warning', title: 'Trust this plugin?',
        message: 'Third-party plugins are not reviewed by Vencord Remastered. Only install plugins from sources you trust.',
        detail: 'Plugins can execute code inside Discord, including native Node.js code. The plugin will be disabled initially. Import scripts are never run.',
        buttons: ['Cancel', 'Install plugin'], defaultId: 0, cancelId: 0 });
    return result.response === 1;
}
async function start() {
    app.setAsDefaultProtocolClient('vencord-remastered');
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle('remastered-app', request => {
        const u = new URL(request.url);
        const name = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
        if (u.hostname !== 'launcher' || !['index.html', 'app.js', 'style.css'].includes(name)) return new Response(null, { status: 404 });
        return net.fetch(pathToFileURL(path.join(__dirname, 'ui', name)).href);
    });
    manager = new Manager(root, { log, appData: app.getPath('appData') });
    await manager.initialize();
    win = new BrowserWindow({ width: 1080, height: 760, minWidth: 840, minHeight: 620, title: 'Vencord Remastered Launcher',
        backgroundColor: '#14161b', autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== `${UI_ORIGIN}/`) event.preventDefault(); });
    win.on('close', event => { if (manager.busy) { event.preventDefault(); quitAfterOperation = true; log('The launcher will close when the current operation completes.\n'); } });
    ipcMain.handle('remastered:action', async (event, action, payload = {}) => {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith(`${UI_ORIGIN}/`)) throw new Error('Untrusted IPC sender');
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid request');
        try {
            if (action === 'snapshot') return { ...await manager.snapshot(), launcher: app.getVersion(), launcherUpdate: updateState };
            if (action === 'appManagement') { if (process.platform !== 'darwin') throw new Error('App Management settings are macOS only'); return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'); }
            if (action === 'launcherRelease') return shell.openExternal('https://github.com/rafaelreverberi/vencord-remastered-launcher/releases/latest');
            if (action === 'openData') return shell.openPath(root);
            if (action === 'openSource') {
                const p = (await manager.plugins.list()).find(p => p.id === payload.id);
                if (!p) throw new Error('Plugin not found');
                return p.url ? shell.openExternal(p.url) : shell.openPath(path.join(root, p.storage));
            }
            if (action === 'launcherCheck') { if (!app.isPackaged) throw new Error('Launcher self-update is available in packaged releases'); await checkLauncherUpdate(); return updateState; }
            if (action === 'launcherDownload') { if (!app.isPackaged) throw new Error('Use a packaged release'); await autoUpdater.downloadUpdate(); return updateState; }
            if (action === 'launcherInstall') { if (manager.busy || updateState.status !== 'Ready to install') throw new Error('Update is not ready'); autoUpdater.quitAndInstall(); return; }
            return await manager.exclusive(async () => {
                const targetId = typeof payload.targetId === 'string' ? payload.targetId : undefined;
                switch (action) {
                    case 'check': return manager.checkUpdates();
                    case 'apply': return manager.apply(targetId, { update: false });
                    case 'repair': return manager.apply(targetId, { repair: true });
                    case 'update': return manager.apply(targetId, { update: true });
                    case 'safe': return manager.apply(targetId, { safe: true });
                    case 'enabled': await manager.setEnabled(payload.id, payload.enabled); break;
                    case 'include': case 'exclude': case 'remove': await manager.plugins.change(payload.id, action); break;
                    case 'pluginUpdate':
                        if (typeof payload.id !== 'string') throw new Error('Select a plugin');
                        await manager.plugins.update([payload.id]);
                        if (targetId) return manager.apply(targetId);
                        break;
                    case 'pluginUpdateAll':
                        await manager.plugins.update((await manager.plugins.list()).filter(p => p.url).map(p => p.id));
                        if (targetId) return manager.apply(targetId);
                        break;
                    case 'addGit':
                        if (!await warning()) return manager.snapshot();
                        await manager.plugins.addGit(payload.url, payload.branch || undefined);
                        if (targetId) return manager.apply(targetId);
                        break;
                    case 'addLocal': {
                        const selection = await dialog.showOpenDialog(win, { title: 'Choose Local Folder', properties: ['openDirectory'] });
                        if (selection.canceled || !await warning()) return manager.snapshot();
                        await manager.plugins.addLocal(selection.filePaths[0]);
                        if (targetId) return manager.apply(targetId);
                        break;
                    }
                    case 'recreate': await manager.recreate(); break;
                    case 'settingsFolder': {
                        const selection = await dialog.showOpenDialog(win, { title: 'Choose Vencord settings data folder', properties: ['openDirectory', 'createDirectory'] });
                        if (!selection.canceled) await manager.configureSettings(selection.filePaths[0]);
                        break;
                    }
                    default: throw new Error('Unknown launcher action');
                }
                return manager.snapshot();
            });
        } catch (e) {
            if (process.platform === 'darwin' && /EPERM|operation not permitted/.test(e.message)) e = new Error('macOS blocked access to the Discord application bundle. Allow Vencord Remastered Launcher in System Settings → Privacy & Security → App Management, then retry. Your installed build is unchanged.');
            log(`${e.message}\n`);
            const state = await manager.state(); state.lastError = { message: e.message, date: new Date().toISOString() };
            await writeJson(manager.statePath, state);
            throw new Error(e.message);
        } finally { if (quitAfterOperation && !manager.busy) app.quit(); }
    });
    autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('error', () => { const message = 'Launcher update failed. Use Open Latest Release or try again later.'; updateState = { status: 'Check failed', error: message }; log(`${message}\n`); });
    autoUpdater.on('update-available', info => { updateState = { status: 'Update available', version: info.version }; log(`Launcher ${info.version} available\n`); win.webContents.send('remastered:route', 'refresh'); });
    autoUpdater.on('update-not-available', () => { updateState = { status: 'Up to date' }; win.webContents.send('remastered:route', 'refresh'); });
    autoUpdater.on('download-progress', info => { log(`Launcher update download ${Math.round(info.percent)}%\n`); });
    autoUpdater.on('update-downloaded', () => { updateState.status = 'Ready to install'; log('Launcher update ready to install\n'); win.webContents.send('remastered:route', 'refresh'); });
    const openingCheck = manager.exclusive(() => manager.checkUpdates());
    // Attach rejection handling immediately, before renderer load.
    const checked = openingCheck.catch(e => log(`Update check unavailable: ${e.message}\n`));
    await win.loadURL(`${UI_ORIGIN}/`);
    if (routeUpdate) openUpdate();
    // One check on open; no timers, tray, login item or background agent.
    checked.then(() => { if (!win.isDestroyed()) win.webContents.send('remastered:route', 'refresh'); }).finally(() => { if (quitAfterOperation) app.quit(); });
    if (app.isPackaged) checkLauncherUpdate().catch(() => {});
}

async function checkLauncherUpdate() {
    try {
        const release = await latestRelease(net.fetch);
        autoUpdater.setFeedURL({ provider: 'generic', url: release.url });
        return await autoUpdater.checkForUpdates();
    } catch (e) {
        const message = 'Launcher update check failed. Use Open Latest Release or try again later.';
        updateState = { status: 'Check failed', error: message };
        log(`${message}\n`);
        if (win && !win.isDestroyed()) win.webContents.send('remastered:route', 'refresh');
        throw new Error(message);
    }
}
