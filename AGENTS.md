# Filedrop - Global Architecture & Agent Guidelines

Welcome to the `filedrop` repository. These rules act as strict guardrails for Jules AI and any other autonomous agents or developers touching this codebase.

## 1. General Project Rules
- Maintain consistency across the entire repository.
- Ensure all architectural decisions are documented.

## 2. Package Management
- **Tool:** `npm` MUST be used exclusively for all package management.
- Do NOT introduce `yarn`, `pnpm`, or `bun` or their respective lockfiles.

## 3. CI/CD & The Greptile/Jules Loop
- All changes must pass through the Greptile/Jules loop.
- Continuous integration checks must be respected and passed before making further changes.
- Do not bypass automated review and CI processes.

## 4. Global Testing Standards
- Tests are mandatory for all new features and bug fixes.
- Adhere to the established global testing standards in the repository.
- Write comprehensive unit and integration tests.
