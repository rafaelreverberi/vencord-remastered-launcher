// SPDX-License-Identifier: GPL-3.0-or-later
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
async function main() {
    const executable = process.env.REMASTERED_APP_EXECUTABLE;
    const app = await electron.launch(executable ? { executablePath: executable } : { args: [path.resolve('.')] });
    try {
        const page = await app.firstWindow();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.waitForURL('remastered-app://launcher/');
        await page.waitForSelector('#target option', { timeout: 60000, state: 'attached' });
        assert.equal(await page.title(), 'Vencord Remastered Launcher');
        assert.equal(await page.evaluate(() => typeof require), 'undefined');
        assert.equal(await page.evaluate(() => typeof process), 'undefined');
        await fs.mkdir('output/playwright', { recursive: true });
        await page.screenshot({ path: 'output/playwright/overview.png', fullPage: true });
        await page.locator('nav button[data-page="plugins"]').click();
        await page.locator('#add').click();
        await page.locator('#add-dialog').waitFor({ state: 'visible' });
        await page.screenshot({ path: 'output/playwright/add-plugin.png' });
        await page.locator('#close-dialog').click();
        await page.locator('nav button[data-page="settings"]').click();
        await page.locator('#data-path').waitFor({ state: 'visible' });
        await page.screenshot({ path: 'output/playwright/settings.png', fullPage: true });
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log('Real Electron UI passed: overview, navigation, add-plugin dialog, settings, sandbox isolation');
        console.log(await page.locator('#install-status').textContent());
    } finally { await app.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
