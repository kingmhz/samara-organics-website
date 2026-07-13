import assert from 'node:assert/strict';
import { calendarDateKey, indiaCalendarToday, planDateKeys } from '../subscription-booking.js';

assert.equal(calendarDateKey(new Date('2026-07-14T00:00:00Z')), '2026-07-14');
assert.equal(calendarDateKey(indiaCalendarToday(new Date('2026-07-13T19:30:00Z'))), '2026-07-14', 'The Indian calendar day must not inherit the browser or server timezone.');

const start = new Date('2026-07-14T00:00:00Z');
const daily30 = planDateKeys(start, 30, 'daily');
assert.equal(daily30.length, 30);
assert.equal(daily30[0], '2026-07-14');
assert.equal(daily30.at(-1), '2026-08-12');
assert.equal(planDateKeys(start, 60, 'daily').length, 60);
assert.equal(planDateKeys(start, 30, 'alternate').length, 15);
assert.ok(planDateKeys(start, 30, 'weekend').every(date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())));

console.log('India-safe subscription calendar tests passed.');
