// SPDX-License-Identifier: GPL-3.0-or-later
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const semver = require('semver');
const tar = require('tar');
const { setupEnvironment } = require('dugite');
const { fs, path, json, exists, digest } = require('./files.cjs');
async function download(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'registry.npmjs.org') throw new Error('Untrusted toolchain download host');
    const res = await fetch(u, { signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!res.ok) throw new Error(`Toolchain download failed (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 40 * 1024 * 1024) throw new Error('Toolchain download exceeds size limit');
    return data;
}
class Toolchain {
    constructor(root, log = () => {}, executable = process.execPath) { this.root = root; this.log = log; this.executable = executable; }
    run(args, cwd, more = {}) {
        const environment = setupEnvironment({ ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ...more }).env;
        return new Promise((resolve, reject) => {
            const child = spawn(this.executable, args, { cwd, env: environment, shell: false, windowsHide: true });
            let output = '';
            for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
                const chunk = bytes.toString(); output = (output + chunk).slice(-200000); this.log(chunk);
            });
            const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
            child.once('error', e => { clearTimeout(timer); reject(e); });
            child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(`Build/toolchain command failed (${code})\n${output}`)); });
        });
    }
    async prepare(source) {
        const pkg = await json(path.join(source, 'package.json'));
        const node = await this.run(['-p', 'process.versions.node'], source);
        if (!semver.satisfies(node, pkg.engines?.node || '>=22')) throw new Error(`This source needs Node ${pkg.engines?.node}; launcher bundles ${node}. Update the launcher.`);
        const version = /^pnpm@([\d]+\.[\d]+\.[\d]+)(?:\+sha\d+\..+)?$/.exec(pkg.packageManager)?.[1];
        if (!version) throw new Error('Source does not specify an exact supported pnpm version');
        const dir = path.join(this.root, 'cache', 'pnpm', version);
        const bin = path.join(dir, 'package', 'bin', 'pnpm.cjs');
        if (!await exists(bin)) {
            this.log(`Preparing pnpm ${version}\n`);
            const meta = JSON.parse((await download(`https://registry.npmjs.org/pnpm/${version}`)).toString());
            const archive = await download(meta.dist.tarball);
            const actual = crypto.createHash('sha512').update(archive).digest('base64');
            if (meta.dist.integrity !== `sha512-${actual}`) throw new Error('pnpm integrity verification failed');
            const temporary = `${dir}.staging-${crypto.randomUUID()}`;
            await fs.mkdir(temporary, { recursive: true });
            try {
                const file = path.join(temporary, 'pnpm.tgz');
                await fs.writeFile(file, archive);
                await tar.x({ file, cwd: temporary, strict: true, preservePaths: false,
                    filter: (name, entry) => name.startsWith('package/') && !name.split('/').includes('..') && ['File', 'Directory'].includes(entry.type) });
                await fs.rm(file);
                await fs.mkdir(path.dirname(dir), { recursive: true });
                await fs.rename(temporary, dir);
            } finally { await fs.rm(temporary, { recursive: true, force: true }); }
        }
        const detected = await this.run([bin, '--version'], source);
        if (detected !== version) throw new Error('Cached pnpm version is invalid; remove damaged cache and repair');
        return { bin, version, node, package: pkg };
    }
    async install(source, tool, force) {
        const key = digest(await fs.readFile(path.join(source, 'pnpm-lock.yaml'))) + digest(await fs.readFile(path.join(source, 'pnpm-workspace.yaml')));
        const marker = path.join(source, 'node_modules', '.remastered-dependencies');
        if (!force && await exists(marker) && await fs.readFile(marker, 'utf8') === key) return;
        this.log('Installing locked Vencord dependencies (lifecycle scripts disabled)\n');
        await this.run([tool.bin, 'install', '--frozen-lockfile', '--ignore-scripts', '--config.manage-package-manager-versions=false'], source);
        await fs.writeFile(marker, key);
    }
}
module.exports = { Toolchain, download };
