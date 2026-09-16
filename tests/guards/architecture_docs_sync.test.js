const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const { resolve } = require('node:path');

test('Architecture Documentation Drift Guard', async (t) => {
  await t.test('enforces that architectural component maps are in sync with source code', () => {
    const scriptPath = resolve(__dirname, '../../scripts/sync-arch-docs.mjs');
    try {
      const output = execSync(`node "${scriptPath}" --check`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      assert.match(output, /✅ \[sync-arch-docs\]/);
    } catch (error) {
      const stderr = error.stderr?.toString() || error.stdout?.toString() || error.message;
      assert.fail(
        `Architecture drift detected!\n${stderr}\n` +
        `Fix this failure by running: npm run docs:arch`
      );
    }
  });
});
