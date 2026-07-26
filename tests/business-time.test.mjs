import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, businessDateTime, businessDayUtcRange } from '../server/time.js';

describe('business time zone', () => {
  it('uses Asia/Shanghai across the UTC date boundary', () => {
    const instant = new Date('2026-07-25T20:30:15.000Z');
    assert.deepEqual(businessDateTime(instant), {
      date: '2026-07-26',
      time: '04:30',
      second: 15,
      hour: 4,
      timeZone: 'Asia/Shanghai',
    });
    assert.equal(businessDate(instant), '2026-07-26');
  });

  it('accepts an explicit time zone for deterministic tests', () => {
    assert.equal(businessDate('2026-07-25T20:30:15.000Z', 'UTC'), '2026-07-25');
  });

  it('maps a Shanghai business day to exact UTC query boundaries', () => {
    assert.deepEqual(businessDayUtcRange('2026-07-26'), {
      startInclusive: '2026-07-25T16:00:00.000Z',
      endExclusive: '2026-07-26T16:00:00.000Z',
      timeZone: 'Asia/Shanghai',
    });
  });
});
