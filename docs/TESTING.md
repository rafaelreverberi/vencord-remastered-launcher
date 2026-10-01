# Verification guide

`npm test` exercises actual temporary filesystem storage and bundled Git, validates
HTTPS/protocol restrictions, rejects unsafe paths, stages local copies independently
of their original folders, preserves settings, verifies ASAR headers and exact loader
paths, rolls back failed and interrupted patches, ensures no patch on compilation
failure, and tests numeric Windows version selection. No Discord fixture is represented
as a running Discord installation.

`npm run test:integration` clones the published Remastered repository from GitHub,
uses its real lockfile and exact pnpm, installs dependencies without lifecycle scripts,
builds three sample plugins, validates cache hits and update behavior, forces a real
esbuild unresolved dependency, checks that the active loader stays byte-identical,
excludes the broken plugin, builds Safe Mode and recreates source after deletion.
It checks settings/enabled states and original ASAR preservation. Only the Discord
patch target is a fixture. Network access and several hundred MB of storage are needed.

`npm run test:ui` opens the actual Electron application, verifies sandbox isolation,
checks detected installations, navigates plugin/settings pages and opens the import
dialog. Screenshots are saved in output/playwright. Set REMASTERED_APP_EXECUTABLE to
the packaged executable to run the same checks against the distributable.

For full packaged toolchain verification run scripts/integration.cjs with the bundled
executable and ELECTRON_RUN_AS_NODE=1. This exercises bundled Node rather than system
Node. The script removes its temporary workspace after success by default; set
REMASTERED_KEEP_TEST_DATA=1 to retain it for diagnosis.

Live host checklist: preserve any prior patch; quit Discord; open a fresh packaged
launcher; install; start Discord and inspect Remastered settings; import a trusted Git
plugin; rebuild; start Discord and check/enable the plugin; verify native update handoff;
remove/exclude test plugin and rebuild. Repeat on each OS/distribution. Windows/Linux
CI packaging does not by itself prove Discord rendering or system/Flatpak permissions.

Publisher signing needs actual developer credentials. Configure electron-builder mac
identity/hardened runtime/notarization and Windows signing before claiming a signed
release. Self-update metadata is produced by the release workflow; update-on-quit and
automatic downloads are disabled, and explicit Download/Install controls preserve data.
