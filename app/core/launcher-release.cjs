// SPDX-License-Identifier: GPL-3.0-or-later
const RELEASE_API = 'https://api.github.com/repos/rafaelreverberi/vencord-remastered-launcher/releases/latest';
const DOWNLOAD_ROOT = 'https://github.com/rafaelreverberi/vencord-remastered-launcher/releases/download/';
async function latestRelease(fetchImpl) {
    const response = await fetchImpl(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vencord-Remastered-Launcher' },
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Launcher release information is unavailable. Use Open Latest Release or try again later.');
    const info = await response.json();
    // Never accept an arbitrary asset URL or command from release data.
    if (info.draft || info.prerelease || !/^v\d+\.\d+\.\d+$/.test(info.tag_name)) throw new Error('Unsupported launcher release version');
    return { version: info.tag_name.slice(1), url: DOWNLOAD_ROOT + info.tag_name + '/' };
}
module.exports = { latestRelease, RELEASE_API };
