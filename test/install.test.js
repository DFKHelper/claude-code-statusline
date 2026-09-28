// Tests for install.js. Each test copies install.js into its own temp folder
// and points the config dirs there, so real settings and real backups
// (./settings-backups/) are never touched. Run with: npm test
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'install.js');
const roots = [];
test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));

// Sets up <tmp>/<repoName>/install.js plus separate home and config folders.
function sandbox(repoName = 'repo') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-'));
  const repo = path.join(root, repoName);
  fs.mkdirSync(repo);
  fs.copyFileSync(SRC, path.join(repo, 'install.js'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const sb = {
    root, repo, home,
    claude:  path.join(root, 'claude-cfg'),
    copilot: path.join(root, 'copilot-cfg'),
    command: 'node ' + path.join(repo, 'statusline.js').replace(/\\/g, '/'),
    // defaultDirs: leave CLAUDE_CONFIG_DIR/COPILOT_HOME unset so ~/.claude is used.
    run(args = [], { defaultDirs = false } = {}) {
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.CLAUDE_CONFIG_DIR;
      delete env.COPILOT_HOME;
      if (!defaultDirs) { env.CLAUDE_CONFIG_DIR = sb.claude; env.COPILOT_HOME = sb.copilot; }
      const r = spawnSync(process.execPath, [path.join(repo, 'install.js'), ...args], { env, encoding: 'utf8' });
      return { code: r.status, out: r.stdout + r.stderr };
    },
    write(dir, obj) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
    },
    read(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')); },
    backupDirs() {
      const d = path.join(repo, 'settings-backups');
      return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
    },
  };
  roots.push(root);
  return sb;
}

test('adds statusLine, keeps other keys, and a re-run changes nothing', () => {
  const sb = sandbox();
  sb.write(sb.claude, { model: 'opus', permissions: { allow: ['x'] } });
  const r = sb.run(['--claude']);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(sb.read(sb.claude), {
    model: 'opus', permissions: { allow: ['x'] }, statusLine: { type: 'command', command: sb.command },
  });
  const again = sb.run(['--claude']);
  assert.strictEqual(again.code, 0);
  assert.match(again.out, /already set/);
});

test('drops whole-line // comments from Copilot settings', () => {
  const sb = sandbox();
  sb.write(sb.copilot, '// managed\n{ "theme": "dim" }\n');
  assert.strictEqual(sb.run(['--copilot']).code, 0);
  assert.strictEqual(sb.read(sb.copilot).theme, 'dim');
});

test('refuses a settings file whose top level is not an object', () => {
  const sb = sandbox();
  sb.write(sb.claude, '[1]');
  const r = sb.run(['--claude']);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /not a JSON object/);
  assert.strictEqual(fs.readFileSync(path.join(sb.claude, 'settings.json'), 'utf8'), '[1]');
});

test('--restore recreates a config folder that was deleted', () => {
  const sb = sandbox();
  sb.write(sb.claude, { model: 'opus' });
  sb.run(['--claude', '--backup']);
  fs.rmSync(sb.claude, { recursive: true });
  const r = sb.run(['--restore']);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(sb.read(sb.claude), { model: 'opus' });
});

test('running --restore twice restores the same backup both times', () => {
  const sb = sandbox();
  sb.write(sb.claude, { v: 'good' });
  sb.run(['--claude', '--backup']);
  sb.write(sb.claude, { v: 'broken' });
  sb.run(['--claude', '--restore']);
  assert.deepStrictEqual(sb.read(sb.claude), { v: 'good' });
  sb.run(['--claude', '--restore']);
  assert.deepStrictEqual(sb.read(sb.claude), { v: 'good' });
});

test('a plain run after a wipe brings back the other settings too', () => {
  const sb = sandbox();
  sb.write(sb.claude, { model: 'opus' });
  sb.run(['--claude']);
  fs.rmSync(sb.claude, { recursive: true });
  const r = sb.run([]);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(sb.read(sb.claude), {
    model: 'opus', statusLine: { type: 'command', command: sb.command },
  });
});

test('quotes the script path when the repo folder has a space', () => {
  const sb = sandbox('my repo');
  sb.write(sb.claude, {});
  sb.run(['--claude']);
  const script = path.join(sb.repo, 'statusline.js').replace(/\\/g, '/');
  assert.strictEqual(sb.read(sb.claude).statusLine.command, 'node "' + script + '"');
});

test('default and overridden config folders keep separate backups', () => {
  const sb = sandbox();
  sb.write(path.join(sb.home, '.claude'), { which: 'default' });
  sb.write(sb.claude, { which: 'override' });
  sb.run(['--claude', '--backup'], { defaultDirs: true });
  sb.run(['--claude', '--backup']);
  const dirs = sb.backupDirs();
  assert.strictEqual(dirs.length, 2, dirs.join());
  assert.ok(dirs.includes('claude'));
  assert.match(dirs.find(d => d !== 'claude'), /^claude-[0-9a-f]{8}$/);
  // Restoring the override must not pull in the default folder's settings.
  sb.write(sb.claude, { which: 'broken' });
  sb.run(['--claude', '--restore']);
  assert.deepStrictEqual(sb.read(sb.claude), { which: 'override' });
});

test('a tool with no folder and no backups is skipped, or an error if named', () => {
  const sb = sandbox();
  sb.write(sb.claude, {});
  const all = sb.run([]);
  assert.strictEqual(all.code, 0, all.out);
  assert.match(all.out, /Copilot CLI: .* not found; skipping/);
  assert.strictEqual(sb.run(['--copilot']).code, 1);
});

test('rejects unknown and conflicting arguments', () => {
  const sb = sandbox();
  assert.strictEqual(sb.run(['--bogus']).code, 1);
  assert.strictEqual(sb.run(['--backup', '--restore']).code, 1);
});
