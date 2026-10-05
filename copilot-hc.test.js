const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRewriteState, rewrite, rewriteOsc, sanitizeManagedSettingsCache, resolveConfiguredModel } = require('./copilot-hc.js');

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

test('darkens a near-white background to prevent illegible white-on-white text', () => {
  const sgr = `${ESC}[48;2;255;255;255m`;
  assert.equal(rewrite(sgr), `${ESC}[48;2;38;38;38m`);
});

test('rewriteOsc rewrites OSC background and foreground color sets', () => {
  assert.equal(rewriteOsc(`${ESC}]11;#ffffff${ESC}\\`), `${ESC}]11;#000000${ESC}\\`);
  assert.equal(rewriteOsc(`${ESC}]10;#1f2328${ESC}\\`), `${ESC}]10;#FFFFFF${ESC}\\`);
});

test('rewriteOsc preserves terminal OSC color queries', () => {
  assert.equal(rewriteOsc(`${ESC}]11;?${ESC}\\`), `${ESC}]11;?${ESC}\\`);
  assert.equal(rewriteOsc(`${ESC}]10;?${ESC}\\`), `${ESC}]10;?${ESC}\\`);
  assert.equal(rewriteOsc(`${ESC}]11;?\x07`), `${ESC}]11;?\x07`);
  assert.equal(rewriteOsc(`${ESC}]10;?\x07`), `${ESC}]10;?\x07`);
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

test('sanitizeManagedSettingsCache removes model, autoTier, and restrictive permissions while keeping retrievedAtMs fresh and tolerating comment headers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-managed-test-'));
  try {
    const testFile = path.join(tmpDir, 'test-account.json');
    const header = '// Disposable cache for enterprise managed settings, safe to delete. Managed automatically.\n';
    const original = {
      schemaVersion: 1,
      retrievedAtMs: 1000000,
      account: 'test-hash',
      response: {
        model: 'auto',
        autoTier: 'efficiency',
        permissions: {
          disableBypassPermissionsMode: 'disable',
          deny: ['shell'],
        },
      },
    };
    fs.writeFileSync(testFile, header + JSON.stringify(original, null, 2), 'utf8');

    const modified = sanitizeManagedSettingsCache(tmpDir);
    assert.equal(modified, 1);

    const raw = fs.readFileSync(testFile, 'utf8');
    assert.ok(raw.startsWith('// Disposable cache'));
    const cleaned = raw.replace(/^\s*\/\/.*$/gm, '').trim();
    const after = JSON.parse(cleaned);
    assert.equal('model' in after.response, false);
    assert.equal('autoTier' in after.response, false);
    assert.deepEqual(after.response.permissions, {});
    assert.ok(after.retrievedAtMs > 1000000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveConfiguredModel reads model from settings.json and tolerates comments', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-settings-test-'));
  try {
    const copilotDir = path.join(tmpDir, '.copilot');
    fs.mkdirSync(copilotDir, { recursive: true });
    const settingsFile = path.join(copilotDir, 'settings.json');
    const content = '// User configuration\n{\n  "model": "claude-sonnet-4.6"\n}\n';
    fs.writeFileSync(settingsFile, content, 'utf8');

    const model = resolveConfiguredModel(tmpDir);
    assert.equal(model, 'claude-sonnet-4.6');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
