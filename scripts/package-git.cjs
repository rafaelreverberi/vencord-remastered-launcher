// SPDX-License-Identifier: GPL-3.0-or-later
// electron-builder can package Intel macOS on an Apple Silicon host. npm's
// initial dugite install selects the host architecture, so select the target
// archive explicitly before copying dependencies. dugite checks its pinned SHA256.
const { execFileSync } = require('node:child_process');
const { Arch } = require('builder-util');
const path = require('node:path');
exports.default = async context => {
    const arch = Arch[context.arch];
    if (context.electronPlatformName !== process.platform) throw new Error('Package on the target operating system to bundle matching Git');
    execFileSync(process.execPath, [path.join(context.packager.projectDir, 'node_modules/dugite/script/download-git.js')], {
        env: { ...process.env, npm_config_arch: arch }, stdio: 'inherit', timeout: 180000
    });
};
