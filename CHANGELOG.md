# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-08
### Added
- Instant ephemeral HTTP server to serve a single file.
- Automatic termination immediately after one successful full-file transfer.
- mDNS broadcasting (`_http._tcp.local`) for easy discovery by name.
- High-contrast half-block QR code rendering in the terminal.
- Automatic detection of the most optimal local non-loopback network interface.
- Automatic port selection (8000-8999 range fallback).
- Configurable timeouts (`--timeout` default 300 seconds).
- Graceful shutdown and cancellation upon `SIGINT`.
- Cross-platform support across macOS, Linux, and Windows (with fallback ASCII modes).
