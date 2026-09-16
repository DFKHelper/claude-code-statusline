#!/usr/bin/env node
/**
 * scripts/sync-arch-docs.mjs
 *
 * Automated Architecture Documentation Synchronizer
 * Parses repository source modules and synchronizes the component map
 * in architectural documentation between marker tags.
 *
 * Usage:
 *   node scripts/sync-arch-docs.mjs --write   # Updates documentation in place (default)
 *   node scripts/sync-arch-docs.mjs --check   # Fails with exit code 1 if drift detected
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// Configuration
const CONFIG = {
  docCandidates: [
    'CLAUDE.arch.md',
    'ARCHITECTURE.md',
    'docs/architecture.md',
  ],
  sourceRoots: ['.', 'scripts'],
  allowedExtensions: new Set(['.js', '.mjs', '.cjs', '.ts']),
  ignoredDirectories: new Set([
    'node_modules',
    '.git',
    'tests',
    'test',
    'coverage',
    'dist',
    'build',
    '.copilot',
    '.claude',
    'tasks',
  ]),
  ignoredFilePatterns: [
    /\.test\.[a-z]+$/,
    /\.spec\.[a-z]+$/,
    /^\./,
  ],
  startMarker: '<!-- ARCH_COMPONENTS_START -->',
  endMarker: '<!-- ARCH_COMPONENTS_END -->',
};

const args = process.argv.slice(2);
const isCheckMode = args.includes('--check');

/**
 * Scans directories for relevant source modules.
 */
function scanSourceFiles() {
  const files = new Set();

  for (const root of CONFIG.sourceRoots) {
    const rootPath = resolve(REPO_ROOT, root);
    if (!existsSync(rootPath)) continue;

    const entries = readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) continue; // Keep root scan shallow, explicit subdirs in sourceRoots
      if (!entry.isFile()) continue;

      const ext = extname(entry.name);
      if (!CONFIG.allowedExtensions.has(ext)) continue;

      const isIgnored = CONFIG.ignoredFilePatterns.some(pattern => pattern.test(entry.name));
      if (isIgnored) continue;

      files.add(join(rootPath, entry.name));
    }
  }

  return Array.from(files);
}

/**
 * Extracts purpose and architectural metadata from a file.
 */
function analyzeModule(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const relPath = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const lines = content.split(/\r?\n/);

  // 1. Extract purpose from top comments or docstrings
  let purpose = '';
  const leadingComments = [];
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const line = lines[i].trim();
    if (line.startsWith('//')) {
      const cleaned = line.replace(/^\/\/\s?/, '').trim();
      if (cleaned && !cleaned.startsWith('Part of the') && !cleaned.startsWith('see README.md')) {
        leadingComments.push(cleaned);
      }
    } else if (line.startsWith('/*')) {
      // Block comment parsing
      let j = i;
      while (j < lines.length && !lines[j].includes('*/')) {
        const bline = lines[j].replace(/^\s*\/?\*+\s?/, '').trim();
        if (bline) leadingComments.push(bline);
        j++;
      }
      i = j;
    } else if (line && !line.startsWith('#!') && !line.startsWith('import') && !line.startsWith('const') && !line.startsWith('let') && !line.startsWith('var')) {
      break;
    }
  }

  if (leadingComments.length > 0) {
    purpose = leadingComments.slice(0, 2).join(' ').replace(/\|/g, '\\|').slice(0, 110);
  }

  // 2. Extract exports
  const exports = [];

  // CommonJS module.exports = { a, b, c } at top-level
  const cjsMatch = content.match(/(?:^|\n)\s*module\.exports\s*=\s*\{([^}]+)\}/);
  if (cjsMatch) {
    const names = cjsMatch[1]
      .split(',')
      .map(s => s.trim().split(':')[0].trim())
      .filter(s => s && !s.startsWith('//') && /^[a-zA-Z0-9_$]+$/.test(s));
    for (const name of names) {
      exports.push(`\`${name}\``);
    }
  }

  // CommonJS exports.name = ...
  const cjsNamedRegex = /(?:^|\n)\s*exports\.([a-zA-Z0-9_$]+)\s*=/g;
  let namedMatch;
  while ((namedMatch = cjsNamedRegex.exec(content)) !== null) {
    const sym = `\`${namedMatch[1]}\``;
    if (!exports.includes(sym)) exports.push(sym);
  }

  // ES module export function/class/const
  const esExportRegex = /(?:^|\n)\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z0-9_$]+)/g;
  let esMatch;
  while ((esMatch = esExportRegex.exec(content)) !== null) {
    const sym = `\`${esMatch[1]}\``;
    if (!exports.includes(sym)) exports.push(sym);
  }

  // ES module export { a, b }
  const esBlockRegex = /(?:^|\n)\s*export\s+\{([^}]+)\}/g;
  let esBlockMatch;
  while ((esBlockMatch = esBlockRegex.exec(content)) !== null) {
    const names = esBlockMatch[1]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(s => /^[a-zA-Z0-9_$]+$/.test(s));
    for (const name of names) {
      const sym = `\`${name}\``;
      if (!exports.includes(sym)) exports.push(sym);
    }
  }

  let primaryExports = exports.length > 0
    ? exports.slice(0, 5).join(', ') + (exports.length > 5 ? ` *(+${exports.length - 5} more)*` : '')
    : '*(CLI Executable / Script)*';

  // 3. Infer Architectural Role
  let category = 'Domain Core';
  if (relPath.includes('copilot-hc')) {
    category = 'PTY Proxy / Terminal Filter';
    if (!purpose) purpose = 'High-contrast/neon terminal proxy wrapping copilot.exe via node-pty';
  } else if (relPath.includes('statusline.js')) {
    category = 'CLI / Status Line Generator';
    if (!purpose) purpose = 'Dual-compatible status line renderer for Claude Code and Copilot CLI';
  } else if (relPath.includes('statusline-debug')) {
    category = 'Diagnostic / Inspection Tool';
    if (!purpose) purpose = 'Session status payload logger for debugging stdin schemas';
  } else if (relPath.includes('sync-arch-docs')) {
    category = 'Architecture Guard / Sync Engine';
    if (!purpose) purpose = 'Automated architecture component inventory validator and synchronizer';
  } else if (relPath.includes('install-git-hooks')) {
    category = 'DevOps / Hook Manager';
    if (!purpose) purpose = 'Pre-commit hook installer ensuring automated documentation freshness';
  }

  return {
    relPath,
    category,
    purpose: purpose || 'Component implementation',
    primaryExports,
  };
}

/**
 * Builds the Markdown Table string.
 */
function buildComponentTable(modules) {
  modules.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const rows = [
    CONFIG.startMarker,
    '<!-- AUTO-GENERATED ARCHITECTURE COMPONENT MAP: DO NOT EDIT DIRECTLY -->',
    '| Module Path | Layer / Role | Primary Exports | Architectural Purpose |',
    '| :--- | :--- | :--- | :--- |',
  ];

  for (const mod of modules) {
    rows.push(`| \`${mod.relPath}\` | **${mod.category}** | ${mod.primaryExports} | ${mod.purpose} |`);
  }

  rows.push(
    '',
    `*Total Modules Analyzed: ${modules.length}*`,
    CONFIG.endMarker
  );

  return rows.join('\n');
}

/**
 * Main execution.
 */
function main() {
  let targetDocPath = null;
  for (const cand of CONFIG.docCandidates) {
    const p = resolve(REPO_ROOT, cand);
    if (existsSync(p)) {
      targetDocPath = p;
      break;
    }
  }

  if (!targetDocPath) {
    console.error(`[sync-arch-docs] Error: No target architecture document found. Checked: ${CONFIG.docCandidates.join(', ')}`);
    process.exit(1);
  }

  const sourceFiles = scanSourceFiles();
  const moduleData = sourceFiles.map(analyzeModule);
  const generatedTable = buildComponentTable(moduleData);

  const originalContent = readFileSync(targetDocPath, 'utf8');

  let updatedContent = '';
  if (!originalContent.includes(CONFIG.startMarker) || !originalContent.includes(CONFIG.endMarker)) {
    const markerSection = `\n\n## Component Directory Map\n\n${generatedTable}\n`;
    updatedContent = originalContent.trimEnd() + markerSection;
  } else {
    const regex = new RegExp(`${CONFIG.startMarker}[\\s\\S]*?${CONFIG.endMarker}`, 'g');
    updatedContent = originalContent.replace(regex, generatedTable);
  }

  if (isCheckMode) {
    // Normalize newlines for cross-platform comparison
    const normOriginal = originalContent.replace(/\r\n/g, '\n').trim();
    const normUpdated = updatedContent.replace(/\r\n/g, '\n').trim();

    if (normOriginal !== normUpdated) {
      console.error(`\n❌ [sync-arch-docs] Architecture documentation drift detected in ${relative(REPO_ROOT, targetDocPath)}!`);
      console.error(`Discrepancy: Component table is out of sync with current codebase.`);
      console.error(`Run 'npm run docs:arch' or 'node scripts/sync-arch-docs.mjs --write' to synchronize.\n`);
      process.exit(1);
    }
    console.log(`✅ [sync-arch-docs] Architecture documentation is up to date: ${relative(REPO_ROOT, targetDocPath)} (${moduleData.length} modules verified)`);
    process.exit(0);
  }

  writeFileSync(targetDocPath, updatedContent, 'utf8');
  console.log(`✅ [sync-arch-docs] Successfully updated ${relative(REPO_ROOT, targetDocPath)} (${moduleData.length} modules synchronized)`);
}

main();
