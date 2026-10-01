// SPDX-License-Identifier: GPL-3.0-or-later
// Opt-in live macOS smoke test; modifies the selected detected Discord patch.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
async function main() {
    if (!process.env.REMASTERED_LIVE_INSTALL) throw new Error('Set REMASTERED_LIVE_INSTALL=1 only with authorization for a real Discord patch');
    const executablePath = process.env.REMASTERED_APP_EXECUTABLE;
    if (!executablePath) throw new Error('Set the packaged app executable');
    const application = await electron.launch({ executablePath });
    try {
        const page = await application.firstWindow();
        await page.waitForURL('remastered-app://launcher/');
        await page.waitForSelector('#target option', { state: 'attached' });
        await page.waitForFunction(async () => !(await window.remastered.invoke('snapshot')).busy, null, { timeout: 60000 });
        const before = await page.evaluate(() => window.remastered.invoke('snapshot'));
        const target = before.targets.find(t => t.branch === 'Discord');
        assert(target, 'Stable Discord was not detected');
        const backup = path.join(before.root, `backup-before-live-test-${Date.now()}`);
        await fs.mkdir(backup);
        for (const name of ['app.asar', '_app.asar']) await fs.copyFile(path.join(target.resources, name), path.join(backup, name));
        await fs.writeFile(path.join(backup, 'target.json'), JSON.stringify(target, null, 2));
        await page.selectOption('#target', target.id);
        await page.locator('#apply').click();
        await page.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 900000 });
        const error = await page.locator('#error').textContent();
        assert.equal(await page.locator('#error').isVisible(), false, error);
        const after = await page.evaluate(() => window.remastered.invoke('snapshot'));
        assert(after.state.targets[target.id]);
        assert.equal(after.state.active.safe, false);
        await page.screenshot({ path: 'output/playwright/live-installed.png', fullPage: true });
        await fs.writeFile('test-output/live-install.json', JSON.stringify({ date: new Date().toISOString(), target, backup, commit: after.state.active.commit, node: after.state.active.node }, null, 2));
        console.log('Live Discord patch succeeded:', target.resources, 'Backup:', backup);
    } finally { await application.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
