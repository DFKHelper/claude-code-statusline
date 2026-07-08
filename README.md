<div align="center">

<h1>claude-statusline</h1>

<p>A status bar that works for both <a href="https://claude.ai/code">Claude Code</a> and <a href="https://github.com/github/copilot-cli">GitHub Copilot CLI</a> — plus a high-contrast/neon output proxy for Copilot CLI specifically.</p>

<br />

<img src="preview.png" alt="Status bar showing: Sonnet 4.6 | 122K tokens | 61% context used | moon OFF-PK (16h 49m) | Projects directory" />

<br />
<br />

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Requires Node.js 18 or higher](https://img.shields.io/badge/Node.js-18%2B-43853d?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Supported platforms: macOS, Linux, Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-555?style=flat-square)](https://github.com/DFKHelper/claude-code-statusline)
[![Compatible with Claude Code and Copilot CLI](https://img.shields.io/badge/Claude%20Code%20%7C%20Copilot%20CLI-compatible-blueviolet?style=flat-square)](https://claude.ai/code)

</div>

---

## Two pieces

1. **`statusline.js`** — a single, dual-compatible status line script (model, tokens, context %, peak/off-peak marker, cwd), rendered in vivid neon truecolor. Works unmodified as the `statusLine` command for **either** Claude Code or GitHub Copilot CLI — it reads whichever tool's stdin JSON schema is actually present (see [How it works](#how-it-works)).
2. **`copilot-hc.js`** — a PTY-wrapping proxy that intercepts *all* of Copilot CLI's own output and rewrites its hardcoded, washed-out gray colors into a brighter, higher-contrast, neon color scheme in real time. Copilot-CLI-specific; not used with Claude Code. This also affects the status line's colors when running under Copilot CLI, since Copilot CLI renders the statusLine command's stdout as part of its own output.

## What the status line shows

| Segment | Meaning | Color |
|---------|---------|-------|
| `Sonnet 4.6 (h)` | Active model, plus reasoning effort in parens (`low`/`md`/`h`/`xh`/`MX` — Claude Code only, omitted on Copilot CLI) | Magenta |
| `122K` | Tokens used in the current context window | Green (< 250K) → yellow (< 1M) → red (≥ 1M) |
| `61%` | Context window used | Green → yellow → orange → red |
| `AC!!` | Auto-compact imminent (≤ 20% context remaining) | Yellow → orange → red |
| `PEAK` / `🌙` | API peak hours (5–11 AM Pacific, Mon–Fri) | Yellow (peak) / teal (off-peak) |
| `my-project` | Working directory, last path segment | Orange |

The peak/off-peak indicator includes a live countdown to the next state change.

---

## Setup: Claude Code

**Prerequisites:** Node.js (18+) and Claude Code.

1. Keep this folder wherever you like (this README uses `C:\projects\claude-statusline`; adjust the path below if you put it elsewhere). No install step — `statusline.js` has no dependencies of its own.
2. Add the `statusLine` key to `~/.claude/settings.json` (merge into the existing JSON object, don't replace it):

   **macOS / Linux**
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node /home/your-username/projects/claude-statusline/statusline.js"
     }
   }
   ```

   **Windows**
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node C:/projects/claude-statusline/statusline.js"
     }
   }
   ```
   (Use forward slashes even on Windows.)
3. Restart Claude Code (or start a new session). The status bar updates on every turn.

Claude Code's stdin JSON schema is stable and documented at [code.claude.com/docs/en/statusline](https://code.claude.com/docs/en/statusline): `context_window.total_input_tokens`, `context_window.remaining_percentage`, `model.display_name`, `cwd`. `example-input.json` in this repo is a sanitized real payload matching that schema, useful for building/testing against without a live session.

## Setup: GitHub Copilot CLI

**Prerequisites:** Node.js (18+) and GitHub Copilot CLI (`copilot.exe`).

1. Keep this folder at `C:\projects\claude-statusline` (or update the path below if you move it).
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

GitHub Copilot CLI's statusline payload isn't pinned by a stable public schema the way Claude Code's is — field names below were confirmed from `copilot help config` (`statusLine` section), EncodeTS/copilot-statusline (a real third-party Copilot CLI statusline implementation requiring `current_context_tokens` / `displayed_context_limit` under `context_window`), and blog.madkoo.net's defensive field-probing statusline script, which enumerates every field-name variant seen across Copilot CLI versions.

### `copilot-hc.js` (high-contrast/neon PTY wrapper, Copilot CLI only)

Spawns the real `copilot.exe` inside a pseudo-console (via [`node-pty`](https://www.npmjs.com/package/node-pty)) so it still detects a TTY and emits color, then intercepts its output byte-for-byte and rewrites every color-setting SGR sequence (truecolor `38;2;`/`48;2;`, 256-color `38;5;`/`48;5;`, and standard 16-color `30-37`/`90-97`/`40-47`/`100-107`) through a transform. This step is specific to Copilot CLI's own output and isn't used with Claude Code.

Copilot CLI's built-in themes (`default`, `github`, `dim`, `high-contrast`, `colorblind`) are baked into the `copilot.exe` binary as hardcoded 24-bit truecolor (and some standard 16/256-color) ANSI codes — no terminal color scheme change can fix low contrast, since Copilot CLI's colors bypass the terminal's palette entirely. `copilot-hc.js` patches this at the byte-stream level:

- **Grayish foreground colors** are blended sharply towards white (bright, legible labels/text), snapping to pure white once close enough.
- **Very dark grays** (the box-drawing border glyphs `▄▀╻╹┃` around the prompt input) get a light blend instead, so the border stays thin and visible rather than disappearing or turning into a thick bright line.
- **Grayish backgrounds** are left untouched (passed through unchanged). Copilot's overall canvas background is already forced to pure black via the separate OSC 11 rewrite below, so panel backgrounds (e.g. the prompt input box, `~20,27,34`) keep their natural, slightly-lighter tone — this is what makes the box's right edge read as a border, since that edge has no explicit border glyph and relies purely on background contrast against the canvas. Forcing panel backgrounds to black too made that border disappear.
- **Non-gray hues** (diff green/red, status line colors, etc.) get a saturation + lightness boost for a vivid neon look, capped so text stays readable and backgrounds stay dark enough for overlaid text.
- **Your own submitted prompt line** (`❯ <text>` in the feed) is detected by its distinct near-white RGB(240,246,252) and recolored to bright neon teal, so your messages visually stand out from Copilot's replies.
- **OSC 10/11** (the actual terminal default foreground/background, set independently of any per-cell color) are forced to white-on-black.

All the brightness/saturation constants live near the top of the file (`BORDER_BLEND_MAX_AVG`, `BORDER_BLEND_FACTOR`, `TEXT_BLEND_FACTOR`, `WHITE_SNAP_THRESHOLD`, and the `neonify()` saturation/lightness math) — tune them there if you want a different intensity.

#### Requirements

- Node.js on `PATH` (or a known absolute path — see Setup).
- [`node-pty`](https://www.npmjs.com/package/node-pty) installed in this folder (`npm install node-pty`). It has a native module with an install script (`node-gyp rebuild`); if npm blocks it, run `npm approve-scripts --allow-scripts-pending`, or otherwise permit `node-pty`'s install script to run.

#### Setup

1. `cd C:\projects\claude-statusline && npm install` (installs `node-pty`; already done if `node_modules\node-pty` exists).
2. Edit `REAL_COPILOT` at the top of `copilot-hc.js` if your `copilot.exe` isn't at `C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\copilot.exe` (find it with `(Get-Command copilot).Source` in PowerShell, resolving any symlink with `Get-Item <path> | Select-Object -Expand Target`).
3. Add a `copilot` function to your PowerShell profile(s) so plain `copilot ...` transparently runs through the wrapper. **Both** PowerShell profiles need this if you use both shells:
   - Windows PowerShell 5.1: `C:\Users\<you>\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
   - PowerShell 7 (`pwsh`): `C:\Users\<you>\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`

   ```powershell
   function copilot {
       & "C:\Program Files\nodejs\node.exe" "C:\projects\claude-statusline\copilot-hc.js" @args
   }
   ```
4. Open a **brand new** terminal tab/window (existing tabs won't pick up profile changes) and run `copilot` as usual.

#### Notes / limitations

- This is a wrapper around the official binary, not a patch to it — it doesn't touch or modify `copilot.exe` itself, so CLI auto-updates are unaffected.
- The wrapper only rewrites color-setting SGR/OSC sequences; it does not otherwise alter Copilot CLI's behavior, input handling, or output content.
- If Copilot CLI changes its internal color palette in a future version, the specific RGB values referenced here (e.g. the user-prompt-line detection color `240,246,252`) may need to be re-captured. To recapture, spawn `copilot.exe` directly under `node-pty` and dump the raw byte stream to a file (see the constants/comments in `copilot-hc.js` for the exact colors currently matched).

---

## Customization

`statusline.js` is a single self-contained Node.js file, no build step, no dependencies.

<details>
<summary><strong>Change peak hours or timezone</strong></summary>

Find the `isPeak` assignment and edit the hour bounds or the timezone string:

```js
// Change 5 and 11 to your preferred window, or swap the timezone
const isPeak = isWeekday && ptHour >= 5 && ptHour < 11;
// timeZone: 'America/Los_Angeles'  ← change this
```

</details>

<details>
<summary><strong>Adjust context color thresholds</strong></summary>

```js
if (used >= 95)      color = FG.red;
else if (used >= 80) color = FG.orange;
else if (used >= 60) color = FG.yellow;
else                 color = FG.green;
```

Change `95`, `80`, `60` to whatever breakpoints suit your workflow.

</details>

<details>
<summary><strong>Remove a segment</strong></summary>

Comment out the matching `parts.push(...)` call near the bottom of the file.

</details>

---

## Debugging

`statusline-debug.js` captures the raw JSON payload piped to the status line command and writes it to disk — handy when building or troubleshooting a status line against either tool.

1. Temporarily point the relevant `settings.json` at the debug script instead of `statusline.js`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node C:/projects/claude-statusline/statusline-debug.js"
     }
   }
   ```

2. Run Claude Code or Copilot CLI for one turn. The status bar shows `DEBUG: wrote ...`.

3. Open the output file (default: `~/statusline-capture.json`). Override the path with the `STATUSLINE_DEBUG_PATH` environment variable.

`example-input.json` in this repo shows a sanitized example of the Claude Code payload schema, so you can build against it without running a live session.

---

## How it works

Both Claude Code and Copilot CLI pipe a JSON payload to the status line command via stdin on every turn. The script parses context-window metrics and model info defensively — trying Claude Code's documented field names first, falling back to Copilot CLI's field-name variants — builds an ANSI-colored string, and writes it to stdout. The host tool renders that string in its status bar.

```
Claude Code / Copilot CLI  ──stdin──▶  node statusline.js  ──stdout──▶  status bar
                              JSON                             ANSI string
```

The 3-second `setTimeout` exits the process if stdin never closes — without it, Node processes stack up across long sessions.

---

## License

MIT
