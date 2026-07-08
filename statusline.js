// Dual-compatible status line for both Claude Code and GitHub Copilot CLI.
// One script, one set of defensive field lookups, works as the statusLine
// command for either tool — point it at whichever settings.json applies.
//
// Claude Code's stdin JSON schema is stable and documented (see
// https://code.claude.com/docs/en/statusline): context_window.total_input_tokens,
// context_window.remaining_percentage, model.display_name, cwd.
//
// GitHub Copilot CLI's statusLine command receives a different, and less
// formally documented, JSON schema. Field names below were confirmed from:
//   - `copilot help config` (`statusLine` section)
//   - EncodeTS/copilot-statusline (real third-party Copilot CLI statusline
//     implementation) requiring `current_context_tokens` /
//     `displayed_context_limit` under `context_window`
//   - blog.madkoo.net's defensive field-probing statusline script, which
//     enumerates every field-name variant seen across Copilot CLI versions
// Field access below stays defensive (tries several possible paths) so the
// same script resolves correctly against either schema without modification.
//
// Colors below use 24-bit truecolor SGR codes tuned to be vivid/"neon" on
// a pure-black background, matching the high-contrast treatment applied to
// the rest of the CLI by copilot-hc.js (see README.md). They read fine on
// their own too, since the statusline command's stdout is only ever piped
// through copilot.exe (and, if installed, the copilot-hc.js wrapper).

// Hard exit after 3s in case stdin never closes (prevents process accumulation)
setTimeout(() => process.exit(0), 3000).unref();

// Neon truecolor palette (foreground only; "0m" still resets to default).
const FG = {
  magenta: '\x1b[38;2;255;70;255m',   // model name
  cyan:    '\x1b[38;2;70;255;255m',   // token count
  green:   '\x1b[38;2;70;255;110m',   // context % used: low
  yellow:  '\x1b[38;2;255;255;70m',   // context % used: medium
  orange:  '\x1b[38;2;255;170;40m',   // context % used: high / cwd
  red:     '\x1b[38;2;255;60;90m',    // context % used: critical / AC!!
  teal:    '\x1b[38;2;0;255;213m',    // off-peak marker
  gray:    '\x1b[38;2;220;224;230m',  // separators
  reset:   '\x1b[0m',
};

let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  let tok = '';
  let compactStr = '';
  let modelStr = '';
  let ctxPct = '';
  let cwdStr = '';

  try {
    const j = JSON.parse(d);
    const cw = j?.context_window || j?.contextWindow || {};

    // Total tokens used in the current context window. rawN stays undefined
    // when none of these fields exist at all, so a legitimate zero still
    // renders (only a payload with none of these fields omits the segment).
    const rawN = cw.current_context_tokens ?? cw.currentContextTokens ?? cw.total_input_tokens
      ?? j?.currentTokens ?? j?.usage?.input_tokens ?? j?.usage?.inputTokens;
    const n = rawN ?? 0;

    // Context window size, to compute a "% used" figure.
    const limit = cw.displayed_context_limit ?? cw.displayedContextLimit ?? cw.limit
      ?? cw.total_tokens ?? cw.totalTokens;

    // Some payloads report "% used" directly; others only report "%
    // remaining" (Claude-style); fall back to computing from tokens/limit.
    let usedPct = cw.used_percentage ?? cw.usedPercentage;
    if (usedPct === undefined && typeof cw.remaining_percentage === 'number') {
      usedPct = 100 - cw.remaining_percentage;
    }
    if (usedPct === undefined && typeof n === 'number' && typeof limit === 'number' && limit > 0) {
      usedPct = (n / limit) * 100;
    }

    // Model: may appear as a plain string or an object with a display name,
    // under several different top-level keys depending on CLI version.
    const modelRaw = j?.model ?? j?.currentModel ?? j?.selectedModel ?? j?.session?.selectedModel;
    if (modelRaw && typeof modelRaw === 'object') {
      modelStr = modelRaw.display_name || modelRaw.displayName || modelRaw.name || modelRaw.id || '';
    } else if (typeof modelRaw === 'string') {
      modelStr = modelRaw;
    }

    const rawCwd = j?.cwd || j?.workspace?.current_dir || j?.workspace?.currentDir || '';
    cwdStr = rawCwd ? rawCwd.split(/[\\/]/).filter(Boolean).pop() || rawCwd : '';

    if (n >= 1000)                tok = Math.floor(n / 1000) + 'K tokens';
    else if (n > 0)               tok = '<1K tokens';
    else if (rawN !== undefined)  tok = '0 tokens';

    // Context % used with color tiers
    if (usedPct !== undefined) {
      const used = Math.round(usedPct);
      let color;
      if (used >= 95)      color = FG.red;
      else if (used >= 80) color = FG.orange;
      else if (used >= 60) color = FG.yellow;
      else                 color = FG.green;
      ctxPct = color + used + '%' + FG.reset;

      // auto-compact warning when remaining <= 20%
      const rem = 100 - used;
      if (rem <= 20) {
        let acColor;
        if (rem < 5)       acColor = FG.red;
        else if (rem < 9)  acColor = FG.orange;
        else               acColor = FG.yellow;
        compactStr = acColor + 'AC!!' + FG.reset;
      }
    }
  } catch (e) {}

  // Peak: 5-11am Pacific Time, Mon-Fri (DST-aware via America/Los_Angeles)
  const ptParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const getNum = t => {
    const p = ptParts.find(p => p.type === t);
    return p ? parseInt(p.value, 10) : 0;
  };
  const ptHour = getNum('hour') % 24;
  const ptMinute = getNum('minute');
  const ptWeekday = ptParts.find(p => p.type === 'weekday').value;
  const isWeekday = ptWeekday !== 'Sat' && ptWeekday !== 'Sun';
  const isPeak = isWeekday && ptHour >= 5 && ptHour < 11;

  // Hours until next state change
  let hoursToChange;
  if (isPeak) {
    hoursToChange = 11 - ptHour - ptMinute / 60;
  } else if (isWeekday && ptHour < 5) {
    hoursToChange = 5 - ptHour - ptMinute / 60;
  } else {
    const hoursToMidnight = 24 - ptHour - ptMinute / 60;
    const wdOrder = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let nextIdx = (wdOrder.indexOf(ptWeekday) + 1) % 7;
    let extraDays = 0;
    while (nextIdx === 0 || nextIdx === 6) {
      extraDays++;
      nextIdx = (nextIdx + 1) % 7;
    }
    hoursToChange = hoursToMidnight + extraDays * 24 + 5;
  }

  const totalMin = Math.round(hoursToChange * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const dur = h === 0 ? m + 'm' : (m === 0 ? h + 'h' : h + 'h ' + m + 'm');

  const peak = isPeak
    ? FG.yellow + 'PEAK' + FG.reset + ' (' + dur + ')'
    : FG.teal + '🌙' + FG.reset + ' (' + dur + ')';

  const parts = [];
  if (modelStr)   parts.push(FG.magenta + modelStr + FG.reset);
  if (ctxPct)     parts.push(ctxPct);
  if (compactStr) parts.push(compactStr);
  parts.push(peak);
  if (cwdStr)     parts.push(FG.orange + cwdStr + FG.reset);
  if (tok)        parts.push(FG.cyan + tok + FG.reset);

  process.stdout.write(parts.join(' ' + FG.gray + '|' + FG.reset + ' '));
  process.exit(0);
});

