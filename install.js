// Backs up Claude Code's and Copilot CLI's settings.json and (re)adds the
// statusLine entry to each. Safe to re-run: every other key is kept as-is.
//
//   node install.js            back up, then add/repair statusLine
//   node install.js --backup   back up only, change nothing
//   node install.js --restore  put the newest backup back in place
//
// Add --claude or --copilot to act on just one tool; by default both are
// handled, skipping a tool whose config folder doesn't exist (not installed).
//
// Backups go to ./settings-backups/<tool>/ inside this repo (gitignored), not
// under ~/.claude or ~/.copilot, so they survive those folders being wiped.
// Honors CLAUDE_CONFIG_DIR and COPILOT_HOME, like the tools themselves.
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const TOOLS = {
  claude:  { name: 'Claude Code', dir: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') },
  copilot: { name: 'Copilot CLI', dir: process.env.COPILOT_HOME      || path.join(os.homedir(), '.copilot') },
};
const command = 'node ' + path.join(__dirname, 'statusline.js').replace(/\\/g, '/');

const args    = process.argv.slice(2);
const modes   = args.filter(a => ['--backup', '--restore'].includes(a));
const only    = args.filter(a => ['--claude', '--copilot'].includes(a)).map(a => a.slice(2));
const unknown = args.filter(a => !modes.includes(a) && !only.includes(a.slice(2)));
if (unknown.length || modes.length > 1) {
  console.error('Usage: node install.js [--backup | --restore] [--claude | --copilot]');
  process.exit(1);
}

function backup(t) {
  if (!fs.existsSync(t.settings)) {
    console.log(t.name + ': no ' + t.settings + ' yet; nothing to back up.');
    return;
  }
  fs.mkdirSync(t.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest  = path.join(t.backups, 'settings-' + stamp + '.json');
  fs.copyFileSync(t.settings, dest);
  console.log(t.name + ': backed up to ' + dest);
}

function restore(t) {
  const files = fs.existsSync(t.backups)
    ? fs.readdirSync(t.backups).filter(f => f.endsWith('.json')).sort()
    : [];
  if (!files.length) {
    console.error(t.name + ': no backups in ' + t.backups);
    return false;
  }
  const src = path.join(t.backups, files[files.length - 1]);
  backup(t);  // keep whatever is there now, in case it's the one you want
  fs.copyFileSync(src, t.settings);
  console.log(t.name + ': restored ' + src);
  return true;
}

function install(t) {
  let settings = {};
  if (fs.existsSync(t.settings)) {
    // Copilot's JSON files may carry whole-line // comments; drop those.
    const text = fs.readFileSync(t.settings, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    try {
      settings = JSON.parse(text);
    } catch (e) {
      console.error(t.name + ': ' + t.settings + ' is not valid JSON; fix it by hand first. (' + e.message + ')');
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
  fs.writeFileSync(t.settings, JSON.stringify(settings, null, 2) + '\n');
  console.log(t.name + ': statusLine set to ' + command + ' (restart it to see the change).');
  return true;
}

let ok = true;
for (const key of only.length ? only : Object.keys(TOOLS)) {
  const t = { ...TOOLS[key], settings: path.join(TOOLS[key].dir, 'settings.json'),
              backups: path.join(__dirname, 'settings-backups', key) };
  if (!fs.existsSync(t.dir)) {
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
