// SPDX-License-Identifier: GPL-3.0-or-later
const { exec } = require('dugite');
const { fs, path } = require('./files.cjs');
function gitUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter an HTTPS Git repository URL');
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !u.hostname || /[\s\\]/.test(value) || u.pathname === '/') throw new Error('Only HTTPS repository URLs without credentials are supported');
    return u.href;
}
class Git {
    constructor(cache, log = () => {}) { this.cache = cache; this.log = log; }
    async run(cwd, args) {
        await fs.mkdir(this.cache, { recursive: true });
        const config = path.join(this.cache, 'empty-git-config');
        await fs.writeFile(config, '');
        const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
            GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0', GIT_ALLOW_PROTOCOL: 'https', GIT_LFS_SKIP_SMUDGE: '1' };
        delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_CONFIG_PARAMETERS;
        const hooks = path.join(this.cache, 'empty-hooks');
        await fs.mkdir(hooks, { recursive: true });
        const result = await exec(['-c', `core.hooksPath=${hooks}`, '-c', 'credential.helper=', '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', ...args], cwd, { env, signal: AbortSignal.timeout(180000), maxBuffer: 8 * 1024 * 1024 });
        if (result.exitCode !== 0) throw new Error(`Git ${args[0]} failed: ${result.stderr.slice(-4000)}`);
        return result.stdout.trim();
    }
    async clone(url, dest, branch) {
        gitUrl(url);
        const args = ['clone', '--no-recurse-submodules', '--no-local'];
        if (branch) {
            if (!/^[\w./-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('Invalid branch');
            args.push('--branch', branch);
        }
        args.push('--', url, dest);
        await this.run(path.dirname(dest), args);
    }
}
module.exports = { Git, gitUrl };
