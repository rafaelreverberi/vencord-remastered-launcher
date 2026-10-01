// SPDX-License-Identifier: GPL-3.0-or-later
// Real network + full Vencord builds; only Discord ASAR target is a fixture.
const assert = require('node:assert/strict');
const os = require('node:os');
const { Manager } = require('../app/core/manager.cjs');
const { fs, path, writeJson, json, exists } = require('../app/core/files.cjs');
async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remastered-integration-'));
    const resources = path.join(root, 'discord/resources'); await fs.mkdir(resources, { recursive: true });
    await fs.writeFile(path.join(resources, 'app.asar'), 'fixture-original-discord-asar');
    const data = path.join(root, 'data'); const settingsDir = path.join(root, 'vencord');
    const output = [];
    const manager = new Manager(data, { settingsDir, node: process.execPath, log: chunk => { output.push(chunk); process.stdout.write(chunk); },
        detect: async () => [{ id: 'fixture', resources, base: path.dirname(resources), branch: 'Fixture' }], assertClosed: async () => {} });
    await manager.initialize();
    console.log('Integration workspace:', root);
    for (const name of ['RemasteredTestOne', 'RemasteredTestTwo', 'RemasteredTestThree']) {
        const dir = path.join(root, name); await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, 'index.ts'), `import definePlugin from '@utils/types'; export default definePlugin({name: "${name}", description: "Integration fixture", authors: [], enabledByDefault: true});`);
        await manager.plugins.addLocal(dir);
    }
    const settingsFile = path.join(settingsDir, 'settings/settings.json');
    await writeJson(settingsFile, { plugins: { OfficialExisting: { enabled: true, option: 3 }, RemasteredTestOne: { enabled: true, option: 'keep' } }, themeLinks: ['https://example.com/theme.css'] });
    const first = await manager.apply('fixture');
    assert.equal(first.state.active.plugins.length, 3);
    assert.match(await fs.readFile(path.join(first.state.active.dir, 'renderer.js'), 'utf8'), /RemasteredTestThree/);
    let settings = await json(settingsFile);
    assert.deepEqual(settings.plugins.RemasteredTestOne, { enabled: true, option: 'keep' });
    assert.equal(settings.plugins.RemasteredTestTwo.enabled, false);
    const loaderPath = path.join(data, 'loader.cjs'); const workingLoader = await fs.readFile(loaderPath);
    const key = first.state.active.key; const timestamp = (await fs.stat(first.state.active.dir)).mtimeMs;
    await manager.apply('fixture');
    assert.equal((await fs.stat(first.state.active.dir)).mtimeMs, timestamp);
    assert(output.some(s => s.includes('cache hit')));
    await manager.apply('fixture', { update: true });
    assert.equal((await manager.state()).active.key, key);
    const broken = path.join(root, 'broken'); await fs.mkdir(broken);
    await fs.writeFile(path.join(broken, 'index.ts'), `import x from 'unsupported-remastered-package'; import definePlugin from '@utils/types'; export default definePlugin({name: "BrokenFixture", description: "Broken", authors: [], start() { console.log(x); }});`);
    const bad = await manager.plugins.addLocal(broken);
    await assert.rejects(manager.apply('fixture'), /Plugin: BrokenFixture[\s\S]*Build failed/);
    assert.deepEqual(await fs.readFile(loaderPath), workingLoader);
    await manager.plugins.change(bad.id, 'exclude'); await manager.apply('fixture');
    await manager.apply('fixture', { safe: true });
    assert.equal((await manager.state()).active.plugins.length, 0);
    assert.equal((await manager.plugins.list()).length, 4);
    await fs.rm(manager.source, { recursive: true });
    const recreated = await manager.apply('fixture');
    assert.equal(recreated.state.active.plugins.length, 3);
    assert.equal((await manager.plugins.list()).length, 4);
    settings = await json(settingsFile);
    assert.deepEqual(settings.plugins.RemasteredTestOne, { enabled: true, option: 'keep' });
    assert.equal(settings.plugins.OfficialExisting.option, 3);
    assert.equal(await fs.readFile(path.join(resources, '_app.asar'), 'utf8'), 'fixture-original-discord-asar');
    const report = { success: true, date: new Date().toISOString(), workspace: root, commit: recreated.state.active.commit,
        node: process.versions.node, cases: ['fresh clone/build', 'three persistent plugins', 'new plugins disabled', 'settings preserved', 'build cache hit', 'source update', 'broken plugin preserves active loader', 'exclude and recover', 'safe mode preserves storage', 'source deletion and fresh recreation'] };
    await fs.mkdir(path.resolve('test-output'), { recursive: true });
    await writeJson(path.resolve('test-output/integration.json'), report);
    console.log(JSON.stringify(report, null, 2));
    if (!process.env.REMASTERED_KEEP_TEST_DATA) await fs.rm(root, { recursive: true });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
