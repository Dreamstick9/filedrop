# How to Record the README Demo

This guide explains how to record the terminal GIF for the `filedrop` README using `vhs` (or `asciinema`).

## Prerequisites

1. Install [vhs](https://github.com/charmbracelet/vhs) by Charm.
2. Have a sample image ready, e.g., `photo.jpg`.

## VHS Tape (`demo.tape`)

Create a `demo.tape` file with the following contents to automate the recording:

```tape
# Set terminal dimensions
Set Width 800
Set Height 500
Set Padding 20
Set Theme "Dracula"
Set FontSize 14

# Give it a filename
Output demo.gif

# Start recording
Type "filedrop ./photo.jpg"
Sleep 500ms
Enter

# Wait for the magic moment (port binding, mDNS, QR output)
Sleep 2s

# Simulate the user scanning the QR code and the file transferring
Sleep 3s

# The auto-terminate finishes and returns to the prompt
Sleep 1s
```

## Running the Recording

1. Save the file above as `demo.tape`.
2. Run `vhs demo.tape`.
3. Wait for the browser automation to render and trim `demo.gif`.

## Tips for a Great Demo

- **Size matters:** Ensure the terminal is wide enough (e.g. 80 columns) so the Magic Moment metadata box doesn't wrap awkwardly.
- **Color profile:** Use a high-contrast theme like Dracula to ensure the terminal background is clear. `vhs` handles this by default.
- **Trimming:** If there's too much dead time at the end or start of your GIF, adjust the `Sleep` values in the tape file to make it snappy and concise.

## Asciinema (Alternative)

If you prefer `asciinema`:

1. Run `asciinema rec demo.cast`.
2. Type `filedrop ./photo.jpg` and hit enter.
3. Simulate downloading the file from a secondary device.
4. Once it completes, type `exit` or hit `Ctrl+D`.
5. Use `agg demo.cast demo.gif` to render it to a GIF.
