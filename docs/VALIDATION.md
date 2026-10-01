# Validation status — 1 October 2026

- Complete upstream Vencord Git history preserved in the real GitHub fork.
- Local upstream suite passed: desktop standalone build, TypeScript, ESLint, stylelint,
  plugin metadata generator and web build. Fork GitHub Actions are green.
- Launcher: 11 filesystem/security/Git/ASAR/recovery tests passed on macOS arm64.
- Fresh GitHub clone integration passed ten scenarios, including three stored plugins,
  exact pnpm 11.9.0, source recreation, Safe Mode and real compilation failure preserving
  the installed loader. System Node run used 22.22.3.
- Electron 44.5.1 includes Node 24.21.0. macOS arm64 application packaging succeeded.

Ongoing evidence will be added for packaged toolchain, real Electron UI, live Discord,
Git plugin import and release CI. Signing/notarization credentials are unavailable.
The initial release must be labeled unsigned. Windows/Linux live host installation,
Flatpak permissions, signed distribution and self-update across two released versions
are not established by the above checks.
