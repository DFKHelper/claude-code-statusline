// Backs up ~/.claude/settings.json and (re)adds the statusLine entry.
// Safe to re-run: every other key in settings.json is kept as-is.
//
//   node install.js            back up, then add/repair statusLine
//   node install.js --backup   back up only, change nothing
//   node install.js --restore  put the newest backup back in place
//
// Backups go to ./settings-backups/ inside this repo (gitignored), not under
// ~/.claude, so they survive ~/.claude being wiped or recreated.
// Honors CLAUDE_CONFIG_DIR, like Claude Code itself.
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const configDir    = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(configDir, 'settings.json');
const backupDir    = path.join(__dirname, 'settings-backups');
const command      = 'node ' + path.join(__dirname, 'statusline.js').replace(/\\/g, '/');
const mode         = process.argv[2] || '';

function backup() {
  if (!fs.existsSync(settingsPath)) {
    console.log('No ' + settingsPath + ' yet; nothing to back up.');
    return;
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest  = path.join(backupDir, 'settings-' + stamp + '.json');
  fs.copyFileSync(settingsPath, dest);
  console.log('Backed up to ' + dest);
}

function restore() {
  const files = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter(f => f.endsWith('.json')).sort()
    : [];
  if (!files.length) {
    console.error('No backups in ' + backupDir);
    process.exit(1);
  }
  const src = path.join(backupDir, files[files.length - 1]);
  backup();  // keep whatever is there now, in case it's the one you want
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(src, settingsPath);
  console.log('Restored ' + src + ' -> ' + settingsPath);
}

function install() {
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      console.error(settingsPath + ' is not valid JSON; fix it by hand first. (' + e.message + ')');
      process.exit(1);
    }
  }
  const cur = settings.statusLine;
  if (cur && cur.type === 'command' && cur.command === command) {
    console.log('statusLine already set: ' + command);
    return;
  }
  backup();
  settings.statusLine = { type: 'command', command };
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('statusLine set: ' + command + '\nRestart Claude Code to see it.');
}

if (mode === '--backup') backup();
else if (mode === '--restore') restore();
else if (mode === '') install();
else {
  console.error('Unknown option ' + mode + ' (use --backup or --restore)');
  process.exit(1);
}
