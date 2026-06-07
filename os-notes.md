# mDNS OS-Specific Testing Notes

When testing the `mdns.js` module, the integration and testing agents must account for the following OS-specific behaviors implemented in this module:

1. **Windows (win32):**
   - The mDNS implementation imposes a strict 1-second timeout for registration. If `multicast-dns` fails to bind, throws an error, or does not complete registration within 1 second, the module will **silently fail** and disable mDNS, logging a debug message instead of crashing.
   - Tests running on Windows CI runners might naturally hit this timeout or permission error. Do not assert that mDNS must be available on Windows; instead, expect `mdnsAvailable: false` gracefully.

2. **macOS & Linux:**
   - Registration failures will emit a `console.warn` (unless suppressed by a test framework) and gracefully return `mdnsAvailable: false`. No process crash occurs.
   - Probing is implemented across all OSes: if the mock testing environment accidentally spins up two mDNS instances with the same service name, the second will auto-increment its service name (e.g., `filedrop-2`). Ensure the testing agent accounts for dynamic suffixing if it creates conflicts.

3. **Docker/CI Environments:**
   - Most Docker environments do not route multicast traffic by default. The test agent should expect mDNS registration to fail gracefully with `mdnsAvailable: false` on headless/Dockerized CI. Integration tests strictly checking mDNS should run on host network interfaces or mock the module using the provided test helper.
