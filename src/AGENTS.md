# Source Code (src) - Architecture & Agent Guidelines

This directory contains the core application logic. Strict architectural patterns must be adhered to.

## 1. Node.js & Module System
- Use **CommonJS** (`require` / `module.exports`). 
- Do NOT use ES modules (`import` / `export`).

## 2. Core Libraries
- **Express:** Use Express.js for all server logic and routing.
- **Enquirer:** Use `enquirer` for any interactive CLI prompts or "UI" components. Do not use other prompt libraries.
- **Archiver:** Adhere strictly to the `archiver` syntax for generating archives.

## 3. Strict Separation of Concerns
- Keep routing, business logic, and data access strictly separated.
- Controllers should only handle HTTP requests and responses. Business logic belongs in dedicated service modules.

## 4. No Front-End Frameworks
- Do NOT introduce React, Vue, Angular, or any other front-end framework. 
- Keep the application strictly adhering to the current architecture.
