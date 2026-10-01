// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(?:cjs|js)$/.test(p)) execFileSync(process.execPath, ['--check', p], { stdio: 'inherit' }); } }
for (const dir of ['app', 'scripts', 'test']) walk(path.resolve(dir));
const pkg = require('../package.json');
if (!pkg.build.asarUnpack.includes('node_modules/dugite/git/**/*')) throw new Error('Embedded Git must be unpacked');
console.log('JavaScript syntax and package configuration passed');
