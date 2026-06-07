# Publishing Guide for `filedrop`

This document outlines the procedure for publishing new versions of `filedrop` to npm, as well as testing locally before publishing.

## Pre-publish Checks

Before running `npm publish`, ensure the following checks have passed:
1. **Test Suite Passes**: Run `npm test` and ensure all unit tests and integration tests pass successfully.
2. **Linting**: Run `npm run lint` and ensure there are no errors or warnings.
3. **Version Bumped**: Ensure the version in `package.json` is bumped correctly according to SemVer (see Semantic Versioning Policy below). You can use `npm version patch|minor|major` to do this automatically.
4. **Changelog Updated**: Ensure `CHANGELOG.md` is updated with the changes in the new version.

The `prepublishOnly` script in `package.json` will automatically run tests and linting before publishing, but it is good practice to run them manually first.

## How to Test Locally

Before publishing, it is highly recommended to test the package exactly as it would be installed by end-users via npm.

1. Create a tarball of the package:
   ```sh
   npm pack
   ```
   This will generate a file like `filedrop-1.0.0.tgz` in the root directory.

2. Install the tarball globally to verify it works as expected:
   ```sh
   npm install -g ./filedrop-1.0.0.tgz
   ```

3. Run `filedrop --version` and verify it works without issues.

## Semantic Versioning Policy

We follow [Semantic Versioning (SemVer)](https://semver.org/) strictly.

- **Patch (`1.0.x`)**: Bug fixes, documentation updates, or minor internal refactoring that does not affect user-facing behavior.
- **Minor (`1.x.0`)**: New options, features, or CLI flags. Backwards-compatible additions.
- **Major (`x.0.0`)**: Behavior changes, breaking changes in the API, changes to defaults (e.g., changing the default port range), or dropping support for an older Node.js version.

## How to Deprecate a Version

If a published version has a severe bug, security vulnerability, or is broken, you can deprecate it on npm to warn users without unpublishing it (which breaks builds relying on that specific version).

Run the following command:
```sh
npm deprecate filedrop@"<version>" "Message explaining why it is deprecated and what version to upgrade to."
```

Example:
```sh
npm deprecate filedrop@"1.0.1" "Critical bug in QR generation. Please upgrade to 1.0.2."
```
