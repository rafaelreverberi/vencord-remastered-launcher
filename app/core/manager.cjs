// SPDX-License-Identifier: GPL-3.0-or-later
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { fs, path, exists, json, atomic, writeJson, tree, digest, copyTree, inside } = require('./files.cjs');
const { Git } = require('./git.cjs');
const { Plugins, inspect } = require('./plugins.cjs');
const { Toolchain } = require('./toolchain.cjs');
const { detect, assertClosed, Patcher } = require('./discord.cjs');
const ORIGIN = 'https://github.com/rafaelreverberi/vencord-remastered.git';
const UPSTREAM = 'https://github.com/Vendicated/Vencord.git';
const REQUIRED = ['patcher.js', 'preload.js', 'renderer.js', 'renderer.css'];
function settingsLocation(appData) {
    return process.env.VENCORD_USER_DATA_DIR || (process.env.DISCORD_USER_DATA_DIR ? path.join(process.env.DISCORD_USER_DATA_DIR, '..', 'VencordData') : path.join(appData, 'Vencord'));
}
function parseLink(value) {
    try { const u = new URL(value); return u.protocol === 'vencord-remastered:' && u.hostname === 'update' && !u.username && !u.password && !u.port && !u.search && !u.hash && (u.pathname === '' || u.pathname === '/'); } catch { return false; }
}
class Manager {
    constructor(root, options = {}) {
        this.root = root; this.source = path.join(root, 'source'); this.log = options.log || (() => {});
        this.git = new Git(path.join(root, 'cache'), this.log);
        this.plugins = new Plugins(root, this.git); this.tool = new Toolchain(root, this.log, options.node);
        this.patcher = new Patcher(root, this.log);
        this.settingsDir = options.settingsDir || settingsLocation(options.appData || path.dirname(root));
        this.detect = options.detect || detect; this.assertClosed = options.assertClosed || assertClosed;
        this.busy = false; this.statePath = path.join(root, 'state.json');
    }
    async initialize() { await fs.mkdir(this.root, { recursive: true }); await this.assertRecovery(); }
    async assertRecovery() { if (await exists(this.patcher.journal)) { await this.assertClosed(); await this.patcher.recover(); } }
    async state() {
        const state = await json(this.statePath, { targets: {}, settingsDir: this.settingsDir });
        if (state.settingsDir) this.settingsDir = state.settingsDir;
        return state;
    }
    async exclusive(task) {
        if (this.busy) throw new Error('Another operation is in progress');
        this.busy = true;
        try { return await task(); } finally { this.busy = false; }
    }
    async sourceReady(update = false) {
        this.log('Verifying managed Remastered source\n');
        let usable = false;
        if (await exists(this.source)) {
            try { usable = await this.git.run(this.source, ['rev-parse', '--show-toplevel']) === await fs.realpath(this.source) && await exists(path.join(this.source, 'package.json')); } catch { /* recreate corrupt managed clone */ }
        }
        if (!usable) {
            if (await exists(this.source)) await fs.rename(this.source, `${this.source}.quarantine-${Date.now()}`);
            await this.git.clone(ORIGIN, this.source, 'main');
        }
        const origin = await this.git.run(this.source, ['remote', 'get-url', 'origin']);
        if (origin !== ORIGIN) throw new Error('Managed source has an unexpected origin. Recreate source to repair it.');
        const remotes = await this.git.run(this.source, ['remote']);
        if (!remotes.split('\n').includes('upstream')) await this.git.run(this.source, ['remote', 'add', 'upstream', UPSTREAM]);
        if (await this.git.run(this.source, ['remote', 'get-url', 'upstream']) !== UPSTREAM) throw new Error('Unexpected upstream remote');
        const dirty = await this.git.run(this.source, ['status', '--porcelain', '--untracked-files=no']);
        if (dirty) throw new Error('Managed source contains local changes. They have been preserved; recreate the source from Settings.');
        if (update || !await exists(path.join(this.source, '.git', 'refs', 'remotes', 'upstream', 'main'))) {
            await this.git.run(this.source, ['fetch', 'origin', 'main']);
            await this.git.run(this.source, ['fetch', 'upstream', 'main']);
            if (update) await this.git.run(this.source, ['merge', '--ff-only', 'origin/main']);
        }
        // Refuse an accidental upstream-only clone without the launcher integration.
        if (!await exists(path.join(this.source, 'src', 'remastered', 'native.ts'))) throw new Error('Source lacks Remastered integration; wait for fork publication or update the source');
        return { commit: await this.git.run(this.source, ['rev-parse', 'HEAD']), upstream: await this.git.run(this.source, ['rev-parse', 'upstream/main']) };
    }
    async checkUpdates() {
        const latest = await this.git.run(this.root, ['ls-remote', '--refs', ORIGIN, 'refs/heads/main']);
        const sha = latest.split(/\s/)[0];
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid Remastered revision response');
        const state = await this.state(); state.latest = sha; state.checkedAt = new Date().toISOString();
        await writeJson(this.statePath, state);
        await this.plugins.updates();
        return this.snapshot();
    }
    async settings() { return json(path.join(this.settingsDir, 'settings', 'settings.json'), {}); }
    async setEnabled(id, enabled) {
        if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state');
        await this.assertClosed();
        const plugin = (await this.plugins.list()).find(p => p.id === id);
        if (!plugin) throw new Error('Plugin not found');
        const s = await this.settings(); s.plugins ||= {}; s.plugins[plugin.name] ||= {};
        s.plugins[plugin.name].enabled = enabled;
        await writeJson(path.join(this.settingsDir, 'settings', 'settings.json'), s);
    }
    async seedDisabled(selected) {
        const s = await this.settings(); s.plugins ||= {};
        let changed = false;
        for (const p of selected) if (!Object.hasOwn(s.plugins, p.name)) { s.plugins[p.name] = { enabled: false }; changed = true; }
        if (changed) await writeJson(path.join(this.settingsDir, 'settings', 'settings.json'), s);
    }
    async snapshot() {
        const state = await this.state(); const plugins = await this.plugins.list(); const settings = await this.settings();
        const targets = await this.detect();
        const inputKey = digest(JSON.stringify(plugins.map(p => [p.id, p.content, p.included])));
        return { state, plugins: plugins.map(p => ({ ...p, enabled: settings.plugins?.[p.name]?.enabled ?? false })), targets,
            busy: this.busy, root: this.root, settingsDir: this.settingsDir,
            pending: !!state.active && state.active.pluginKey !== inputKey };
    }
    async validateBuild(dir) {
        const listing = await tree(dir);
        for (const name of REQUIRED) {
            if (!listing.some(f => f.name === name)) throw new Error(`Build artifact missing: ${name}`);
            const bytes = await fs.readFile(path.join(dir, name));
            if (bytes.length < 100) throw new Error(`Build artifact is empty: ${name}`);
            if (name.endsWith('.js')) {
                if (!bytes.toString().includes('// Updater Disabled: true')) throw new Error('Refusing a build with the upstream updater enabled');
                new vm.Script(bytes.toString(), { filename: name });
            }
        }
        return listing;
    }
    async cached(dir) {
        if (!await exists(path.join(dir, 'manifest.json'))) return false;
        try {
            const manifest = await json(path.join(dir, 'manifest.json'));
            for (const file of manifest.files) if (digest(await fs.readFile(inside(dir, file.name))) !== file.hash) return false;
            await this.validateBuild(dir);
            return manifest;
        } catch { return false; }
    }
    async collisionCheck(selected) {
        const names = new Set();
        for (const directory of ['plugins', 'plugins/_core', 'plugins/_api']) {
            const base = path.join(this.source, 'src', directory);
            for (const file of await fs.readdir(base, { withFileTypes: true })) {
                if (file.name.startsWith('_') || file.name.startsWith('.') || file.name === 'index.ts') continue;
                const p = path.join(base, file.name);
                try {
                    const info = file.isDirectory() ? await inspect(p) : { name: /definePlugin\(\{\s*name:\s*["'`]([^"'`]+)/.exec(await fs.readFile(p, 'utf8'))?.[1] };
                    if (info.name) names.add(info.name);
                } catch {
                    // Core required plugins are still included in collision detection.
                    if (file.isDirectory()) for (const entry of ['index.ts', 'index.tsx']) if (await exists(path.join(p, entry))) {
                        const name = /definePlugin\(\{\s*name:\s*["'`]([^"'`]+)/.exec(await fs.readFile(path.join(p, entry), 'utf8'))?.[1];
                        if (name) names.add(name);
                    }
                }
            }
        }
        for (const p of selected) if (names.has(p.name)) throw new Error(`Plugin name ${p.name} conflicts with an official plugin`);
    }
    async build({ update = false, repair = false, safe = false } = {}) {
        let revisions;
        try { revisions = await this.sourceReady(update); }
        catch (e) {
            if (!repair) throw e;
            this.log('Source verification failed; preserving checkout and recreating it\n');
            await this.recreate(); revisions = await this.sourceReady(update);
        }
        const selected = await this.plugins.stage(this.source, safe);
        await this.collisionCheck(selected);
        const tool = await this.tool.prepare(this.source);
        const all = await this.plugins.list();
        const pluginKey = digest(JSON.stringify(all.map(p => [p.id, p.content, p.included])));
        const key = digest(JSON.stringify({ ...revisions, plugins: selected.map(p => [p.id, p.content]), safe, node: tool.node, pnpm: tool.version, configuration: 'desktop-disable-updater-v1' }));
        const final = path.join(this.root, 'builds', key);
        const cached = !repair && await this.cached(final);
        if (cached) { this.log('Validated build cache hit; compilation skipped\n'); return { dir: final, manifest: cached }; }
        await this.tool.install(this.source, tool, repair);
        await fs.rm(path.join(this.source, 'dist'), { recursive: true, force: true });
        this.log('Building Vencord Remastered\n');
        try {
            await this.tool.run(['--require=./scripts/suppressExperimentalWarnings.js', 'scripts/build/build.mjs', '--disable-updater'], this.source,
                { VENCORD_REMOTE: 'rafaelreverberi/vencord-remastered', VENCORD_HASH: revisions.commit.slice(0, 8) });
        } catch (e) {
            const responsible = selected.filter(p => e.message.includes(p.id));
            const names = responsible.map(p => p.name).join(', ');
            throw new Error(`${names ? `Plugin: ${names}\n` : ''}Build failed; the installed bundle is unchanged. Exclude the failing plugin or use Safe Mode.\nMissing imports must be supplied by Vencord; plugin npm installs are unsupported.\n${e.message}`);
        }
        const staging = `${final}.staging-${crypto.randomUUID()}`;
        await fs.mkdir(staging, { recursive: true });
        try {
            await copyTree(path.join(this.source, 'dist'), staging);
            const files = await this.validateBuild(staging);
            const manifest = { ...revisions, key, pluginKey, safe, plugins: selected.map(p => ({ id: p.id, name: p.name, revision: p.revision })), node: tool.node, pnpm: tool.version, date: new Date().toISOString(), files };
            await writeJson(path.join(staging, 'manifest.json'), manifest);
            // Never overwrite a currently referenced immutable build, including repair.
            let publish = final;
            if (await exists(final)) publish = `${final}-${crypto.randomUUID()}`;
            await fs.rename(staging, publish);
            return { dir: publish, manifest };
        } finally { await fs.rm(staging, { recursive: true, force: true }); }
    }
    async apply(targetId, options = {}) {
        const target = (await this.detect()).find(t => t.id === targetId);
        if (!target) throw new Error('Select a detected Discord installation');
        const result = await this.build(options);
        await this.assertClosed();
        await this.patcher.patch(target, result.dir, this.settingsDir, () => this.seedDisabled(result.manifest.plugins));
        const state = await this.state();
        state.active = { ...result.manifest, dir: result.dir };
        state.targets ||= {}; state.targets[target.id] = { ...target, key: result.manifest.key, installedAt: new Date().toISOString() };
        state.lastError = null;
        await writeJson(this.statePath, state);
        this.log('Vencord Remastered installed. Start Discord to load the new build.\n');
        return this.snapshot();
    }
    async recreate() {
        await this.assertClosed();
        if (await exists(this.source)) await fs.rename(this.source, `${this.source}.quarantine-${Date.now()}`);
        return this.sourceReady();
    }
    async configureSettings(dir) {
        if (!path.isAbsolute(dir)) throw new Error('Choose an absolute settings directory');
        await this.assertClosed();
        this.settingsDir = dir;
        const state = await this.state(); state.settingsDir = dir; this.settingsDir = dir;
        await writeJson(this.statePath, state);
    }
}
module.exports = { Manager, ORIGIN, UPSTREAM, settingsLocation, parseLink };
