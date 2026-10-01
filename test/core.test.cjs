// SPDX-License-Identifier: GPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { fs, path, exists, json, writeJson, inside, tree } = require('../app/core/files.cjs');
const { Plugins } = require('../app/core/plugins.cjs');
const { Git, gitUrl } = require('../app/core/git.cjs');
const { Patcher, asar, detect } = require('../app/core/discord.cjs');
const { Manager, parseLink } = require('../app/core/manager.cjs');
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vr-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
async function fixture(base, name = 'TestPlugin', extra = '') {
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, 'index.ts'), `import definePlugin from '@utils/types'; export default definePlugin({ name: "${name}", description: "A test plugin", authors: [], ${extra} });`);
    return base;
}
test('URL and protocol validation blocks executable transports and command-like parameters', () => {
    for (const url of ['file:///tmp/plugin', 'ssh://github.com/x/y', 'https://user:pass@github.com/x/y', 'https://github.com/x/y?exec=sh', 'ext::sh']) assert.throws(() => gitUrl(url));
    assert.equal(gitUrl('https://github.com/x/y'), 'https://github.com/x/y');
    assert.equal(parseLink('vencord-remastered://update'), true);
    for (const value of ['vencord-remastered://update?cmd=x', 'vencord-remastered://update/path', 'vencord-remastered://x', 'https://update', 'vencord-remastered://user@update']) assert.equal(parseLink(value), false);
});
test('path traversal, symlinks and special names are rejected', async t => {
    const root = await temp(t);
    for (const p of ['../escape', '/absolute', 'foo/../../escape', 'foo\\bar']) assert.throws(() => inside(root, p));
    await fs.symlink(root, path.join(root, 'link'));
    await assert.rejects(tree(root), /Links/);
});
test('plugin copy is canonical, stages deterministically, and survives source recreation', async t => {
    const root = await temp(t); const local = await fixture(path.join(root, 'local'));
    const plugins = new Plugins(path.join(root, 'data'), new Git(path.join(root, 'cache')));
    const p = await plugins.addLocal(local);
    assert.equal(p.included, true);
    await fs.rm(local, { recursive: true });
    const source = path.join(root, 'source');
    await plugins.stage(source);
    assert.equal(await exists(path.join(source, 'src/userplugins', p.id, 'index.ts')), true);
    await fs.rm(source, { recursive: true });
    await plugins.stage(source);
    await plugins.change(p.id, 'exclude');
    await plugins.stage(source);
    assert.equal((await fs.readdir(path.join(source, 'src/userplugins'))).length, 0);
    await plugins.change(p.id, 'include');
    await plugins.stage(source, true);
    assert.equal((await plugins.list()).length, 1);
    assert.equal((await fs.readdir(path.join(source, 'src/userplugins'))).length, 0);
    await plugins.stage(source);
    assert.equal((await fs.readdir(path.join(source, 'src/userplugins'))).length, 1);
});
test('required and duplicate plugins are rejected and damaged copies fail staging', async t => {
    const root = await temp(t); const plugins = new Plugins(path.join(root, 'data'), null);
    await assert.rejects(plugins.addLocal(await fixture(path.join(root, 'required'), 'Required', 'required: true')), /must not declare/);
    const p = await plugins.addLocal(await fixture(path.join(root, 'one')));
    await assert.rejects(plugins.addLocal(await fixture(path.join(root, 'two'))), /already installed/);
    await fs.appendFile(path.join(root, 'data', p.storage, 'index.ts'), 'damaged');
    await assert.rejects(plugins.stage(path.join(root, 'source')), /damaged/);
});
test('enable state changes preserve all existing Vencord and plugin settings', async t => {
    const root = await temp(t); const settingsDir = path.join(root, 'settings-data');
    const manager = new Manager(path.join(root, 'data'), { settingsDir, assertClosed: async () => {} });
    const p = await manager.plugins.addLocal(await fixture(path.join(root, 'plugin')));
    const file = path.join(settingsDir, 'settings/settings.json');
    const initial = { themeLinks: ['https://example.com/theme.css'], plugins: { TestPlugin: { enabled: false, secretSetting: 'keep' }, Official: { enabled: true } } };
    await writeJson(file, initial);
    await manager.setEnabled(p.id, true);
    const next = await json(file);
    assert.deepEqual(next, { ...initial, plugins: { ...initial.plugins, TestPlugin: { enabled: true, secretSetting: 'keep' } } });
    await manager.plugins.change(p.id, 'remove');
    assert.deepEqual(await json(file), next);
});
test('ASAR header follows Electron pickle layout and keeps exact absolute patch path', () => {
    const input = '/tmp/a space/"quoted"/loader.cjs'; const bytes = asar(input);
    assert.equal(bytes.readUInt32LE(0), 4);
    const length = bytes.readUInt32LE(12); const header = JSON.parse(bytes.subarray(16, 16 + length));
    const body = 8 + bytes.readUInt32LE(4);
    assert.equal(bytes.subarray(body, body + header.files['index.js'].size).toString(), `require(${JSON.stringify(input)})`);
    assert.equal(JSON.parse(bytes.subarray(body + Number(header.files['package.json'].offset)).toString()).main, 'index.js');
});
test('successful patch preserves original and repatch failure restores working ASAR and loader', async t => {
    const root = await temp(t); const data = path.join(root, 'data'); await fs.mkdir(data);
    const resources = path.join(root, 'resources'); await fs.mkdir(resources);
    const app = path.join(resources, 'app.asar'); await fs.writeFile(app, 'original-discord');
    const target = { resources }; const patcher = new Patcher(data);
    await patcher.patch(target, '/first/build', '/settings');
    assert.equal(await fs.readFile(path.join(resources, '_app.asar'), 'utf8'), 'original-discord');
    const good = await fs.readFile(app); const loader = await fs.readFile(path.join(data, 'loader.cjs'));
    // Inject failure after preparation before publication; real recovery runs.
    await assert.rejects(patcher.patch(target, '/broken/build', '/settings', async () => { throw new Error('disk write failed'); }), /previous installation restored/);
    assert.deepEqual(await fs.readFile(app), good);
    assert.deepEqual(await fs.readFile(path.join(data, 'loader.cjs')), loader);
    await patcher.patch(target, '/second/build', '/settings');
    assert.match(await fs.readFile(path.join(data, 'loader.cjs'), 'utf8'), /second\/build/);
    assert.equal(await fs.readFile(path.join(resources, '_app.asar'), 'utf8'), 'original-discord');
});
test('interrupted first patch recovers original archive and system unpacked directory', async t => {
    const root = await temp(t); const resources = path.join(root, 'resources'); const data = path.join(root, 'data');
    await fs.mkdir(resources); await fs.mkdir(data);
    await fs.writeFile(path.join(resources, '_app.asar'), 'original');
    await fs.mkdir(path.join(resources, '_app.asar.unpacked'));
    await fs.writeFile(path.join(resources, 'app.asar'), 'partial');
    await writeJson(path.join(data, 'patch-transaction.json'), { resources, first: true, loader: '', system: true });
    await new Patcher(data).recover();
    assert.equal(await fs.readFile(path.join(resources, 'app.asar'), 'utf8'), 'original');
    assert.equal(await exists(path.join(resources, 'app.asar.unpacked')), true);
    assert.equal(await exists(path.join(data, 'patch-transaction.json')), false);
});
test('build failure never calls patch publication', async t => {
    const root = await temp(t); let patched = false;
    const manager = new Manager(root, { detect: async () => [{ id: 'discord', resources: '/fixture' }], assertClosed: async () => {} });
    manager.build = async () => { throw new Error('compile failed'); };
    manager.patcher.patch = async () => { patched = true; };
    await assert.rejects(manager.apply('discord'), /compile failed/);
    assert.equal(patched, false);
});
test('embedded Git works without system Git and does not run configured hooks', async t => {
    const root = await temp(t); const repo = path.join(root, 'repo'); await fs.mkdir(repo);
    const git = new Git(path.join(root, 'cache'));
    await git.run(repo, ['init']);
    assert.equal(await git.run(repo, ['rev-parse', '--show-toplevel']), await fs.realpath(repo));
    await git.run(repo, ['config', 'core.hooksPath', path.join(root, 'malicious-hooks')]);
    await fs.mkdir(path.join(root, 'malicious-hooks'));
    await fs.writeFile(path.join(root, 'malicious-hooks/pre-commit'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    await fs.writeFile(path.join(repo, 'file'), 'safe'); await git.run(repo, ['add', 'file']);
    await git.run(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Test']);
    assert.match(await git.run(repo, ['rev-parse', 'HEAD']), /^[a-f0-9]{40}$/);
});
test('Windows version detection chooses numeric newest resources directory', async t => {
    const root = await temp(t);
    for (const v of ['9.0.0', '10.0.0']) { const resources = path.join(root, 'Discord', `app-${v}`, 'resources'); await fs.mkdir(resources, { recursive: true }); await fs.writeFile(path.join(resources, 'app.asar'), 'discord'); }
    const targets = await detect('win32', root, { LOCALAPPDATA: root });
    assert.equal(targets.length, 1); assert.match(targets[0].resources, /app-10\.0\.0/);
});
