#!/usr/bin/env node
/**
 * scripts/install-git-hooks.mjs
 *
 * Installs the pre-commit Git hook that automatically synchronizes
 * architecture documentation and stages changes prior to committing.
 */

import { writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const HOOK_PATH = resolve(REPO_ROOT, '.git', 'hooks', 'pre-commit');

const PRE_COMMIT_HOOK_CONTENT = `#!/bin/sh
# Auto-sync architecture documentation prior to commit

if [ -f "scripts/sync-arch-docs.mjs" ]; then
  node scripts/sync-arch-docs.mjs --write
  # Stage the documentation files if modified
  git add CLAUDE.arch.md ARCHITECTURE.md docs/architecture.md 2>/dev/null || true
fi
`;

function installHooks() {
  const gitDir = resolve(REPO_ROOT, '.git');
  if (!existsSync(gitDir)) {
    console.log('[install-git-hooks] No .git directory found. Skipping hook installation.');
    return;
  }

  const hooksDir = resolve(gitDir, 'hooks');
  if (!existsSync(hooksDir)) {
    console.log('[install-git-hooks] .git/hooks does not exist. Skipping.');
    return;
  }

  writeFileSync(HOOK_PATH, PRE_COMMIT_HOOK_CONTENT, { encoding: 'utf8', mode: 0o755 });
  try {
    chmodSync(HOOK_PATH, 0o755);
  } catch (_) {}

  console.log('✅ [install-git-hooks] Pre-commit hook successfully installed at .git/hooks/pre-commit');
}

installHooks();
