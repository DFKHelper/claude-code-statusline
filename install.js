// Backs up Claude Code's and Copilot CLI's settings.json and (re)adds the
// statusLine entry to each. Safe to re-run: every other key is kept as-is.
//
//   node install.js            back up, then add/repair statusLine
//   node install.js --backup   back up only, change nothing
//   node install.js --restore  put the newest backup back in place
//
// Add --claude or --copilot to act on just one tool; by default both are
// handled, skipping a tool that has neither a config folder nor backups.
//
// Backups go to ./settings-backups/<tool>/ inside this repo (gitignored), not
// under ~/.claude or ~/.copilot, so they survive those folders being wiped.
// If settings.json is missing but backups exist, a plain run restores the
// newest backup first, so a wiped folder gets all its settings back.
// Honors CLAUDE_CONFIG_DIR and COPILOT_HOME, like the tools themselves; a
// non-default folder gets its own backup subfolder so they never mix.
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TOOLS = {
  claude:  { name: 'Claude Code', env: 'CLAUDE_CONFIG_DIR', home: '.claude' },
  copilot: { name: 'Copilot CLI', env: 'COPILOT_HOME',      home: '.copilot' },
};
const script  = path.join(__dirname, 'statusline.js').replace(/\\/g, '/');
// Quote only when needed, so entries written by earlier versions still match.
const command = 'node ' + (/\s/.test(script) ? '"' + script + '"' : script);

const args    = process.argv.slice(2);
const modes   = args.filter(a => ['--backup', '--restore'].includes(a));
const only    = args.filter(a => ['--claude', '--copilot'].includes(a)).map(a => a.slice(2));
const unknown = args.filter(a => !modes.includes(a) && !only.includes(a.slice(2)));
if (unknown.length || modes.length > 1) {
  console.error('Usage: node install.js [--backup | --restore] [--claude | --copilot]');
  process.exit(1);
}

// Write via a temp file + rename so a crash mid-write can't leave a truncated file.
function writeAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

function backup(t, prefix = 'settings') {
  if (!fs.existsSync(t.settings)) {
    console.log(t.name + ': no ' + t.settings + ' yet; nothing to back up.');
    return;
  }
  fs.mkdirSync(t.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest  = path.join(t.backups, prefix + '-' + stamp + '.json');
  fs.copyFileSync(t.settings, dest);
  console.log(t.name + ': backed up to ' + dest);
}

// Only regular backups count; pre-restore copies are kept for manual recovery
// but never picked, so running --restore twice doesn't undo itself.
function newestBackup(t) {
  const files = fs.existsSync(t.backups)
    ? fs.readdirSync(t.backups).filter(f => /^settings-.*\.json$/.test(f)).sort()
    : [];
  return files.length ? path.join(t.backups, files[files.length - 1]) : null;
}

function restore(t) {
  const src = newestBackup(t);
  if (!src) {
    console.error(t.name + ': no backups in ' + t.backups);
    return false;
  }
  backup(t, 'pre-restore');  // keep whatever is there now, in case it's the one you want
  fs.mkdirSync(t.dir, { recursive: true });
  writeAtomic(t.settings, fs.readFileSync(src));
  console.log(t.name + ': restored ' + src);
  return true;
}

function install(t) {
  if (!fs.existsSync(t.settings) && newestBackup(t)) {
    console.log(t.name + ': ' + t.settings + ' is missing; restoring the newest backup first.');
    restore(t);
  }
  let settings = {};
  let raw = null;
  if (fs.existsSync(t.settings)) {
    raw = fs.readFileSync(t.settings, 'utf8');
    try {
      // Copilot's JSON files may carry whole-line // comments; drop those.
      settings = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    } catch (e) {
      console.error(t.name + ': ' + t.settings + ' is not valid JSON; fix it by hand first. (' + e.message + ')');
      return false;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      console.error(t.name + ': ' + t.settings + ' is not a JSON object ({...}); fix it by hand first.');
      return false;
    }
  }
  const cur = settings.statusLine;
  if (cur && cur.type === 'command' && cur.command === command) {
    console.log(t.name + ': statusLine already set.');
    return true;
  }
  backup(t);
  settings.statusLine = { type: 'command', command };
  // The tool itself may rewrite this file; don't clobber a change made since we read it.
  const now = fs.existsSync(t.settings) ? fs.readFileSync(t.settings, 'utf8') : null;
  if (now !== raw) {
    console.error(t.name + ': ' + t.settings + ' changed while running; nothing written. Run again.');
    return false;
  }
  writeAtomic(t.settings, JSON.stringify(settings, null, 2) + '\n');
  console.log(t.name + ': statusLine set to ' + command + ' (restart it to see the change).');
  return true;
}

// Windows paths are case-insensitive, so compare/hash them lowercased there.
const norm = p => { p = path.resolve(p); return process.platform === 'win32' ? p.toLowerCase() : p; };

let ok = true;
for (const key of only.length ? only : Object.keys(TOOLS)) {
  const T   = TOOLS[key];
  const def = path.join(os.homedir(), T.home);
  const dir = process.env[T.env] || def;
  const sub = norm(dir) === norm(def) ? key
            : key + '-' + crypto.createHash('sha1').update(norm(dir)).digest('hex').slice(0, 8);
  const t = { name: T.name, dir, settings: path.join(dir, 'settings.json'),
              backups: path.join(__dirname, 'settings-backups', sub) };
  // A folder with backups but no config dir was wiped, not uninstalled.
  if (!fs.existsSync(t.dir) && !newestBackup(t)) {
    // Asked for by name: report it. Default run: the tool just isn't installed.
    if (only.length) { console.error(t.name + ': ' + t.dir + ' not found.'); ok = false; }
    else console.log(t.name + ': ' + t.dir + ' not found; skipping.');
    continue;
  }
  if (modes[0] === '--backup') backup(t);
  else if (modes[0] === '--restore') ok = restore(t) && ok;
  else ok = install(t) && ok;
}
process.exit(ok ? 0 : 1);
