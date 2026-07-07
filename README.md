# claude-statusline

Two pieces working together to make [GitHub Copilot CLI](https://github.com/github/copilot-cli)
more readable and visually distinct:

1. **`statusline.js`** — a custom status line (model, tokens, context %,
   peak/off-peak marker, cwd), rendered in vivid neon truecolor.
2. **`copilot-hc.js`** — a PTY-wrapping proxy that intercepts *all* of
   Copilot CLI's own output and rewrites its hardcoded, washed-out gray
   colors into a brighter, higher-contrast, neon color scheme in real
   time. This also affects the status line's colors, since Copilot CLI
   renders the statusLine command's stdout as part of its own output.

## Why two pieces?

Copilot CLI's built-in themes (`default`, `github`, `dim`, `high-contrast`,
`colorblind`) are baked into the `copilot.exe` binary as hardcoded 24-bit
truecolor (and some standard 16/256-color) ANSI codes. That means:
- No terminal color scheme change can fix low contrast — Copilot CLI's
  colors bypass the terminal's palette entirely.
- The status line's own `statusline.js` output is subject to the same
  problem: whatever colors it emits get displayed as-is, dulled or not.

So `copilot-hc.js` exists to patch this at the byte-stream level, and
`statusline.js` is written to already emit vivid colors so it looks good
standalone too.

## `statusline.js`

Adapted from [DFKHelper/claude-code-statusline](https://github.com/DFKHelper/claude-code-statusline)
(which targets Claude Code's stdin JSON schema). Shows, pipe-separated:
- Model name (neon magenta)
- Tokens used, e.g. `12K` (neon cyan)
- Context window % used — color-tiered green/yellow/orange/red
- `AC!!` warning when context remaining drops to <= 20%
- `PEAK` (yellow) or `🌙` (teal) marker with time remaining until the next
  Mon-Fri 5am-11am Pacific peak/off-peak transition
- Current working directory, last path segment (neon orange)

Reads Copilot CLI's statusline JSON payload from stdin defensively (field
names aren't pinned by a stable public schema yet — see comments in the
file). Force-exits after 3s in case stdin is never closed, to avoid
orphaned Node processes.

### Setup

1. Keep this folder at `C:\projects\claude-statusline` (or update the path
   below if you move it).
2. In `C:\Users\<you>\.copilot\settings.json`, add/merge:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node C:/projects/claude-statusline/statusline.js"
     }
   }
   ```

   (Use forward slashes even on Windows.)
3. Restart Copilot CLI / open a new session.

## `copilot-hc.js` (high-contrast/neon PTY wrapper)

Spawns the real `copilot.exe` inside a pseudo-console (via
[`node-pty`](https://www.npmjs.com/package/node-pty)) so it still detects a
TTY and emits color, then intercepts its output byte-for-byte and rewrites
every color-setting SGR sequence (truecolor `38;2;`/`48;2;`, 256-color
`38;5;`/`48;5;`, and standard 16-color `30-37`/`90-97`/`40-47`/`100-107`)
through a transform:

- **Grayish foreground colors** are blended sharply towards white (bright,
  legible labels/text), snapping to pure white once close enough.
- **Very dark grays** (the box-drawing border glyphs `▄▀╻╹┃` around the
  prompt input) get a light blend instead, so the border stays thin and
  visible rather than disappearing or turning into a thick bright line.
- **Grayish backgrounds** are left untouched (passed through unchanged).
  Copilot's overall canvas background is already forced to pure black via
  the separate OSC 11 rewrite below, so panel backgrounds (e.g. the prompt
  input box, `~20,27,34`) keep their natural, slightly-lighter tone — this
  is what makes the box's right edge read as a border, since that edge has
  no explicit border glyph and relies purely on background contrast against
  the canvas. Forcing panel backgrounds to black too made that border
  disappear.
- **Non-gray hues** (diff green/red, status line colors, etc.) get a
  saturation + lightness boost for a vivid neon look, capped so text stays
  readable and backgrounds stay dark enough for overlaid text.
- **Your own submitted prompt line** (`❯ <text>` in the feed) is detected
  by its distinct near-white RGB(240,246,252) and recolored to bright neon
  teal, so your messages visually stand out from Copilot's replies.
- **OSC 10/11** (the actual terminal default foreground/background, set
  independently of any per-cell color) are forced to white-on-black.

All the brightness/saturation constants live near the top of the file
(`BORDER_BLEND_MAX_AVG`, `BORDER_BLEND_FACTOR`, `TEXT_BLEND_FACTOR`,
`WHITE_SNAP_THRESHOLD`, and the `neonify()` saturation/lightness math) —
tune them there if you want a different intensity.

### Requirements

- Node.js on `PATH` (or a known absolute path — see Setup).
- [`node-pty`](https://www.npmjs.com/package/node-pty) installed in this
  folder (`npm install node-pty`). It has a native module with an install
  script (`node-gyp rebuild`); if npm blocks it, run
  `npm approve-scripts --allow-scripts-pending`, or otherwise permit
  `node-pty`'s install script to run.

### Setup

1. `cd C:\projects\claude-statusline && npm install` (installs `node-pty`;
   already done if `node_modules\node-pty` exists).
2. Edit `REAL_COPILOT` at the top of `copilot-hc.js` if your `copilot.exe`
   isn't at `C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\copilot.exe`
   (find it with `(Get-Command copilot).Source` in PowerShell, resolving
   any symlink with `Get-Item <path> | Select-Object -Expand Target`).
3. Add a `copilot` function to your PowerShell profile(s) so plain
   `copilot ...` transparently runs through the wrapper. **Both**
   PowerShell profiles need this if you use both shells:
   - Windows PowerShell 5.1: `C:\Users\<you>\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
   - PowerShell 7 (`pwsh`): `C:\Users\<you>\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`

   ```powershell
   function copilot {
       & "C:\Program Files\nodejs\node.exe" "C:\projects\claude-statusline\copilot-hc.js" @args
   }
   ```
4. Open a **brand new** terminal tab/window (existing tabs won't pick up
   profile changes) and run `copilot` as usual.

### Notes / limitations

- This is a wrapper around the official binary, not a patch to it — it
  doesn't touch or modify `copilot.exe` itself, so CLI auto-updates are
  unaffected.
- The wrapper only rewrites color-setting SGR/OSC sequences; it does not
  otherwise alter Copilot CLI's behavior, input handling, or output
  content.
- If Copilot CLI changes its internal color palette in a future version,
  the specific RGB values referenced here (e.g. the user-prompt-line
  detection color `240,246,252`) may need to be re-captured. To recapture,
  spawn `copilot.exe` directly under `node-pty` and dump the raw byte
  stream to a file (see the constants/comments in `copilot-hc.js` for the
  exact colors currently matched).

