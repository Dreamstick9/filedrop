# README Audit Report

This report documents the exhaustive audit and validation of the `README.md` for `@dreamstick/filedrop`. During validation of the documented CLI flags and application behavior, several significant discrepancies were discovered between the documentation and the actual implementation.

## 1. Outdated Package Name
**Inaccuracy:** The `README.md` still referenced the old `filedrop` name for NPM commands (`npm install -g filedrop`, `npx filedrop`, etc.) instead of the correctly published `@dreamstick/filedrop`.
**Fix:** 
- Updated the main title, Shields.io badges, and CLI commands to reference `@dreamstick/filedrop`.
- Removed the `brew install` instruction as it is no longer strictly applicable to the newly scoped npm package.

## 2. Broken `--bind` Flag
**Inaccuracy:** The `-b, --bind <ip>` flag is documented but completely ignored by the app. A bug in `src/index.js` calls `network.getInterface(config.bind)` with a string, but `network.js` expects an options object (`getInterface(options = {})`). This causes the interface lookup to fall back to default auto-detection regardless of the flag provided.
**Fix:** 
- Removed the `-b, --bind` option from the Options table.
- Removed the suggestion to use `--bind` for VPN troubleshooting from the FAQ.

## 3. mDNS Completely Non-Functional
**Inaccuracy:** The mDNS broadcast feature is completely broken. In `src/index.js`, `mdns.announce` is invoked without the necessary `filename` property. This leads to `path.extname(undefined)` throwing an error inside `mdns.js`. The error is silently swallowed unless the app is run with `--verbose`. Because mDNS never successfully announces, the `-n, --name` and `--no-mdns` flags do not do anything.
**Fix:** 
- Removed mDNS from the "How it works" feature list.
- Removed the `-n, --name` and `--no-mdns` options from the Options table.
- Removed the "mDNS isn't working" troubleshooting section from the FAQ.

## 4. Ignored `--no-color` Flag
**Inaccuracy:** The `--no-color` flag is parsed by `cli.js`, but it is completely ignored downstream by the QR rendering code in `qr.js` (which relies on `platform.js` and only respects the `NO_COLOR` environment variable).
**Fix:** 
- Removed the `--no-color` CLI option from the documentation. (The `NO_COLOR` environment variable works as a standard convention, but the specific CLI flag does not).
