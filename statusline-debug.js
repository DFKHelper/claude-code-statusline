// Captures the raw JSON Claude Code pipes to the status line command.
// Writes it to STATUSLINE_DEBUG_PATH (default: ~/statusline-capture.json).
// Swap this in for statusline.js temporarily; the status bar shows "DEBUG".
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const outputPath = process.env.STATUSLINE_DEBUG_PATH
  || path.join(os.homedir(), 'statusline-capture.json');

let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  fs.writeFileSync(outputPath, d);
  process.stdout.write('DEBUG: wrote ' + outputPath);
});
