#!/usr/bin/env node
// High-contrast / neon proxy for GitHub Copilot CLI. Part of the
// claude-statusline project alongside statusline.js -- see README.md for
// full setup instructions covering both pieces.
//
// Copilot CLI's TUI emits explicit 24-bit truecolor (and some standard
// 16/256-color) ANSI SGR codes for its text, borders, and status line
// (e.g. "\x1b[38;2;145;152;161m" for secondary/dim labels). These are
// hardcoded in the copilot.exe binary and bypass the terminal's color
// scheme entirely -- so no terminal theme change can fix low contrast or
// dull colors. This wrapper spawns the real copilot.exe inside a
// pseudo-console (so it still detects a TTY and emits color), intercepts
// its output stream byte-for-byte, and rewrites every color-setting SGR
// sequence through transformColor() before forwarding to the real
// terminal:
//   - Grayish colors are brightened (foreground) or darkened (background),
//     while prompt-border glyphs receive their own subdued explicit color.
//   - Non-gray hues (diffs, status line colors, etc.) get a saturation +
//     lightness boost for a vivid "neon" look.
//   - The user's own submitted prompt line gets recolored to bright teal.
//   - OSC 10/11 (default foreground/background) sequences are forced to
//     white-on-black.
// Because the statusLine command's stdout is rendered as part of
// copilot.exe's own output, statusline.js's colors flow through this same
// pipeline automatically when copilot is launched via this wrapper.

const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const os = require('os');

const NPM_COPILOT = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@github', 'copilot', 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe')
  : '';
const WINGET_COPILOT = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'copilot.exe')
  : '';

const REAL_COPILOT = (WINGET_COPILOT && fs.existsSync(WINGET_COPILOT))
  ? WINGET_COPILOT
  : NPM_COPILOT;

// How close R/G/B must be to each other to be treated as "grayish" (as
// opposed to a real hue like the diff red/green) rather than a color with
// a hue to push towards neon.
const GRAY_TOLERANCE = 30;
const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
const clamp01 = v => Math.max(0, Math.min(1, v));

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

// Grayscale foreground text: push dim grays and off-whites much brighter,
// snapping anything already near-white to pure white (255,255,255) so
// "white" text reads as truly white, not off-white/light-gray. Prompt border
// glyphs are styled separately in rewrite(), so this applies to all text.
// copilot.exe draws the box-drawing border glyphs (▄▀╻╹┃) around the
// prompt input in two different dim grays: a very dark tone (~20,27,34)
// for the horizontal ▄▀ lines, and a lighter mid-gray (~129,139,152) for
// the vertical ┃ characters. rewrite() gives those glyphs a single subtle
// border color so the whole border reads as one thin, consistent line.
const DARK_BACKGROUND_MAX_AVG = 150;
const TEXT_BLEND_FACTOR = 0.78;
const WHITE_SNAP_THRESHOLD = 245;
const LIGHT_BACKGROUND_DARKEN_FACTOR = 0.15;
const PROMPT_BORDER_COLOR = '\x1b[38;2;72;77;83m';
const HIGH_CONTRAST_FOREGROUND_PARAMS = '38;2;255;255;255';
const DEFAULT_FOREGROUND = `\x1b[${HIGH_CONTRAST_FOREGROUND_PARAMS}m`;
const PROMPT_BORDER_GLYPHS = new Set(['▄', '▀', '╻', '╹', '┃']);

function boostGrayForeground(avg, r, g, b) {
  const blended = v => v + (255 - v) * TEXT_BLEND_FACTOR;
  let [nr, ng, nb] = [clamp255(blended(r)), clamp255(blended(g)), clamp255(blended(b))];
  const newAvg = (nr + ng + nb) / 3;
  if (newAvg >= WHITE_SNAP_THRESHOLD) return [255, 255, 255];
  return [nr, ng, nb];
}

// Grayscale background: leave dark panel backgrounds (e.g. the prompt
// input box, ~20,27,34) untouched. copilot.exe's overall canvas
// background is already forced to pure black via the separate OSC 11
// rewrite below, so these slightly-lighter panel tones are what provide
// visible contrast between UI panels and the canvas -- including the
// prompt input box's right edge, which (unlike the left) has no explicit
// border character and relies entirely on this background contrast to
// read as a border. Forcing them to pure black here made that contrast
// (and the right border) disappear. Only very light gray backgrounds
// (e.g. a text selection highlight) are left alone as before; genuinely
// dark ones are now passed through unchanged rather than blackened.
function boostGrayBackground(avg, r, g, b) {
  // Keep dark panel backgrounds untouched.
  // Darken any light or near-white background so text never collides with
  // a white canvas, preventing unreadable white-on-white text.
  if (avg <= DARK_BACKGROUND_MAX_AVG) return null;
  const darken = v => v * LIGHT_BACKGROUND_DARKEN_FACTOR;
  return [clamp255(darken(r)), clamp255(darken(g)), clamp255(darken(b))];
}

// Non-gray hue: push saturation and brightness up for a "neon" look.
// Backgrounds are kept darker so overlaid text stays legible.
function neonify(r, g, b, isBackground) {
  let [h, s, l] = rgbToHsl(r, g, b);
  s = clamp01(s * 1.8 + 0.25);
  if (isBackground) {
    l = Math.min(l, 0.36);
  } else {
    l = clamp01(Math.max(l * 1.25, 0.62));
    l = Math.min(l, 0.8);
  }
  return hslToRgb(h, s, l);
}

// The user's own submitted prompt line (the "❯ <text>" echo in the feed)
// is rendered by copilot.exe in a distinct near-white RGB(240,246,252),
// used nowhere else in the UI. Recolor it to a bright teal so the user's
// own messages stand out from the assistant's replies and labels.
const USER_PROMPT_COLOR = [240, 246, 252];
const USER_PROMPT_REPLACEMENT = [0, 255, 213]; // bright/vivid neon teal
const USER_PROMPT_TOLERANCE = 6;

function isUserPromptColor(r, g, b) {
  return Math.abs(r - USER_PROMPT_COLOR[0]) <= USER_PROMPT_TOLERANCE &&
    Math.abs(g - USER_PROMPT_COLOR[1]) <= USER_PROMPT_TOLERANCE &&
    Math.abs(b - USER_PROMPT_COLOR[2]) <= USER_PROMPT_TOLERANCE;
}

function transformColor(layer, r, g, b) {
  const isBackground = layer === '48';
  if (!isBackground && isUserPromptColor(r, g, b)) return USER_PROMPT_REPLACEMENT;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  if (max - min <= GRAY_TOLERANCE) {
    return isBackground ? boostGrayBackground(avg, r, g, b) : boostGrayForeground(avg, r, g, b);
  }
  return neonify(r, g, b, isBackground);
}

// The status line and a few other spots (e.g. "PEAK"/"OFF-PK") use the
// standard 16-color and 256-color SGR codes instead of truecolor, so they
// need to be converted to RGB before the same transform pipeline can
// apply the neon/whitening treatment, then re-emitted as truecolor.
const ANSI16_RGB = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
  [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

function xterm256ToRgb(n) {
  if (n < 16) return ANSI16_RGB[n];
  if (n <= 231) {
    const levels = [0, 95, 135, 175, 215, 255];
    const idx = n - 16;
    const r = levels[Math.floor(idx / 36) % 6];
    const g = levels[Math.floor(idx / 6) % 6];
    const b = levels[idx % 6];
    return [r, g, b];
  }
  const gray = 8 + (n - 232) * 10;
  return [gray, gray, gray];
}

// Rewrites a full SGR parameter list (the digits between "\x1b[" and "m"),
// converting any color-setting parameter (truecolor, 256-color, or
// standard 16-color) to a transformed truecolor equivalent, and leaving
// non-color parameters (bold, reset, etc.) untouched.
function transformSgrParams(paramsStr) {
  if (paramsStr === '') return `0;${HIGH_CONTRAST_FOREGROUND_PARAMS}`; // bare "\x1b[m" == reset
  const parts = paramsStr.split(';').map(Number);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === 0) {
      out.push(p, 38, 2, 255, 255, 255);
    } else if (p === 39) {
      out.push(38, 2, 255, 255, 255);
    } else if ((p === 38 || p === 48) && parts[i + 1] === 2) {
      const layer = String(p);
      const [r, g, b] = [parts[i + 2], parts[i + 3], parts[i + 4]];
      const result = transformColor(layer, r, g, b) || [r, g, b];
      out.push(p, 2, result[0], result[1], result[2]);
      i += 4;
    } else if ((p === 38 || p === 48) && parts[i + 1] === 5) {
      const layer = String(p);
      const [r, g, b] = xterm256ToRgb(parts[i + 2]);
      const result = transformColor(layer, r, g, b) || [r, g, b];
      out.push(p, 2, result[0], result[1], result[2]);
      i += 2;
    } else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) {
      const idx = p >= 90 ? p - 90 + 8 : p - 30;
      const [r, g, b] = ANSI16_RGB[idx];
      const result = transformColor('38', r, g, b) || [r, g, b];
      out.push(38, 2, result[0], result[1], result[2]);
    } else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) {
      const idx = p >= 100 ? p - 100 + 8 : p - 40;
      const [r, g, b] = ANSI16_RGB[idx];
      const result = transformColor('48', r, g, b) || [r, g, b];
      out.push(48, 2, result[0], result[1], result[2]);
    } else {
      out.push(p);
    }
  }
  return out.join(';');
}

function createRewriteState() {
  return { foreground: DEFAULT_FOREGROUND };
}

// Keep the foreground that was active before a prompt border glyph. A bare
// foreground reset (ESC[39m) means "use the terminal default"; it does not
// restore the previous SGR color, and Copilot's default may be a dim gray.
// transformSgrParams also makes resets explicitly white so uncolored text
// stays high contrast even if the terminal ignores OSC 10.
function updateForegroundState(state, paramsStr) {
  const parts = paramsStr === '' ? [0] : paramsStr.split(';').map(Number);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === 0 || p === 39) {
      state.foreground = DEFAULT_FOREGROUND;
    } else if (p === 38 && parts[i + 1] === 2) {
      const [r, g, b] = parts.slice(i + 2, i + 5);
      state.foreground = `\x1b[38;2;${r};${g};${b}m`;
      i += 4;
    } else if (p === 38 && parts[i + 1] === 5) {
      state.foreground = `\x1b[38;5;${parts[i + 2]}m`;
      i += 2;
    }
  }
}

function rewriteText(text, state) {
  let out = '';
  for (const char of text) {
    if (PROMPT_BORDER_GLYPHS.has(char)) {
      out += PROMPT_BORDER_COLOR + char + state.foreground;
    } else {
      out += char;
    }
  }
  return out;
}

// Rewrites truecolor, 256-color, and standard 16-color SGR sequences:
// grays get brightened towards pure white (foreground) or pure black
// (background), and actual hues get a neon saturation/brightness boost.
function rewrite(chunk, state = createRewriteState()) {
  const transformed = chunk.replace(/\x1b\[([0-9;]*)m/g, (full, params) => `\x1b[${transformSgrParams(params)}m`);
  const sgr = /\x1b\[([0-9;]*)m/g;
  let out = '';
  let cursor = 0;
  let match;
  while ((match = sgr.exec(transformed)) !== null) {
    out += rewriteText(transformed.slice(cursor, match.index), state);
    out += match[0];
    updateForegroundState(state, match[1]);
    cursor = sgr.lastIndex;
  }
  return out + rewriteText(transformed.slice(cursor), state);
}

// Copilot also sets the actual terminal default background/foreground via
// OSC 10 (foreground) / OSC 11 (background) escape sequences (e.g.
// "\x1b]11;#0D1117\x1b\\"), independent of any per-cell SGR color and of
// the terminal's own color scheme. Force the background to pure black and
// the foreground to pure white so the base canvas matches the rest of the
// high-contrast treatment.
function rewriteOsc(chunk) {
  return chunk
    .replace(/\x1b\]11;(?!\?)[^\x07\x1b]*(\x07|\x1b\\)/g, '\x1b]11;#000000$1')
    .replace(/\x1b\]10;(?!\?)[^\x07\x1b]*(\x07|\x1b\\)/g, '\x1b]10;#FFFFFF$1');
}

if (require.main === module) {
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;

  let child = null;
  let tail = '';
  const MAX_SEQ_LEN = 40;
  let rewriteState = createRewriteState();

  function startChild(args, cwd) {
    tail = '';
    rewriteState = createRewriteState();

    child = pty.spawn(REAL_COPILOT, args, {
      name: process.env.TERM || 'xterm-256color',
      cols: process.stdout.columns || cols,
      rows: process.stdout.rows || rows,
      cwd: cwd || process.cwd(),
      env: {
        ...process.env,
        COPILOT_SUPERVISED: '1',
        COPILOT_LOADER_PID: String(process.pid),
        COPILOT_AUTO_UPDATE: process.env.COPILOT_AUTO_UPDATE ?? 'false',
      },
    });

    child.onData(data => {
      // Intercept and auto-respond to terminal color/theme queries from Copilot CLI
      // so it never blocks waiting for the outer terminal or falls back to native OS light theme.
      if (data.includes('\x1b[?996n')) {
        child.write('\x1b[?997;1n');
      }
      if (/\x1b\]11;\?(\x07|\x1b\\)/.test(data)) {
        child.write('\x1b]11;rgb:0000/0000/0000\x1b\\');
      }
      if (/\x1b\]10;\?(\x07|\x1b\\)/.test(data)) {
        child.write('\x1b]10;rgb:ffff/ffff/ffff\x1b\\');
      }

      // Filter out query sequences from outer terminal forwarding
      const filtered = data
        .replace(/\x1b\[\?996n/g, '')
        .replace(/\x1b\]11;\?(\x07|\x1b\\)/g, '')
        .replace(/\x1b\]10;\?(\x07|\x1b\\)/g, '');

      if (!filtered) return;

      const combined = tail + filtered;
      const lastEsc = combined.lastIndexOf('\x1b');
      let toProcess = combined;
      let newTail = '';
      if (lastEsc !== -1 && combined.length - lastEsc < MAX_SEQ_LEN && !combined.slice(lastEsc).includes('m')) {
        toProcess = combined.slice(0, lastEsc);
        newTail = combined.slice(lastEsc);
      }
      tail = newTail;
      process.stdout.write(rewriteOsc(rewrite(toProcess, rewriteState)));
    });

    child.onExit(({ exitCode }) => {
      if (exitCode === 75) {
        // Supervised /restart requested by Copilot CLI
        const restartFile = path.join(os.homedir(), '.copilot', 'restart', `${process.pid}.json`);
        let nextArgs = args;
        let nextCwd = cwd || process.cwd();
        try {
          if (fs.existsSync(restartFile)) {
            const parsed = JSON.parse(fs.readFileSync(restartFile, 'utf8'));
            try { fs.unlinkSync(restartFile); } catch (_) {}
            if (parsed && Array.isArray(parsed.argv)) {
              nextArgs = parsed.argv;
              if (parsed.sessionId && !nextArgs.includes('--session-id')) {
                nextArgs = [...nextArgs, '--session-id', parsed.sessionId];
              }
            }
            if (parsed && parsed.cwd) {
              nextCwd = parsed.cwd;
            }
          }
        } catch (_) {}

        startChild(nextArgs, nextCwd);
        return;
      }

      if (tail) process.stdout.write(rewriteOsc(rewrite(tail, rewriteState)));
      process.exit(exitCode);
    });
  }

  startChild(process.argv.slice(2), process.cwd());

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', d => {
    if (child) child.write(d.toString('utf8'));
  });

  process.stdout.on('resize', () => {
    if (child) child.resize(process.stdout.columns || cols, process.stdout.rows || rows);
  });

  function cleanup() {
    try { if (child) child.kill(); } catch (_) {}
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGHUP', () => { cleanup(); process.exit(0); });
  process.on('exit', () => cleanup());
}

module.exports = { boostGrayBackground, createRewriteState, transformColor, transformSgrParams, rewrite, rewriteOsc };
