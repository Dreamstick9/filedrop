# Contributing to Filedrop

First off, thank you for considering contributing to **Filedrop**! 🎉

We welcome contributions of all kinds, including:

- 🐛 Bug fixes
- ✨ New features
- 📖 Documentation improvements
- 🎨 UI/UX enhancements
- ⚡ Performance optimizations
- 🔒 Security improvements
- 🧪 Test improvements

Every contribution helps make the project better for everyone.

---

# Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Prerequisites](#prerequisites)
- [Project Setup](#project-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Branch Naming Convention](#branch-naming-convention)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Reporting Issues](#reporting-issues)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Pull Request Checklist](#pull-request-checklist)
- [Documentation Contributions](#documentation-contributions)
- [Code of Conduct](#code-of-conduct)
- [Need Help?](#need-help)

---

# Code of Conduct

Please be respectful and welcoming to all contributors.

If this repository contains a dedicated **Code of Conduct**, please read and follow it before contributing.

We expect contributors to:

- Be respectful
- Be constructive
- Welcome new contributors
- Give helpful code reviews
- Keep discussions professional

---

# Getting Started

## 1. Fork the Repository

Click the **Fork** button on GitHub.

Then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/filedrop.git
```

Move into the project:

```bash
cd filedrop
```

---

## 2. Add the Original Repository

```bash
git remote add upstream https://github.com/Dreamstick9/filedrop.git
```

Verify:

```bash
git remote -v
```

---

# Prerequisites

Before contributing, make sure you have:

- Node.js (Latest LTS recommended)
- npm
- Git
- A GitHub account

Verify installation:

```bash
node -v
npm -v
git --version
```

---

# Project Setup

Install dependencies:

```bash
npm install
```

If the project requires additional setup, follow the instructions in the README.

---

# Project Structure

A simplified overview:

```
filedrop/
│
├── bin/                 # CLI entry point
├── docs/                # Documentation
├── Formula/             # Homebrew formula
├── .github/             # GitHub workflows
├── README.md
├── package.json
├── LICENSE
└── ...
```

Please keep new files organized within the appropriate directories.

---

# Development Workflow

1. Fork the repository.
2. Create a new branch.
3. Make your changes.
4. Test your changes.
5. Commit using a meaningful commit message.
6. Push your branch.
7. Open a Pull Request.

---

# Branch Naming Convention

Use descriptive branch names.

Examples:

```
feature/add-dark-mode
feature/improve-cli-output
fix/download-timeout
fix/security-warning
docs/update-readme
docs/add-contributing-guide
refactor/server-cleanup
test/add-cli-tests
```

Avoid names like:

```
new
test
update
abc
branch1
```

---

# Commit Message Guidelines

Use clear and descriptive commit messages.

Recommended format:

```
type(scope): short description
```

Examples:

```
feat(cli): add clipboard sharing support

fix(server): prevent duplicate downloads

docs: improve installation guide

refactor: simplify encryption module

test: add download unit tests
```

Common commit types:

- feat
- fix
- docs
- style
- refactor
- perf
- test
- chore

---

# Coding Standards

Please follow these best practices:

- Write clean, readable code.
- Keep functions small and focused.
- Use meaningful variable names.
- Remove unused code.
- Avoid unnecessary dependencies.
- Prefer reusable code over duplication.
- Add comments only where necessary.
- Follow existing project conventions.

Before submitting:

- Format your code
- Remove debug statements
- Check for linting errors
- Ensure the project builds successfully

---

# Testing

Before opening a Pull Request:

- Verify your changes work correctly.
- Ensure existing functionality is not broken.
- Run available tests.

`npm test` runs both the unit suite (`src/*.test.js`) and the integration
suite (`test/integration/*.test.js`). The integration tests spawn the real CLI
and exercise the full transfer path.

Example:

```bash
npm test              # unit + integration
npm run test:unit     # unit tests only
npm run test:integration  # integration tests only
```

If there are no automated tests for your changes, describe how you manually verified them in your Pull Request.

---

# Reporting Issues

Before opening an issue:

- Search existing issues first.
- Ensure it hasn't already been reported.
- Include enough information to reproduce the problem.

A good issue report includes:

- Operating system
- Node.js version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Error logs

---

# Submitting Pull Requests

Before submitting a PR:

- Sync with the latest upstream changes.
- Resolve merge conflicts.
- Keep Pull Requests focused.
- Avoid unrelated changes.
- Update documentation if necessary.

PRs should include:

- What changed
- Why it changed
- Screenshots (if UI changes)
- Testing performed

---

# Pull Request Checklist

Before submitting, confirm:

- [ ] My code follows the project's coding style.
- [ ] I tested my changes.
- [ ] I updated documentation where needed.
- [ ] My branch is up to date.
- [ ] There are no merge conflicts.
- [ ] My commit messages are meaningful.
- [ ] I have not introduced unnecessary dependencies.
- [ ] My changes solve the intended issue.

---

# Documentation Contributions

Documentation improvements are always appreciated.

Examples include:

- README improvements
- Better installation guides
- CLI usage examples
- API documentation
- Typo fixes
- Code examples
- Tutorials

---

# Need Help?

If you have questions before contributing:

- Open a GitHub Discussion (if enabled).
- Open an issue for clarification.
- Ask respectfully in the project's community channels.

We are happy to help new contributors get started.

---

## Thank You ❤️

Thank you for taking the time to contribute to **Filedrop**.

Your contributions—whether they're bug fixes, new features, documentation improvements, or suggestions—help make this project better for everyone.

Happy Coding! 🚀