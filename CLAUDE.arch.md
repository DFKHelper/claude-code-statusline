# Architecture & Runtime Design: claude-statusline

## 1. Executive Summary

`claude-statusline` provides a dual-compatible terminal status bar engine and high-contrast PTY proxy designed specifically for CLI coding agents:
1. **`statusline.js`**: Dual-compatible status line generator supporting both Anthropic's Claude Code and GitHub Copilot CLI. It ingests runtime session metrics over standard input (JSON) and renders a rich, color-coded, single-line terminal status bar.
2. **`copilot-hc.js`**: A pseudo-terminal (PTY) proxy built on `node-pty` that wraps `copilot.exe` to intercept terminal output, dynamically recoloring washed-out truecolor/ANSI palettes into high-contrast neon tones and enforcing black canvas backgrounds via OSC sequences.

---

## 2. System Topology & Data Flow

```
[Claude Code]               [GitHub Copilot CLI]
     │                               │
     │ stdin JSON                    │ (Runs wrapped under copilot-hc.js)
     ▼                               ▼
┌─────────────────────────┐   ┌──────────────────────────────┐
│      statusline.js      │   │        copilot-hc.js         │
│ (Dual Schema Parser)    │   │  - node-pty pseudo-terminal  │
│  - context usage        │   │  - SGR regex recoloring      │
│  - token metrics        │   │  - prompt border enhancement │
│  - peak / off-peak time │   │  - OSC 10/11 canvas blacking │
└────────────┬────────────┘   └──────────────┬───────────────┘
             │                               │
             ▼                               ▼
       ANSI Terminal                   ANSI Terminal
```

### Key Integration Points
- **Claude Code**: Invokes `statusline.js` via the `statusLine` configuration in `~/.claude/settings.json`.
- **Copilot CLI**: Configured via `~/.copilot/settings.json` under `"statusLine": { "type": "command", "command": "node C:/projects/claude-statusline/statusline.js" }`.
- **PowerShell Profile**: Routes the `copilot` CLI command through `copilot-hc.js` transparently using a custom PowerShell wrapper function.

---

## 3. Component Directory Map

<!-- ARCH_COMPONENTS_START -->
<!-- AUTO-GENERATED ARCHITECTURE COMPONENT MAP: DO NOT EDIT DIRECTLY -->
| Module Path | Layer / Role | Primary Exports | Architectural Purpose |
| :--- | :--- | :--- | :--- |
| `copilot-hc.js` | **PTY Proxy / Terminal Filter** | `boostGrayBackground`, `createRewriteState`, `transformColor`, `transformSgrParams`, `rewrite` *(+1 more)* | High-contrast / neon proxy for GitHub Copilot CLI. Part of the claude-statusline project alongside statusline. |
| `scripts/install-git-hooks.mjs` | **DevOps / Hook Manager** | *(CLI Executable / Script)* | scripts/install-git-hooks.mjs Installs the pre-commit Git hook that automatically synchronizes |
| `scripts/sync-arch-docs.mjs` | **Architecture Guard / Sync Engine** | *(CLI Executable / Script)* | scripts/sync-arch-docs.mjs Automated Architecture Documentation Synchronizer |
| `statusline-debug.js` | **Diagnostic / Inspection Tool** | *(CLI Executable / Script)* | Captures the raw JSON Claude Code pipes to the status line command. Writes it to STATUSLINE_DEBUG_PATH (defaul |
| `statusline.js` | **CLI / Status Line Generator** | *(CLI Executable / Script)* | Dual-compatible status line for both Claude Code and GitHub Copilot CLI. One script, one set of defensive fiel |

*Total Modules Analyzed: 5*
<!-- ARCH_COMPONENTS_END -->

---

## 4. Core Invariants & Engineering Guarantees

1. **Zero External Runtime Dependencies for Statusline**: `statusline.js` must remain zero-dependency (relying strictly on Node.js built-in APIs) to execute in under 50ms per tick.
2. **Stream Chunk Safety**: `copilot-hc.js` buffers trailing incomplete escape sequences across stream chunks (`MAX_SEQ_LEN = 40`) to ensure ANSI codes are never corrupted or emitted mid-sequence.
3. **Dual Schema Defensive Resilience**: `statusline.js` never assumes a single fixed schema. All field accesses are guarded by nullish coalescing to tolerate schema evolution in Claude Code or Copilot CLI updates.
4. **Subdued Prompt Framing**: Prompt input borders (`▄▀╻╹┃`) are explicitly recolored to prevent terminal default drift without washing out adjacent text.
5. **Architectural Synchronization**: Component maps must remain synchronized with source code across all commits and CI gates.
