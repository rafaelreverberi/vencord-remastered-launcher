// SPDX-License-Identifier: GPL-3.0-or-later
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
async function main() {
    if (!process.env.REMASTERED_LIVE_INSTALL) throw new Error('Live installation authorization required');
    const app = await electron.launch({ executablePath: process.env.REMASTERED_APP_EXECUTABLE });
    try {
        const page = await app.firstWindow(); await page.waitForURL('remastered-app://launcher/');
        await page.waitForFunction(async () => !(await window.remastered.invoke('snapshot')).busy, null, { timeout: 60000 });
        await page.locator('nav button[data-page="plugins"]').click(); await page.locator('#add').click();
        await page.locator('#repo-url').fill('https://github.com/rafaelreverberi/vencord-remastered-launcher');
        await page.locator('#repo-branch').fill('sample-plugin');
        await page.locator('#add-form button[type="submit"]').click();
        console.log('Native trust warning is open; approve only the audited harmless sample-plugin branch.');
        await page.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 900000 });
        assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
        const snapshot = await page.evaluate(() => window.remastered.invoke('snapshot'));
        const plugin = snapshot.plugins.find(p => p.name === 'RemasteredSmokeTest');
        assert(plugin); assert.equal(plugin.enabled, false);
        assert(snapshot.state.active.plugins.some(p => p.name === 'RemasteredSmokeTest'));
        await page.screenshot({ path: 'output/playwright/live-git-plugin.png', fullPage: true });
        await fs.writeFile('test-output/live-git-plugin.json', JSON.stringify({ date: new Date().toISOString(), plugin, commit: snapshot.state.active.commit }, null, 2));
        console.log('Live Git plugin imported, persisted, built, patched and initially disabled');
    } finally { await app.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
