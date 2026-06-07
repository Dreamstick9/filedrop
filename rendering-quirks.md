# QR Terminal Rendering Quirks and Compatibility Note

In testing and implementing the high-contrast ANSI block rendering strategy for the QR code, several nuances regarding terminal emulators and their fonts were noted:

## Tested Terminals

1. **iTerm2 (macOS)**
   - Excellent compatibility. The half-block characters (▄ and ▀) render without any visual tearing or spacing issues.
   - The quiet zone displays correctly as pure white background.
   - Recommended.

2. **Apple Terminal.app (macOS)**
   - Good compatibility, though depending on the chosen font (e.g. SF Mono vs Menlo), slight vertical hairline gaps may appear between lines. This typically does not impact scanner reliability, but looks slightly less "solid" than iTerm2.

3. **GNOME Terminal / standard VTE-based terminals (Linux)**
   - Perfect block character rendering. The use of strict background and foreground colors prevents any theme-based overrides from ruining the contrast.

4. **Windows Terminal (Windows 10/11)**
   - Very good. Modern Windows Terminal supports full Unicode and ANSI escapes out of the box. Legacy cmd.exe without virtual terminal processing is handled via the `NO_COLOR` and ASCII-fallback paths.

## Known Rendering Quirks

1. **Line Height Adjustments:**
   Some users tweak their terminal profile to increase line spacing/height for better code readability. Since the half-block strategy assumes a character is exactly twice as tall as it is wide (aspect ratio of 1:2), extra line-height will stretch the QR code vertically, breaking the square shape of the modules. Modern QR scanners are fairly robust against aspect ratio distortion up to about 20%, but extreme line-height padding might break scanning.

2. **Color Inversion / Dark Mode Overrides:**
   Certain experimental terminal themes try to dynamically invert colors. The `renderQR` implementation forces hard-coded black (`\x1b[40m` / `\x1b[30m`) and white (`\x1b[47m` / `\x1b[37m`). As long as the terminal respects strict ANSI colors rather than overriding them with low-contrast theme variations, it works flawlessly.

3. **Dumb Terminals / CI:**
   If `NO_COLOR` is set or the terminal is not a TTY, the tool automatically gracefully degrades to a pure ASCII hash-based (`##` and `  `) representation or suppresses the QR output entirely to avoid spamming CI logs with unreadable garbage.

## Best Practices
Always test with a standard scanner (e.g. iOS Camera app) under standard lighting. If a terminal fails to scan, resizing the window to force a redraw or verifying the line-height settings usually resolves it.
