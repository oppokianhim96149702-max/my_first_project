// Run: node test/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = ['config.js', 'lib.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
const L = vm.runInNewContext(src + '\n({ CONFIG, BTN, processMessage, checkShifts, worksOn, parseHHMM, haversineM });', { Intl, Date, Math });
const cfg = { ...L.CONFIG, ADMIN_CHAT_ID: '-1001', TIMEZONE: 'Asia/Singapore' };

// 2026-11-18 08:10:00 SGT = 00:10:00 UTC
const T = s => Math.floor(Date.parse(s) / 1000);
const t0810 = T('2026-11-18T00:10:00Z');

const sites = [{ SiteID: 'S1', SiteName: 'Mall A', Latitude: '1.3000', Longitude: '103.8000', RadiusM: '150', SupervisorChatID: '-2002' }];
const baseGuard = { TelegramID: '111', Name: 'Ali', SiteID: 'S1', ShiftStart: '08:00', ShiftEnd: '20:00', WorkDays: '', Active: 'YES', Status: 'OUT', LastCheckIn: '', LastCheckInTs: '', Pending: '' };
const msg = (extra, date = t0810) => ({ message: { chat: { id: 111, type: 'private' }, from: { id: 111, first_name: 'Ali' }, date, ...extra } });
const loc = (lat, lng, acc = 10) => ({ location: { latitude: lat, longitude: lng, horizontal_accuracy: acc } });

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };

test('helpers', () => {
  assert.strictEqual(L.parseHHMM('8:30 PM'), 20 * 60 + 30);
  assert.strictEqual(L.parseHHMM('12:00 AM'), 0);
  assert.strictEqual(L.parseHHMM('07:05:00'), 425);
  assert.strictEqual(L.parseHHMM('abc'), null);
  assert.ok(L.worksOn('Mon-Fri', 'Wed'));
  assert.ok(!L.worksOn('Mon-Fri', 'Sat'));
  assert.ok(L.worksOn('Sat-Mon', 'Sun'));
  assert.ok(L.worksOn('mon, wed', 'Wed'));
  assert.ok(L.worksOn('', 'Sun'));
  assert.ok(Math.abs(L.haversineM(1.3, 103.8, 1.301, 103.8) - 111) < 2);
});

test('unregistered /start -> shows ID and alerts admin', () => {
  const o = L.processMessage(msg({ text: '/start' }), [], sites, t0810, cfg);
  assert.match(o.text, /111/);
  assert.strictEqual(o.keyboard, 'none');
  assert.strictEqual(o.alerts[0].chatId, '-1001');
});

test('group messages ignored', () => {
  const m = msg({ text: 'hi' }); m.message.chat.type = 'group';
  assert.strictEqual(L.processMessage(m, [baseGuard], sites, t0810, cfg), null);
});

test('Check In button -> sets pending, asks location', () => {
  const o = L.processMessage(msg({ text: L.BTN.IN }), [baseGuard], sites, t0810, cfg);
  assert.strictEqual(o.keyboard, 'location');
  assert.strictEqual(o.guardUpdate.Pending, `IN:${t0810}`);
});

test('location without pending action is refused', () => {
  const o = L.processMessage(msg(loc(1.3, 103.8)), [baseGuard], sites, t0810, cfg);
  assert.strictEqual(o.logRow, null);
  assert.match(o.text, /first/);
});

test('expired pending is refused', () => {
  const g = { ...baseGuard, Pending: `IN:${t0810 - 400}` };
  const o = L.processMessage(msg(loc(1.3, 103.8)), [g], sites, t0810, cfg);
  assert.strictEqual(o.logRow, null);
});

test('valid check-in on time (08:10, grace 15)', () => {
  const g = { ...baseGuard, Pending: `IN:${t0810 - 30}` };
  const o = L.processMessage(msg(loc(1.3005, 103.8)), [g], sites, t0810, cfg);
  assert.strictEqual(o.logRow.Action, 'IN');
  assert.strictEqual(o.logRow.WithinFence, 'YES');
  assert.strictEqual(o.logRow.Timestamp, '2026-11-18 08:10:00');
  assert.strictEqual(o.guardUpdate.Status, 'IN');
  assert.strictEqual(o.guardUpdate.LastCheckInTs, t0810);
  assert.strictEqual(o.alerts.length, 0);
});

test('late check-in flags and alerts supervisor + admin', () => {
  const t = t0810 + 20 * 60; // 08:30
  const g = { ...baseGuard, Pending: `IN:${t - 10}` };
  const o = L.processMessage(msg(loc(1.3, 103.8), t), [g], sites, t, cfg);
  assert.match(o.logRow.Flags, /LATE_30m/);
  assert.strictEqual(JSON.stringify(o.alerts.map(a => a.chatId)), '["-2002","-1001"]');
});

test('early check-in (07:30) is not late', () => {
  const t = t0810 - 40 * 60;
  const g = { ...baseGuard, Pending: `IN:${t}` };
  const o = L.processMessage(msg(loc(1.3, 103.8), t), [g], sites, t, cfg);
  assert.ok(!/LATE/.test(o.logRow.Flags));
});

test('outside geofence -> rejected, logged, status unchanged', () => {
  const g = { ...baseGuard, Pending: `IN:${t0810}` };
  const o = L.processMessage(msg(loc(1.31, 103.8)), [g], sites, t0810, cfg);
  assert.strictEqual(o.logRow.Action, 'IN_REJECTED');
  assert.strictEqual(o.guardUpdate, null);
  assert.strictEqual(o.keyboard, 'location');
  assert.ok(o.alerts.length > 0);
});

test('forwarded location rejected', () => {
  const g = { ...baseGuard, Pending: `IN:${t0810}` };
  const o = L.processMessage(msg({ ...loc(1.3, 103.8), forward_origin: { type: 'user' } }), [g], sites, t0810, cfg);
  assert.strictEqual(o.logRow, null);
});

test('missing GPS accuracy is flagged (possible map-picked location)', () => {
  const g = { ...baseGuard, Pending: `IN:${t0810}` };
  const o = L.processMessage(msg({ location: { latitude: 1.3, longitude: 103.8 } }), [g], sites, t0810, cfg);
  assert.match(o.logRow.Flags, /NO_GPS_ACCURACY/);
});

test('check-out computes hours and flags early leave', () => {
  const t = T('2026-11-18T10:00:00Z'); // 18:00 SGT, shift ends 20:00
  const g = { ...baseGuard, Status: 'IN', LastCheckInTs: String(t0810), LastCheckIn: '2026-11-18 08:10:00', Pending: `OUT:${t}` };
  const o = L.processMessage(msg(loc(1.3, 103.8), t), [g], sites, t, cfg);
  assert.strictEqual(o.logRow.Action, 'OUT');
  assert.strictEqual(o.logRow.HoursWorked, 9.83);
  assert.match(o.logRow.Flags, /EARLY_OUT_120m/);
  assert.strictEqual(o.guardUpdate.Status, 'OUT');
});

test('on-time check-out not early', () => {
  const t = T('2026-11-18T12:05:00Z'); // 20:05
  const g = { ...baseGuard, Status: 'IN', LastCheckInTs: String(t0810), Pending: `OUT:${t}` };
  const o = L.processMessage(msg(loc(1.3, 103.8), t), [g], sites, t, cfg);
  assert.ok(!/EARLY/.test(o.logRow.Flags));
});

test('overnight shift 20:00-08:00: late at 20:40, check-out 08:00 next day', () => {
  const night = { ...baseGuard, ShiftStart: '20:00', ShiftEnd: '08:00' };
  const tIn = T('2026-11-18T12:40:00Z'); // 20:40
  let o = L.processMessage(msg(loc(1.3, 103.8), tIn), [{ ...night, Pending: `IN:${tIn}` }], sites, tIn, cfg);
  assert.match(o.logRow.Flags, /LATE_40m/);
  const tOut = T('2026-11-19T00:00:00Z'); // 08:00
  o = L.processMessage(msg(loc(1.3, 103.8), tOut), [{ ...night, Status: 'IN', LastCheckInTs: tIn, Pending: `OUT:${tOut}` }], sites, tOut, cfg);
  assert.ok(!/EARLY/.test(o.logRow.Flags));
  assert.strictEqual(o.logRow.HoursWorked, 11.33);
});

test('Check Out when not checked in', () => {
  const o = L.processMessage(msg({ text: L.BTN.OUT }), [baseGuard], sites, t0810, cfg);
  assert.strictEqual(o.guardUpdate, null);
  assert.match(o.text, /not checked in/);
});

test('sheet quirks: numeric IDs with commas, empty rows', () => {
  const g = { ...baseGuard, TelegramID: '111' };
  const o = L.processMessage(msg({ text: L.BTN.STATUS }), [{}, { row_number: 3 }, g], sites, t0810, cfg);
  assert.match(o.text, /OFF DUTY/);
});

test('schedule: no-show alerted once, not on day off', () => {
  const t = T('2026-11-18T00:30:00Z'); // Wed 08:30
  let r = L.checkShifts([baseGuard], sites, t, cfg, {});
  assert.strictEqual(r.messages.length, 3); // guard + supervisor + admin
  const again = L.checkShifts([baseGuard], sites, t + 900, cfg, r.sent);
  assert.strictEqual(again.messages.length, 0);
  r = L.checkShifts([{ ...baseGuard, WorkDays: 'Mon,Tue' }], sites, t, cfg, {});
  assert.strictEqual(r.messages.length, 0);
});

test('schedule: guard who checked in early is not a no-show', () => {
  const t = T('2026-11-18T00:30:00Z');
  const g = { ...baseGuard, Status: 'IN', LastCheckInTs: T('2026-11-17T23:50:00Z') };
  assert.strictEqual(L.checkShifts([g], sites, t, cfg, {}).messages.length, 0);
});

test('schedule: overnight shift uses the day the shift started', () => {
  const night = { ...baseGuard, ShiftStart: '22:00', ShiftEnd: '06:00', WorkDays: 'Wed' };
  const t = T('2026-11-18T16:30:00Z'); // Thu 00:30 SGT, shift started Wed 22:00
  assert.ok(L.checkShifts([night], sites, t, cfg, {}).messages.length > 0);
});

test('schedule: forgot check-out', () => {
  const t = T('2026-11-18T15:00:00Z'); // 23:00, checked in 08:10, 12h shift + 2h
  const g = { ...baseGuard, Status: 'IN', LastCheckInTs: t0810, LastCheckIn: '2026-11-18 08:10:00' };
  const r = L.checkShifts([g], sites, t, cfg, {});
  assert.ok(r.messages.some(m => /forgot/i.test(m.text)));
});

console.log(`\n${pass} tests passed`);
