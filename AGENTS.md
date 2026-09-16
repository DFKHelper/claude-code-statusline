# AGENTS.md: claude-statusline

## Architecture & Code Change Invariants

<!-- ARCH_AUTO_SYNC_PROTOCOL -->
### Architecture Documentation Synchronization Invariant
1. Before committing any changeset that adds, removes, renames, or refactors source files or module exports, you MUST execute:
   `npm run docs:arch` (or `node scripts/sync-arch-docs.mjs --write`)
2. Verify that `npm run docs:arch:check` exits with status code 0.
3. Include the synchronized architecture documentation in the resulting commit.
4. Never manually edit the content between `<!-- ARCH_COMPONENTS_START -->` and `<!-- ARCH_COMPONENTS_END -->`.
<!-- ARCH_AUTO_SYNC_PROTOCOL -->

## Testing Commands
- `npm test`: Runs all unit tests and the architecture sync drift guard.
- `npm run docs:arch:check`: Verifies that `CLAUDE.arch.md` is strictly in sync with source modules.
