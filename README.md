<div align="center">

<h1>claude-code-statusline</h1>

<p>A status bar for <a href="https://claude.ai/code">Claude Code</a> that shows what you actually need mid-session.</p>

<br />

<img src="preview.png" alt="Status line: Sonnet 4.6 | 100% | AC!! | 🌙 OFF-PK (17h 39m) | Projects" />

<br />
<br />

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853d?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-555?style=flat-square)](https://github.com/DFKHelper/claude-code-statusline)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet?style=flat-square)](https://claude.ai/code)

</div>

---

## What it shows

| Segment | Meaning | Color |
|---------|---------|-------|
| `Sonnet 4.6` | Active model | Magenta |
| `84K` | Total input tokens this session | Cyan |
| `42%` | Context window used | Green → yellow → orange → red |
| `AC!!` | Auto-compact imminent (≤ 20% remaining) | Yellow → orange → red |
| `🌙 OFF-PK` / `PEAK` | Anthropic API peak hours (5–11 AM Pacific, Mon–Fri) | Green (off-peak) / yellow (peak) |
| `my-project` | Working directory (last path segment) | Orange |

The peak/off-peak indicator includes a live countdown to the next state change — useful if you're deciding whether to start a heavy session now or wait.

---

## Installation

**Prerequisites:** Node.js (18+) and Claude Code.

**1.** Copy `statusline.js` to `~/.claude/`:

```bash
curl -o ~/.claude/statusline.js \
  https://raw.githubusercontent.com/DFKHelper/claude-code-statusline/main/statusline.js
```

**2.** Add the `statusLine` key to `~/.claude/settings.json`:

<details>
<summary><strong>macOS / Linux</strong></summary>

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /home/your-username/.claude/statusline.js"
  }
}
```

</details>

<details>
<summary><strong>Windows</strong></summary>

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/your-username/.claude/statusline.js"
  }
}
```

</details>

**3.** Restart Claude Code. The status bar updates on every turn.

---

## Customization

The script is a single self-contained Node.js file (~100 lines). No build step, no dependencies.

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
if (used >= 95)      color = '\x1b[1;31m';       // red
else if (used >= 80) color = '\x1b[38;5;208m';   // orange
else if (used >= 60) color = '\x1b[1;33m';        // yellow
else                 color = '\x1b[0;32m';         // green
```

Change `95`, `80`, `60` to whatever breakpoints suit your workflow.

</details>

<details>
<summary><strong>Remove a segment</strong></summary>

Comment out the matching `parts.push(...)` call near the bottom of the file.

</details>

---

## Debugging

`statusline-debug.js` captures the raw JSON payload Claude Code pipes to the command and writes it to disk — handy when building your own status line.

**1.** Temporarily point `settings.json` at the debug script:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /home/your-username/.claude/statusline-debug.js"
  }
}
```

**2.** Run Claude Code for one turn. The status bar shows `DEBUG: wrote ...`.

**3.** Open the output file (default: `~/statusline-capture.json`). Override the path with `STATUSLINE_DEBUG_PATH`.

`example-input.json` in this repo shows a sanitized example of the full payload schema, so you can build against it without running a live session.

---

## How it works

Claude Code pipes a JSON payload to the status line command via stdin on every turn. The script parses the context window metrics and model info, builds an ANSI-colored string, and writes it to stdout. Claude Code renders that string in the status bar.

```
Claude Code  ──stdin──▶  node statusline.js  ──stdout──▶  status bar
               JSON                              ANSI string
```

The 3-second `setTimeout` exits the process if stdin never closes — without it, Node processes stack up across long sessions.

---

## License

MIT
