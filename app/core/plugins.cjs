// SPDX-License-Identifier: GPL-3.0-or-later
const crypto = require('node:crypto');
const { fs, path, json, writeJson, inside, tree, digest, copyTree, exists } = require('./files.cjs');
const { gitUrl } = require('./git.cjs');

async function entrypoint(dir) {
    for (const name of ['index.ts', 'index.tsx']) if (await exists(path.join(dir, name))) return name;
    const candidates = (await fs.readdir(dir)).filter(f => /\.tsx?$/.test(f) && f !== 'native.ts');
    if (candidates.length === 1) return candidates[0];
    throw new Error('Plugin needs index.ts/index.tsx, or one top-level TypeScript entrypoint. Choose the individual plugin folder.');
}
async function inspect(dir) {
    await tree(dir);
    const entry = await entrypoint(dir);
    const text = await fs.readFile(path.join(dir, entry), 'utf8');
    const name = /definePlugin\(\{\s*(["'])?name\1:\s*(["'`])(.+?)\2/.exec(text)?.[3];
    if (!name || name.length > 100 || /[\r\n\0]/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Entrypoint must use definePlugin({ name: "PluginName", … }) with a literal name first');
    if (/\brequired\s*:\s*true/.test(text)) throw new Error('Third-party plugins must not declare required: true');
    return { name, entry, description: /description\s*:\s*(["'`])([\s\S]*?)\1/.exec(text)?.[2] || 'No description declared',
        author: /authors\s*:\s*\[([\s\S]*?)\]/.exec(text)?.[1].replace(/\s+/g, ' ').slice(0, 250) || 'Not declared' };
}
async function findPluginRoot(dir) {
    // Inspect source only; never import/evaluate repository modules.
    const files = await tree(dir);
    try { await inspect(dir); return dir; } catch (e) {
        if (e.message.includes('must not declare')) throw e;
    }
    const candidates = [];
    for (const file of files.filter(f => /(?:^|\/)index\.tsx?$/.test(f.name) && f.name.split('/').length <= 5)) {
        const folder = path.dirname(inside(dir, file.name));
        try { await inspect(folder); candidates.push(folder); } catch (e) {
            if (e.message.includes('must not declare')) throw e;
        }
    }
    if (candidates.length !== 1) throw new Error(candidates.length ? 'Repository contains multiple plugins. Import an individual plugin folder.' : 'No supported Vencord plugin entrypoint found');
    return candidates[0];
}
class Plugins {
    constructor(root, git) { this.root = root; this.git = git; this.file = path.join(root, 'plugin-metadata.json'); }
    async list() {
        const value = await json(this.file, []);
        if (!Array.isArray(value)) throw new Error('Plugin metadata must be an array');
        const names = new Set();
        for (const p of value) {
            if (!/^[a-f0-9-]{36}$/.test(p.id) || !/^[a-f0-9]{64}$/.test(p.content) || typeof p.name !== 'string' || names.has(p.name)) throw new Error('Invalid or duplicate plugin metadata');
            inside(this.root, p.storage);
            if (!p.storage.startsWith(`plugins/${p.id}/`)) throw new Error('Invalid plugin storage path');
            if (p.url) gitUrl(p.url);
            names.add(p.name);
        }
        return value;
    }
    async snapshot(dir, source, previous) {
        const input = await findPluginRoot(dir);
        const info = await inspect(input);
        const identifier = info.entry.startsWith('index.') ? path.basename(input) : info.entry.replace(/\.tsx?$/, '');
        const suffix = identifier.split('.').at(-1);
        const target = ['desktop', 'discordDesktop', 'web', 'browser', 'vesktop', 'dev'].includes(suffix) ? suffix : '';
        if (target && !['desktop', 'discordDesktop'].includes(target)) throw new Error(`Plugin target ${target} is not compatible with this Discord desktop build`);
        const subdirectory = path.relative(dir, input).split(path.sep).join('/');
        if (previous && info.name !== previous.name) throw new Error('Plugin changed identity. Import it separately to preserve settings.');
        const id = previous?.id || crypto.randomUUID();
        const temp = path.join(this.root, 'cache', `import-${crypto.randomUUID()}`);
        await fs.mkdir(temp, { recursive: true });
        try {
            await copyTree(input, temp);
            if (info.entry !== 'index.ts' && info.entry !== 'index.tsx') {
                // Preserve helper imports and native.ts; normalize only the entrypoint.
                await fs.rename(path.join(temp, info.entry), path.join(temp, info.entry.endsWith('.tsx') ? 'index.tsx' : 'index.ts'));
            }
            const normalized = await inspect(temp);
            const content = digest(JSON.stringify(await tree(temp)));
            const storage = `plugins/${id}/${content}`;
            const dest = inside(this.root, storage);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            if (await exists(dest)) await fs.rm(temp, { recursive: true });
            else await fs.rename(temp, dest);
            return { ...previous, ...normalized, ...source, subdirectory, target, id, storage, content, included: previous?.included ?? true, installedAt: new Date().toISOString() };
        } finally { await fs.rm(temp, { recursive: true, force: true }); }
    }
    async addLocal(dir) {
        const list = await this.list();
        const plugin = await this.snapshot(dir, { source: 'local copy', revision: 'local' });
        if (list.some(p => p.name === plugin.name)) throw new Error('A plugin with this name is already installed');
        await writeJson(this.file, [...list, plugin]);
        return plugin;
    }
    async gitSnapshot(url, branch, previous) {
        url = gitUrl(url);
        const temp = path.join(this.root, 'cache', `clone-${crypto.randomUUID()}`);
        await fs.mkdir(path.dirname(temp), { recursive: true });
        try {
            await this.git.clone(url, temp, branch);
            const revision = await this.git.run(temp, ['rev-parse', 'HEAD']);
            const resolvedBranch = await this.git.run(temp, ['branch', '--show-current']);
            return await this.snapshot(temp, { source: 'git', url, branch: resolvedBranch, revision, latestRevision: revision }, previous);
        } finally { await fs.rm(temp, { recursive: true, force: true }); }
    }
    async addGit(url, branch) {
        const list = await this.list();
        const plugin = await this.gitSnapshot(url, branch);
        if (list.some(p => p.name === plugin.name)) throw new Error('A plugin with this name is already installed');
        await writeJson(this.file, [...list, plugin]);
        return plugin;
    }
    async updates() {
        const list = await this.list();
        for (const p of list.filter(p => p.url)) {
            try {
                const ref = await this.git.run(this.root, ['ls-remote', '--refs', p.url, `refs/heads/${p.branch}`]);
                p.latestRevision = ref.split(/\s/)[0] || p.revision;
                p.updateError = undefined;
            } catch (e) { p.updateError = e.message; }
        }
        await writeJson(this.file, list);
        return list;
    }
    async update(ids) {
        const list = await this.list();
        const replacements = [];
        // Prepare all snapshots first; failed downloads leave metadata unchanged.
        for (const p of list.filter(p => ids.includes(p.id) && p.url)) replacements.push(await this.gitSnapshot(p.url, p.branch, p));
        const next = list.map(p => replacements.find(r => r.id === p.id) || p);
        await writeJson(this.file, next);
        return next;
    }
    async change(id, action) {
        const list = await this.list();
        const p = list.find(p => p.id === id);
        if (!p) throw new Error('Plugin not found');
        if (action === 'remove') await writeJson(this.file, list.filter(p => p.id !== id));
        else if (action === 'include' || action === 'exclude') { p.included = action === 'include'; await writeJson(this.file, list); }
        else throw new Error('Invalid plugin action');
        // Old snapshots remain until explicit future garbage collection, enabling recovery.
    }
    async stage(source, safe = false) {
        const dest = path.join(source, 'src', 'userplugins');
        await fs.rm(dest, { recursive: true, force: true });
        await fs.mkdir(dest, { recursive: true });
        const selected = safe ? [] : (await this.list()).filter(p => p.included).sort((a, b) => a.id.localeCompare(b.id));
        for (const p of selected) {
            const src = inside(this.root, p.storage);
            if (digest(JSON.stringify(await tree(src))) !== p.content) throw new Error(`Stored plugin ${p.name} is damaged; reimport it`);
            await copyTree(src, path.join(dest, p.id + (p.target ? `.${p.target}` : '')));
        }
        return selected;
    }
}
module.exports = { Plugins, inspect, entrypoint, findPluginRoot };
