// SPDX-License-Identifier: GPL-3.0-or-later
// Electron virtualizes ASARs; patching must use the raw filesystem.
const fs = (() => { try { return require('original-fs').promises; } catch { return require('node:fs/promises'); } })();
const path = require('node:path');
const crypto = require('node:crypto');

async function exists(p) { try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function json(p, fallback) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw new Error(`Cannot read ${path.basename(p)}: ${e.message}`); } }
async function atomic(p, data) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${crypto.randomUUID()}.tmp`;
    const handle = await fs.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    try { await fs.rename(tmp, p); } catch (e) { await fs.rm(tmp, { force: true }); throw e; }
}
const writeJson = (p, data) => atomic(p, JSON.stringify(data, null, 2));
function inside(base, relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative)) throw new Error('Unsafe relative path');
    const result = path.resolve(base, relative);
    const rel = path.relative(path.resolve(base), result);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes its storage directory');
    return result;
}
async function tree(base) {
    const output = [];
    let total = 0;
    async function walk(dir, rel = '') {
        const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (['.git', 'node_modules', '.DS_Store'].includes(entry.name)) continue;
            if (entry.name.includes('\\') || entry.name.includes(':') || entry.name === '..') throw new Error('Unsafe plugin filename');
            const name = rel ? `${rel}/${entry.name}` : entry.name;
            const p = inside(base, name);
            const st = await fs.lstat(p);
            if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new Error(`Links and special files are not supported: ${name}`);
            if (st.isDirectory()) await walk(p, name);
            else {
                total += st.size;
                if (st.size > 20 * 1024 * 1024 || total > 100 * 1024 * 1024 || output.length > 10000) throw new Error('Plugin exceeds import limits');
                output.push({ name, hash: digest(await fs.readFile(p)) });
            }
        }
    }
    const stat = await fs.lstat(base);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a real plugin directory');
    await walk(base);
    return output;
}
function digest(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
async function copyTree(src, dest) {
    const listing = await tree(src);
    for (const file of listing) {
        const output = inside(dest, file.name);
        await fs.mkdir(path.dirname(output), { recursive: true });
        const input = inside(src, file.name);
        const bytes = await fs.readFile(input);
        // Guard changing local input during import; only regular checked content is copied.
        if (digest(bytes) !== file.hash) throw new Error('Plugin changed during import. Retry after saving files.');
        await fs.writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
    }
    return digest(JSON.stringify(listing));
}
module.exports = { fs, path, exists, json, atomic, writeJson, inside, tree, digest, copyTree };
