# CLAUDE.md: claude-statusline

## Project Overview
`claude-statusline` provides a dual-compatible status bar generator (`statusline.js`) for Claude Code and GitHub Copilot CLI, alongside a high-contrast/neon terminal PTY proxy (`copilot-hc.js`) for Copilot CLI on Windows.

## Development & Test Commands
- **Run all tests**: `npm test`
- **Run high-contrast proxy unit tests**: `node --test copilot-hc.test.js`
- **Run architecture drift guard**: `node --test tests/guards/architecture_docs_sync.test.js`
- **Update architecture documentation**: `npm run docs:arch`
- **Verify architecture documentation sync**: `npm run docs:arch:check`

<!-- ARCH_AUTO_SYNC_PROTOCOL -->
### Architecture Documentation Synchronization Invariant
1. Before committing any changeset that adds, removes, renames, or refactors source files or module exports, you MUST execute:
   `npm run docs:arch` (or `node scripts/sync-arch-docs.mjs --write`)
2. Verify that `npm run docs:arch:check` exits with status code 0.
3. Include the synchronized architecture documentation in the resulting commit.
4. Never manually edit the content between `<!-- ARCH_COMPONENTS_START -->` and `<!-- ARCH_COMPONENTS_END -->`.
<!-- ARCH_AUTO_SYNC_PROTOCOL -->
