const test = require('node:test');
const assert = require('node:assert/strict');
const { createRewriteState, rewrite } = require('./copilot-hc.js');

const ESC = String.fromCharCode(27);

test('keeps the dark prompt panel background unchanged', () => {
  const sgr = `${ESC}[48;2;20;27;34m`;
  assert.equal(rewrite(sgr), sgr);
});

test('darkens a delayed ANSI white prompt background', () => {
  assert.equal(
    rewrite(`${ESC}[47m`),
    `${ESC}[48;2;34;34;34m`,
  );
});

test('preserves a near-white selection highlight', () => {
  const sgr = `${ESC}[48;2;255;255;255m`;
  assert.equal(rewrite(sgr), sgr);
});

test('brightens dark foreground text for high contrast', () => {
  assert.equal(
    rewrite(`${ESC}[38;2;20;27;34mtext`),
    `${ESC}[38;2;203;205;206mtext`,
  );
});

test('keeps foreground resets high contrast', () => {
  const white = `${ESC}[38;2;255;255;255m`;
  assert.equal(rewrite(`${ESC}[39mtext`), `${white}text`);
  assert.equal(rewrite(`${ESC}[0mtext`), `${ESC}[0;38;2;255;255;255mtext`);
});

test('gives prompt border glyphs a subdued explicit foreground', () => {
  assert.equal(
    rewrite('┃'),
    `${ESC}[38;2;72;77;83m┃${ESC}[38;2;255;255;255m`,
  );
});

test('restores the active bright foreground after a prompt border glyph', () => {
  const bright = `${ESC}[38;2;255;255;255m`;
  assert.equal(
    rewrite(`${bright}┃following text`),
    `${bright}${ESC}[38;2;72;77;83m┃${bright}following text`,
  );
});

test('keeps the active foreground across output chunks', () => {
  const bright = `${ESC}[38;2;255;255;255m`;
  const state = createRewriteState();
  assert.equal(
    rewrite(`${bright}┃`, state),
    `${bright}${ESC}[38;2;72;77;83m┃${bright}`,
  );
  assert.equal(rewrite('following text', state), 'following text');
});
