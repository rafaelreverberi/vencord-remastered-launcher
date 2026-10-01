// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const api = window.remastered;
const $ = id => document.getElementById(id);
let snapshot, running = false, selected = '', page = 'overview', lastAction = 'apply';
const short = hash => hash ? hash.slice(0, 10) : '—';
function text(id, value) { $(id).textContent = value; }
function navigate(name) {
    if (!['overview', 'plugins', 'settings'].includes(name)) return;
    page = name;
    for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== name;
    for (const button of document.querySelectorAll('nav button')) button.classList.toggle('selected', button.dataset.page === name);
    text('breadcrumb', `INSTALLATION / ${name === 'plugins' ? 'THIRD PARTY PLUGINS' : name.toUpperCase()}`);
}
function button(label, action) { const b = document.createElement('button'); b.textContent = label; b.disabled = running; b.addEventListener('click', action); return b; }
async function refresh() {
    snapshot = await api.invoke('snapshot');
    render();
}
function render() {
    const { state, plugins, targets } = snapshot;
    const options = $('target');
    const old = selected || options.value;
    options.replaceChildren();
    for (const t of targets) { const o = document.createElement('option'); o.value = t.id; o.textContent = `${t.branch} · ${t.base}`; options.append(o); }
    if (!targets.length) { const o = document.createElement('option'); o.textContent = 'No Discord installation detected'; o.value = ''; options.append(o); }
    if (targets.some(t => t.id === old)) options.value = old;
    selected = options.value;
    const target = targets.find(t => t.id === selected);
    text('install-status', target ? state.targets?.[target.id] && target.patched ? 'Vencord Remastered installed' : 'Discord detected' : 'Discord not detected');
    text('install-detail', target ? state.active?.safe ? 'Safe Mode · third-party plugins excluded' : 'Ready to patch, update or repair' : 'Install Discord, then check again.');
    text('installed', short(state.active?.commit)); text('latest', short(state.latest)); text('upstream', short(state.active?.upstream));
    text('plugin-summary', `${plugins.length} installed · ${plugins.filter(p => p.enabled).length} enabled`);
    text('count', plugins.length); text('build-date', state.active?.date ? new Date(state.active.date).toLocaleString() : '—');
    text('launcher-version', `Launcher ${snapshot.launcher}`); text('data-path', snapshot.root); text('settings-path', snapshot.settingsDir);
    text('launcher-update-status', `${snapshot.launcherUpdate?.status || 'Not checked'}${snapshot.launcherUpdate?.version ? ` · ${snapshot.launcherUpdate.version}` : ''}${snapshot.launcherUpdate?.error ? ` · ${snapshot.launcherUpdate.error}` : ''}`);
    text('pending', snapshot.pending ? 'Plugin changes need a build' : state.active?.safe ? 'Safe Mode active · Apply Changes restores plugins' : 'No pending changes');
    text('apply', state.targets?.[selected] ? 'Apply Changes' : 'Patch / Install');
    $('empty').hidden = plugins.length > 0;
    const list = $('plugin-list'); list.replaceChildren();
    for (const p of plugins) {
        const row = document.createElement('article'); row.className = 'plugin-row';
        const top = document.createElement('div'); top.className = 'plugin-top';
        const title = document.createElement('h2'); title.textContent = p.name;
        const status = document.createElement('span'); status.className = 'plugin-state'; status.textContent = p.included ? p.enabled ? 'Enabled' : 'Disabled' : 'Excluded from build';
        top.append(title, status); row.append(top);
        const description = document.createElement('p'); description.textContent = p.description; row.append(description);
        const meta = document.createElement('p'); meta.className = 'plugin-meta';
        meta.textContent = `${p.author} · ${p.url || 'Local copy'}\nRevision ${short(p.revision === 'local' ? p.content : p.revision)}${p.latestRevision && p.latestRevision !== p.revision ? ' · Update available' : p.url ? ' · Up to date at last check' : ''}${p.updateError ? ` · Check failed: ${p.updateError}` : ''}`; row.append(meta);
        const actions = document.createElement('div'); actions.className = 'plugin-actions';
        actions.append(button(p.enabled ? 'Disable' : 'Enable', () => run('enabled', { id: p.id, enabled: !p.enabled })),
            button(p.included ? 'Exclude from Build' : 'Include in Build', () => run(p.included ? 'exclude' : 'include', { id: p.id })),
            button('Open Source', () => run('openSource', { id: p.id })),
            button('Remove', () => { if (confirm(`Remove ${p.name} from your next build? Its Vencord settings will be preserved.`)) run('remove', { id: p.id }); }));
        if (p.url) actions.append(button('Update', () => run('pluginUpdate', { id: p.id })));
        row.append(actions); list.append(row);
    }
    for (const id of ['apply', 'update', 'repair', 'safe', 'apply-plugins']) $(id).disabled = running || !target;
    for (const b of document.querySelectorAll('button')) if (!['toggle-log', 'close-dialog'].includes(b.id) && !b.dataset.page && !['apply', 'update', 'repair', 'safe', 'apply-plugins'].includes(b.id)) b.disabled = running;
    $('launcher-download').disabled = running || snapshot.launcherUpdate?.status !== 'Update available';
    $('launcher-install').disabled = running || snapshot.launcherUpdate?.status !== 'Ready to install';
}
async function run(action, payload = {}) {
    if (running) return;
    running = true; lastAction = action;
    $('error').hidden = true; $('progress').hidden = false;
    const labels = { apply: 'Preparing build and patch…', update: 'Updating Remastered…', repair: 'Repairing installation…', safe: 'Building Safe Mode…', addGit: 'Importing and building plugin…', addLocal: 'Importing local plugin…', pluginUpdateAll: 'Updating plugins…', check: 'Checking for updates…' };
    text('operation-label', labels[action] || 'Applying changes…');
    if (snapshot) render();
    try {
        await api.invoke(action, { targetId: selected || undefined, ...payload });
        text('operation-label', ['apply', 'update', 'repair', 'safe', 'addGit', 'addLocal', 'pluginUpdate', 'pluginUpdateAll'].includes(action) && selected ? 'Complete · Start Discord to load this build' : 'Complete');
    } catch (e) {
        text('operation-label', 'Operation failed · installed build preserved');
        text('error', e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
        $('error').hidden = false; $('log').hidden = false;
        const retryAction = ['addGit', 'addLocal', 'pluginUpdate', 'pluginUpdateAll'].includes(action) ? 'apply' : action;
        const retry = button('Retry Build', () => run(retryAction, payload)); $('error').append(document.createElement('br'), retry);
        if (['apply', 'update', 'repair', 'addGit', 'addLocal', 'pluginUpdate', 'pluginUpdateAll'].includes(action)) {
            $('error').append(button('Manage Plugins', () => navigate('plugins')), button('Build in Safe Mode', () => run('safe')));
        }
    } finally { running = false; $('progress').hidden = true; await refresh().catch(() => {}); }
}
for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => navigate(b.dataset.page));
$('target').addEventListener('change', () => { selected = $('target').value; render(); });
for (const [id, action] of Object.entries({ apply: 'apply', update: 'update', repair: 'repair', safe: 'safe', check: 'check', 'apply-plugins': 'apply', 'update-all': 'pluginUpdateAll', 'open-data': 'openData', recreate: 'recreate', 'settings-folder': 'settingsFolder', 'launcher-check': 'launcherCheck', 'launcher-download': 'launcherDownload', 'launcher-install': 'launcherInstall' })) $(id).addEventListener('click', () => run(action));
for (const id of ['add', 'empty-add']) $(id).addEventListener('click', () => $('add-dialog').showModal());
$('close-dialog').addEventListener('click', () => $('add-dialog').close());
$('add-local').addEventListener('click', () => { $('add-dialog').close(); run('addLocal'); });
$('add-form').addEventListener('submit', event => {
    event.preventDefault(); const url = $('repo-url').value.trim();
    if (!url) { $('repo-url').reportValidity(); return; }
    $('add-dialog').close(); run('addGit', { url, branch: $('repo-branch').value.trim() });
});
$('toggle-log').addEventListener('click', () => { $('log').hidden = !$('log').hidden; text('toggle-log', $('log').hidden ? 'View Log' : 'Hide Log'); });
api.progress(value => { $('log').textContent = ($('log').textContent + value).slice(-100000); $('log').scrollTop = $('log').scrollHeight; });
api.route(route => { if (route === 'update') navigate('overview'); if (!running) refresh().catch(() => {}); });
refresh().catch(e => { text('error', e.message); $('error').hidden = false; });
