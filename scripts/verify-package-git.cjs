// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');
exports.default = async context => {
    if (context.electronPlatformName !== 'darwin') return;
    const git = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources/app.asar.unpacked/node_modules/dugite/git/bin/git');
    const header = fs.readFileSync(git);
    const expected = { arm64: 0x0100000c, x64: 0x01000007 }[Arch[context.arch]];
    if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== expected) throw new Error(`Packaged Git architecture does not match ${Arch[context.arch]}`);
    console.log(`Packaged Git verified: ${Arch[context.arch]}`);
};
