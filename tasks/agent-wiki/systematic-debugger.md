# Systematic debugger notes

## 2026-09-14 — Copilot border SGR state leak

Copilot's prompt border glyph rewrite must restore the foreground that was
active before the glyph. `ESC[39m` restores the terminal default, which may be
dim gray and is not equivalent to restoring the previous explicit SGR color.
The PTY stream is chunked, so foreground state must persist between calls to
the rewrite function. Evidence: the regression test in `copilot-hc.test.js`
reproduces the loss of contrast when the border and following text are split
across calls.

The weak border blend was also being applied to every dark-gray foreground,
not just border glyphs: RGB(20,27,34) became only RGB(72,77,83). Keep the
subdued border color in the glyph-specific rewrite and apply the normal bright
foreground transform to ordinary text. Foreground resets (`39`, `0`, and
bare resets) should be emitted as explicit white because terminal-default
color handling is not reliable for this wrapper.
