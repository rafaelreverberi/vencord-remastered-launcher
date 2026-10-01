# Validation status — 1 October 2026

- Complete upstream Vencord Git history preserved in the real GitHub fork. Upstream
  audit baseline: `7f0c10cc29fd789f2f4828ae3dc947623e837920`.
- Upstream desktop standalone build, TypeScript, ESLint, stylelint, plugin metadata
  generator and web build passed locally. Fork CI and manual upstream sync passed.
- Launcher: 13 filesystem/security/Git/ASAR/recovery tests passed locally and on
  macOS, Windows and Ubuntu CI. All three systems successfully packaged the app.
  Final full-installer CI run: `36861308764`; release source tag: `v0.1.3`.
- Fresh GitHub clone integration passed ten scenarios with three persistent plugins,
  exact pnpm 11.9.0, cache reuse, source recreation, Safe Mode and a real compilation
  failure preserving the installed loader. Runs used system Node 22.22.3 and the
  packaged Electron 44.5.1 runtime with bundled Node 24.21.0 and bundled Git.
- Actual development and packaged Electron UI checks passed, including renderer
  sandbox isolation, Discord detection, plugin import dialog and Settings.
- Live macOS arm64 Discord 0.0.378 installation passed. The previous Vencord patch
  was backed up; the original Discord archive remains preserved. Discord rendered
  the Remastered page and normal Vencord settings.
- A harmless Git plugin from the launcher's `sample-plugin` branch was imported
  through the GUI, compiled and installed, appeared in Discord's normal plugin UI,
  and was enabled and disabled there. The in-client update action opened the launcher.
- The sample plugin was removed afterward. With user-granted macOS App Management
  permission, the ordinary LaunchServices-opened launcher successfully updated and
  patched Discord to `e4c300ecbec22a318990fab84e0dd5701cf830c5`, with zero third-party
  plugins in the final bundle. Discord restarted and displayed that exact revision.
- Public macOS ZIP download passed its GitHub SHA256 check. The packaged launcher
  successfully queried GitHub's release API and validated the published update
  metadata, displaying **Up to date**. This verifies discovery, not update installation.
- Closing the launcher exits its process; no daemon, login item or tray service is
  installed. No periodic update polling is used.

The three-plugin update/failure/recreation scenarios use real Vencord builds but a
Discord ASAR fixture. The live host test uses one Git plugin. CI packaging does not
establish live Windows/Linux Discord rendering, Flatpak permissions or every Discord
channel/layout. Existing normal settings are preserved; the test plugin's disabled
settings record and immutable source snapshot remain available for recovery.

Signing/notarization credentials are unavailable. Version 0.1.3 is an **unsigned
preview**, including macOS and Windows. macOS automatic self-update requires signed
distribution; use **Settings → Open Latest Release** for manual replacement, retaining
application data. Explicit updater controls and release metadata exist, but an actual
self-update between two published versions has not been verified. No claim of signed,
notarized or universal live-platform validation is made.

Local screenshots and machine-specific test evidence are intentionally ignored by
Git. Reproducible verification procedures are in [TESTING.md](TESTING.md).
