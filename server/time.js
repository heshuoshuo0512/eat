const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Shanghai';

const formatterCache = new Map();

function configuredTimeZone() {
  return String(process.env.SMART_CANTEEN_TIME_ZONE || DEFAULT_BUSINESS_TIME_ZONE).trim() || DEFAULT_BUSINESS_TIME_ZONE;
}

function formatterFor(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timeZone);
}

export function businessDateTime(value = new Date(), timeZone = configuredTimeZone()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid business date');
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    second: Number(parts.second),
    hour: Number(parts.hour),
    timeZone,
  };
}

export function businessDate(value = new Date(), timeZone = configuredTimeZone()) {
  return businessDateTime(value, timeZone).date;
}

function zonedMidnightUtc(dateValue, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  if (!match) throw new TypeError('Invalid business date value');
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = businessDateTime(new Date(instant), timeZone);
    const representedAsUtc = Date.UTC(
      Number(local.date.slice(0, 4)),
      Number(local.date.slice(5, 7)) - 1,
      Number(local.date.slice(8, 10)),
      local.hour,
      Number(local.time.slice(3, 5)),
      local.second,
    );
    const correction = target - representedAsUtc;
    instant += correction;
    if (correction === 0) break;
  }
  return instant;
}

export function businessDayUtcRange(dateValue, timeZone = configuredTimeZone()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  if (!match) throw new TypeError('Invalid business date value');
  const nextCalendarDay = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  const nextDate = nextCalendarDay.toISOString().slice(0, 10);
  return {
    startInclusive: new Date(zonedMidnightUtc(dateValue, timeZone)).toISOString(),
    endExclusive: new Date(zonedMidnightUtc(nextDate, timeZone)).toISOString(),
    timeZone,
  };
}

export function businessTimeZone() {
  return configuredTimeZone();
}
