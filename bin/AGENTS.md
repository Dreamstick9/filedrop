# CLI Entry Point (bin) - Architecture & Agent Guidelines

This directory contains the executable binaries and CLI entry points for the application.

## 1. Shebang Requirements
- All executable files in this directory must begin with the correct Node.js shebang: `#!/usr/bin/env node`.

## 2. No Heavy Logic
- Do NOT place business logic, heavy computations, or complex implementations in this directory.
- This directory is strictly for CLI argument parsing and bootstrapping the application.

## 3. Delegation
- All actual execution and heavy lifting MUST be delegated to `src/index.js` or the appropriate core modules within the `src/` directory.
