# Vencord Remastered Launcher

An unofficial desktop manager for [Vencord Remastered](https://github.com/rafaelreverberi/vencord-remastered). It preserves third-party plugin source outside the Vencord checkout, builds plugins using Vencord's normal `src/userplugins` architecture, and patches Discord only after validating the build.

[Download launcher releases](https://github.com/rafaelreverberi/vencord-remastered-launcher/releases). Version 0.1.0 is an unsigned preview; signing/notarization and live Windows/Linux verification are tracked in [VALIDATION.md](docs/VALIDATION.md).

1. Open the launcher and select a detected Discord installation.
2. Quit Discord, then click **Patch / Install**. The launcher includes Node and Git and prepares the exact pnpm version requested by Vencord.
3. Start Discord. Normal Vencord plugins, themes and settings remain available.
4. Choose **Third Party Plugins → Add Third Party Plugin**. Use an HTTPS Git URL, optionally with a branch, or choose a local plugin folder. Local folders are copied.
5. Read the trust warning. Importing rebuilds and patches automatically when a Discord target is selected. New plugins start disabled.
6. Enable plugins using the regular Vencord plugin settings in Discord, or close Discord and use the launcher's Enable button.
7. Use **Update** for Remastered, **Update / Update All** for plugins, and **Apply Changes** after exclusions/removals. **Repair** verifies and recreates damaged source while preserving the previous checkout and all canonical plugins.

Use **Build in Safe Mode** if a plugin stops compiling or breaks Discord. This creates a bundle without third-party plugins and keeps their source and settings. **Exclude from Build** is different from Disable: disabling is a normal Vencord runtime setting, while exclusion lets compilation skip an incompatible plugin. Apply Changes restores the selected plugin set after Safe Mode.

The Remastered settings page inside Discord checks for updates on opening and launches this application through `vencord-remastered://update`. It never installs a generic Vencord bundle over custom plugins. No tray service, login item or daemon is installed; closing the launcher exits it.

## Data and recovery

Electron's platform userData location, using application name **Vencord Remastered**, contains `plugins/`, `plugin-metadata.json`, `source/`, `builds/`, `cache/`, `state.json` and `loader.cjs`. **Settings → Open Folder** shows the actual path. Vencord's existing settings/themes/quick CSS remain in the normal Vencord data folder; choose an existing custom data folder in Settings if necessary.

Canonical plugins use immutable snapshots. The source checkout and generated userplugins are replaceable. Failed builds never replace the installed ASAR or loader. Interrupted patch transactions restore the previous patch on next open. Old builds and quarantined source are retained for recovery; they can consume disk space. Do not remove the active build named in state.json.

On macOS, grant **Privacy & Security → App Management → Vencord Remastered Launcher** when prompted. **Settings → Open Permission Settings** opens this pane.

Read-only system installations require appropriate filesystem permissions. The launcher reports permission failures without silently elevating itself. Quit Discord before patching; the launcher never kills Discord. Flatpak uses a per-application filesystem grant, with no arbitrary shell commands.

## Plugin compatibility and trust

Third-party plugins are not reviewed by Vencord Remastered. Only install plugins from sources you trust. They execute JavaScript/TypeScript, and native.ts can access Node and your computer. Disabling a plugin controls its normal runtime lifecycle; it does not sandbox its module initialization. Use exclusion or Safe Mode to omit untrusted/broken code entirely.

Choose a repository/folder containing an individual Vencord plugin (one unambiguous nested plugin is also detected) with index.ts/index.tsx or one top-level TypeScript entrypoint, using a literal `definePlugin({ name: "Name", … })`. Plugin names must be unique. Required third-party plugins, symlinks, special files, paths escaping staging and oversized imports are rejected. Git submodules and plugin package scripts are never run. Random npm dependencies are not installed; dependencies must be provided by the Vencord workspace. A missing import produces a visible build diagnostic, with recovery actions.

Launcher updates are separate from Remastered updates. For this unsigned preview, use **Settings → Open Latest Release** and replace the app manually; plugin storage and settings stay in the application data folders. Signed macOS automatic updates and an end-to-end update between two releases remain unverified.

## Development

```
npm ci
npm run check
npm test
npm start
npm run test:integration
npm run test:ui
npm run package
```

Launcher dependencies are separate from upstream Vencord. Electron supplies Node 24.21.0 in this release; future Vencord requirements are checked from package.json before each build. pnpm packages are acquired from npm with SHA512 verification. Git is bundled through dugite, including its distribution licenses. No system Node/pnpm/Git is needed in packaged normal use.

[Architecture](https://github.com/rafaelreverberi/vencord-remastered/blob/main/docs/REMASTERED_ARCHITECTURE.md) · [Testing](docs/TESTING.md) · [Release evidence](docs/VALIDATION.md).

Not affiliated with official Vencord or Discord. Original Vencord and Vencord Installer Copyright Vendicated and contributors; see NOTICE. GPL-3.0-or-later, with corresponding source available in both linked repositories. Preserve licenses/credits when redistributing modifications.
