// SPDX-License-Identifier: GPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const { latestRelease, RELEASE_API } = require('../app/core/launcher-release.cjs');
test('launcher release discovery pins API and download origin and rejects malformed tags', async () => {
    let url;
    const result = await latestRelease(async (u, options) => { url = u; assert.ok(options.signal); return { ok: true, json: async () => ({ tag_name: 'v1.2.3', assets: [{ browser_download_url: 'https://untrusted.example/' }] }) }; });
    assert.equal(url, RELEASE_API);
    assert.equal(result.url, 'https://github.com/rafaelreverberi/vencord-remastered-launcher/releases/download/v1.2.3/');
    assert.equal(result.version, '1.2.3');
    for (const tag_name of ['v1.2.3/../../evil', 'https://untrusted.example', 'v1.2.3-beta']) {
        await assert.rejects(latestRelease(async () => ({ ok: true, json: async () => ({ tag_name }) })), /Unsupported/);
    }
    await assert.rejects(latestRelease(async () => ({ ok: false })), /unavailable/);
});
