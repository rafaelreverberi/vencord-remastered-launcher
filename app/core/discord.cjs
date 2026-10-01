// SPDX-License-Identifier: GPL-3.0-or-later
// ASAR loader format and discovery adapted from Vencord Installer.
// Copyright (c) 2023 Vendicated and Vencord contributors. See NOTICE.
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const crypto = require('node:crypto');
const { fs, path, exists, json, atomic, writeJson } = require('./files.cjs');

function asar(patcher) {
    const index = Buffer.from(`require(${JSON.stringify(patcher)})`);
    const pkg = Buffer.from('{"name":"discord","main":"index.js"}');
    const header = Buffer.from(JSON.stringify({ files: { 'index.js': { size: index.length, offset: '0' }, 'package.json': { size: pkg.length, offset: String(index.length) } } }));
    const aligned = (header.length + 3) & ~3;
    const pickle = Buffer.alloc(16 + aligned);
    [4, aligned + 8, aligned + 4, header.length].forEach((n, i) => pickle.writeUInt32LE(n, i * 4));
    header.copy(pickle, 16);
    return Buffer.concat([pickle, index, pkg]);
}
async function detect(platform = process.platform, home = os.homedir(), env = process.env) {
    const names = ['Discord', 'Discord PTB', 'Discord Canary', 'Discord Development'];
    const targets = [];
    async function add(base, branch, flatpak = false, system = false) {
        let resources = platform === 'darwin' ? path.join(base, 'Contents', 'Resources') : system ? base : path.join(base, 'resources');
        if (!await exists(path.join(resources, 'app.asar'))) {
            const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
            const versions = entries.filter(e => e.isDirectory() && /^app-\d/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
            for (const e of versions) {
                const r = path.join(base, e.name, 'resources');
                if (await exists(path.join(r, 'app.asar'))) { resources = r; break; }
            }
        }
        if (await exists(path.join(resources, 'app.asar')) && !targets.some(t => t.resources === resources)) targets.push({ id: crypto.createHash('sha256').update(resources).digest('hex').slice(0, 16), base, resources, branch, flatpak, system, patched: await exists(path.join(resources, '_app.asar')) });
    }
    if (platform === 'darwin') {
        for (const base of ['/Applications', path.join(home, 'Applications')]) for (const name of names) await add(path.join(base, `${name}.app`), name);
    } else if (platform === 'win32') {
        if (!env.LOCALAPPDATA) return [];
        for (const name of names) await add(path.join(env.LOCALAPPDATA, name.replaceAll(' ', '')), name);
    } else {
        const variants = names.flatMap(n => [n.replaceAll(' ', ''), n.toLowerCase().replaceAll(' ', '-'), n.toLowerCase().replaceAll(' ', '')]);
        for (const base of ['/usr/share', '/usr/lib64', '/opt', path.join(home, '.local/share'), path.join(home, '.dvm')]) for (const name of variants) {
            const dir = path.join(base, name);
            await add(dir, name);
            if (await exists(path.join(dir, 'app.asar'))) await add(dir, name, false, true);
        }
        for (const name of ['discord', 'discordcanary', 'discordptb']) await add(path.join(home, '.config', name), name);
        for (const name of ['Discord', 'DiscordCanary', 'DiscordPTB']) {
            const app = `com.discordapp.${name}`;
            for (const base of ['/var/lib/flatpak/app', path.join(home, '.local/share/flatpak/app')]) await add(path.join(base, app, 'current/active/files', name.toLowerCase().replace('discordcanary', 'discord-canary').replace('discordptb', 'discord-ptb')), app, true);
            await add(path.join(home, '.var/app', app, 'config/discord'), app, true);
        }
    }
    return targets;
}
async function assertClosed() {
    let text;
    if (process.platform === 'win32') text = (await execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true })).stdout;
    else text = (await execFile('/bin/ps', ['-axo', 'comm='])).stdout;
    if (text.split('\n').some(line => process.platform === 'win32' ? /^"Discord(?:PTB|Canary|Development)?\.exe"/i.test(line) : /(?:^|\/)(?:Discord(?: PTB| Canary| Development)?|discord(?:-?(?:ptb|canary|development))?)(?:$|\.app\/)/i.test(line.trim()))) throw new Error('Quit Discord before applying changes or editing plugin enabled states. The launcher will not close it for you.');
}

class Patcher {
    constructor(root, log = () => {}) { this.root = root; this.log = log; this.journal = path.join(root, 'patch-transaction.json'); }
    async recover() {
        if (!await exists(this.journal)) return;
        const j = await json(this.journal);
        // Journals are launcher-owned; validate shape before touching any external file.
        if (!j.resources || !path.isAbsolute(j.resources) || typeof j.first !== 'boolean' || typeof j.loader !== 'string') throw new Error('Invalid patch journal; manual recovery required');
        const app = path.join(j.resources, 'app.asar');
        const backup = path.join(j.resources, '_app.asar');
        const rollback = path.join(j.resources, 'app.asar.remastered-rollback');
        if (await exists(rollback)) { await fs.rm(app, { force: true }); await fs.rename(rollback, app); }
        else if (j.first && await exists(backup)) { await fs.rm(app, { force: true }); await fs.rename(backup, app); }
        if (j.system && j.first && await exists(`${backup}.unpacked`) && !await exists(`${app}.unpacked`)) await fs.rename(`${backup}.unpacked`, `${app}.unpacked`);
        if (j.loader) await atomic(path.join(this.root, 'loader.cjs'), j.loader);
        else await fs.rm(path.join(this.root, 'loader.cjs'), { force: true });
        await fs.rm(this.journal);
        this.log('Recovered interrupted patch; previous installation restored\n');
    }
    async patch(target, build, settingsDir, beforePublish = async () => {}) {
        await this.recover();
        const resources = target.resources;
        const app = path.join(resources, 'app.asar');
        const backup = path.join(resources, '_app.asar');
        const rollback = path.join(resources, 'app.asar.remastered-rollback');
        const temp = path.join(resources, `app.asar.remastered-${crypto.randomUUID()}`);
        const loaderPath = path.join(this.root, 'loader.cjs');
        const first = !await exists(backup);
        const oldLoader = await fs.readFile(loaderPath, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
        const loader = `// Vencord Remastered: launcher-managed, do not edit\nprocess.env.VENCORD_USER_DATA_DIR=${JSON.stringify(settingsDir)};\nrequire(${JSON.stringify(path.join(build, 'patcher.js'))});\n`;
        if (target.flatpak) {
            const appId = /com\.discordapp\.[A-Za-z]+/.exec(target.branch)?.[0];
            if (!appId) throw new Error('Cannot determine Flatpak application ID');
            // Minimal per-app grant, argv only, no shell. System Flatpaks need admin grant.
            const args = target.base.startsWith('/var/') ? [] : ['--user'];
            await execFile('flatpak', [...args, 'override', appId, `--filesystem=${this.root}:ro`, `--filesystem=${settingsDir}`]);
        }
        await fs.writeFile(temp, asar(loaderPath), { flag: 'wx' });
        await writeJson(this.journal, { resources, first, loader: oldLoader, system: !!target.system });
        try {
            await beforePublish();
            if (first) {
                await fs.rename(app, backup);
                if (target.system && await exists(`${app}.unpacked`)) await fs.rename(`${app}.unpacked`, `${backup}.unpacked`);
            } else await fs.rename(app, rollback);
            await atomic(loaderPath, loader);
            await fs.rename(temp, app);
            // Removing the journal is the commit point. Backups are retained.
            await fs.rm(this.journal);
            await fs.rm(rollback, { force: true });
        } catch (e) {
            await fs.rm(temp, { force: true });
            await this.recover();
            throw new Error(`Patching failed; previous installation restored: ${e.message}`);
        }
    }
}
module.exports = { asar, detect, assertClosed, Patcher };
