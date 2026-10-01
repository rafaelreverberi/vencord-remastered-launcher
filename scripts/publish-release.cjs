// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const version = require('../package.json').version;
const tag = `v${version}`;
const repo = 'rafaelreverberi/vencord-remastered-launcher';
const gh = args => execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const dir = path.resolve('release');
const isAsset = name => /\.(?:dmg|zip|exe|AppImage|deb|blockmap)$/.test(name) || /^latest(?:-mac|-linux)?\.yml$/.test(name);
const files = fs.readdirSync(dir).filter(isAsset);
if (files.length < 10) throw new Error('Incomplete platform release assets');
for (const name of files) {
    const normalized = name.replace(/\s/g, '-');
    if (normalized !== name) fs.renameSync(path.join(dir, name), path.join(dir, normalized));
}
try { gh(['release', 'view', tag, '--repo', repo]); }
catch { gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `Vencord Remastered Launcher ${version} — Unsigned Preview`, '--notes', 'Release validation and checksums are being prepared.']); }
const release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft']));
if (!release.isDraft) throw new Error('Refusing to overwrite an already published release');
gh(['release', 'upload', tag, '--repo', repo, '--clobber', ...fs.readdirSync(dir).filter(isAsset).map(name => path.join(dir, name))]);
console.log(`Uploaded ${files.length} assets to draft ${tag}`);
