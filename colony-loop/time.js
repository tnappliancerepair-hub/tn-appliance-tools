const CT = 'America/Chicago';

export function nowMs() {
  return Date.now();
}

export function ctParts(ts = Date.now()) {
  const d = new Date(ts);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CT,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m = {};
  for (const p of fmt) m[p.type] = p.value;
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour: Number(m.hour === '24' ? '0' : m.hour),
    minute: Number(m.minute),
    second: Number(m.second),
  };
}

export function ctMidnightMs(ts = Date.now()) {
  const p = ctParts(ts);
  return ctYmdHourToMs(p.year, p.month, p.day, 0);
}

export function ctHour(ts = Date.now()) {
  return ctParts(ts).hour;
}

function ctOffsetMinutes(ts) {
  const utcParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const ctParts2 = new Intl.DateTimeFormat('en-US', {
    timeZone: CT,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const toMin = (parts) => {
    const m = {};
    for (const p of parts) m[p.type] = p.value;
    const y = Number(m.year), mo = Number(m.month), d = Number(m.day);
    const h = Number(m.hour === '24' ? '0' : m.hour), mi = Number(m.minute);
    return Date.UTC(y, mo - 1, d, h, mi) / 60000;
  };
  return toMin(ctParts2) - toMin(utcParts);
}

export function ctYmdHourToMs(year, month, day, hour) {
  const probe = Date.UTC(year, month - 1, day, hour, 0, 0);
  const offsetMin = ctOffsetMinutes(probe);
  return probe - offsetMin * 60000;
}

export function isQuietHourCT(ts = Date.now(), quietStart = 21, quietEnd = 8) {
  const h = ctHour(ts);
  if (quietStart > quietEnd) {
    return h >= quietStart || h < quietEnd;
  }
  return h >= quietStart && h < quietEnd;
}

export function next8amCTMs(ts = Date.now()) {
  const p = ctParts(ts);
  let { year, month, day } = p;
  if (p.hour >= 8) {
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    year = tomorrow.getUTCFullYear();
    month = tomorrow.getUTCMonth() + 1;
    day = tomorrow.getUTCDate();
  }
  return ctYmdHourToMs(year, month, day, 8);
}

export function fmtCT(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CT,
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}
