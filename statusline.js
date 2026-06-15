// Hard exit after 3s in case stdin never closes (prevents process accumulation)
setTimeout(() => process.exit(0), 3000).unref();

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
    const n = j?.context_window?.total_input_tokens || 0;
    const rem = j?.context_window?.remaining_percentage;
    // model is an object: {id: "claude-sonnet-4-6", display_name: "Sonnet 4.6"}
    const modelObj = j?.model;
    modelStr = modelObj?.display_name || '';
    const rawCwd = j?.cwd || j?.workspace?.current_dir || '';
    cwdStr = rawCwd ? rawCwd.split(/[\\/]/).filter(Boolean).pop() || rawCwd : '';

    if (n >= 1000) tok = Math.floor(n / 1000) + 'K';
    else if (n > 0) tok = '<1K';

    // Context % used with color tiers
    if (rem !== undefined) {
      const used = Math.round(100 - rem);
      let color;
      if (used >= 95)      color = '\x1b[1;31m';       // red
      else if (used >= 80) color = '\x1b[38;5;208m';   // orange
      else if (used >= 60) color = '\x1b[1;33m';       // yellow
      else                 color = '\x1b[0;32m';        // green
      ctxPct = color + used + '%\x1b[0m';
    }

    // auto-compact warning when remaining <= 20%
    if (rem !== undefined && rem <= 20) {
      let color;
      if (rem < 5)       color = '\x1b[1;31m';
      else if (rem < 9)  color = '\x1b[38;5;208m';
      else               color = '\x1b[1;33m';
      compactStr = color + 'AC!!' + '\x1b[0m';
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
    ? '\x1b[1;33mPEAK\x1b[0m (' + dur + ')'
    : '\x1b[1;32m🌙 OFF-PK\x1b[0m (' + dur + ')';

  const parts = [];
  if (modelStr)   parts.push('\x1b[0;35m' + modelStr + '\x1b[0m');
  if (tok)        parts.push('\x1b[0;36m' + tok + '\x1b[0m');
  if (ctxPct)     parts.push(ctxPct);
  if (compactStr) parts.push(compactStr);
  parts.push(peak);
  if (cwdStr)     parts.push('\x1b[38;5;208m' + cwdStr + '\x1b[0m');

  process.stdout.write(parts.join(' \x1b[0;37m|\x1b[0m '));
  process.exit(0);
});
