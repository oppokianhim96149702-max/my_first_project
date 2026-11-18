// ---------- shared helpers ----------
const BTN = {
  IN: '🟢 Check In',
  OUT: '🔴 Check Out',
  STATUS: '📋 My Status',
  CANCEL: '❌ Cancel',
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normId(v) {
  return String(v ?? '').replace(/[^\d-]/g, '');
}

function toNum(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isActive(v) {
  return !/^(no|n|false|0|inactive)$/i.test(String(v ?? '').trim());
}

// "08:00", "8:00:00", "8:00 PM", "20.00" -> minutes after midnight
function parseHHMM(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    const pm = /^p/i.test(m[3]);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fmtHHMM(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function localParts(tsSec, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(tsSec * 1000));
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return { date, time, stamp: `${date} ${time}`, minutes: +p.hour * 60 + +p.minute, weekday: p.weekday };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// WorkDays: blank = every day; "Mon,Wed,Fri" or "Mon-Fri" or "Sat-Mon"
function worksOn(workDays, weekday) {
  const s = String(workDays ?? '').trim();
  if (!s) return true;
  const target = DAYS.indexOf(weekday.slice(0, 3));
  for (const tok of s.split(/[,\s]+/).filter(Boolean)) {
    const [a, b] = tok.split('-').map(t => DAYS.findIndex(d => d.toLowerCase() === t.slice(0, 3).toLowerCase()));
    if (a < 0) continue;
    if (b === undefined) { if (a === target) return true; continue; }
    if (b < 0) continue;
    for (let i = a, n = 0; n < 7; i = (i + 1) % 7, n++) {
      if (i === target) return true;
      if (i === b) break;
    }
  }
  return false;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// minutes since the most recent occurrence of `startMin` (0..1439)
function minsSince(nowMin, startMin) {
  return (nowMin - startMin + 1440) % 1440;
}

function shiftInfo(guard) {
  const start = parseHHMM(guard.ShiftStart);
  const end = parseHHMM(guard.ShiftEnd);
  if (start === null) return null;
  const len = end === null ? 720 : ((end - start + 1440) % 1440 || 1440);
  return { start, end: end === null ? (start + len) % 1440 : end, len };
}

function cleanRows(rows) {
  return (rows || []).filter(r => r && Object.keys(r).some(k => k !== 'row_number' && String(r[k] ?? '').trim() !== ''));
}

function supervisorsFor(site, cfg) {
  const ids = [normId(site && site.SupervisorChatID), normId(cfg.ADMIN_CHAT_ID)].filter(Boolean);
  return [...new Set(ids)];
}

// ---------- main: handle one Telegram update ----------
function processMessage(update, guardRows, siteRows, nowSec, cfg) {
  const msg = update && update.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.from) return null;

  const chatId = msg.chat.id;
  const fromId = normId(msg.from.id);
  const guards = cleanRows(guardRows);
  const sites = cleanRows(siteRows);
  const guard = guards.find(g => normId(g.TelegramID) === fromId);
  const text = (msg.text || '').trim();
  const now = localParts(nowSec, cfg.TIMEZONE);
  const out = { chatId, text: '', keyboard: 'menu', logRow: null, guardUpdate: null, alerts: [] };
  const reply = (t, kb = 'menu') => Object.assign(out, { text: t, keyboard: kb });
  const alertTo = (ids, t) => ids.forEach(id => out.alerts.push({ chatId: id, text: t }));

  if (!guard) {
    reply(`You are not registered yet.\n\nYour Telegram ID is <code>${fromId}</code>.\nSend this number to your supervisor so they can add you.`, 'none');
    if (/^\/start/.test(text)) {
      const who = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
      alertTo(supervisorsFor(null, cfg),
        `🆕 Registration request\nName: ${esc(who)}${msg.from.username ? ' (@' + esc(msg.from.username) + ')' : ''}\nTelegram ID: <code>${fromId}</code>\nAdd this ID to the Guards sheet to activate.`);
    }
    return out;
  }

  const name = esc(guard.Name || fromId);
  if (!isActive(guard.Active)) return reply('Your account is deactivated. Please contact your supervisor.', 'none');

  const site = sites.find(s => String(s.SiteID).trim() === String(guard.SiteID).trim());
  const siteLat = toNum(site && site.Latitude), siteLng = toNum(site && site.Longitude);
  if (!site || siteLat === null || siteLng === null) {
    alertTo(supervisorsFor(null, cfg), `⚙️ Setup problem: guard ${name} has SiteID "${esc(guard.SiteID)}" which is missing or has no coordinates in the Sites sheet.`);
    return reply('Your site is not set up correctly. Your supervisor has been notified.', 'none');
  }
  const siteName = esc(site.SiteName || site.SiteID);
  const sups = supervisorsFor(site, cfg);
  const isIn = String(guard.Status || '').trim().toUpperCase() === 'IN';
  const lastInTs = toNum(guard.LastCheckInTs);
  const shift = shiftInfo(guard);

  if (/^\/(start|help|id)/.test(text) && !msg.location) {
    return reply(`Hi ${name} 👋\nSite: <b>${siteName}</b>${shift ? `\nShift: ${fmtHHMM(shift.start)}–${fmtHHMM(shift.end)}` : ''}\n\nUse the buttons below to check in and out.`);
  }

  if (text === BTN.IN || text === BTN.OUT) {
    const action = text === BTN.IN ? 'IN' : 'OUT';
    if (action === 'IN' && isIn) return reply(`You are already checked in since ${esc(guard.LastCheckIn)}.`);
    if (action === 'OUT' && !isIn) return reply('You are not checked in.');
    out.guardUpdate = { TelegramID: guard.TelegramID, Pending: `${action}:${nowSec}` };
    return reply(`Tap <b>📍 Share Location</b> below to check ${action.toLowerCase()} at <b>${siteName}</b>.\n(You have ${Math.round(cfg.PENDING_TTL_SEC / 60)} minutes.)`, 'location');
  }

  if (text === BTN.CANCEL) {
    out.guardUpdate = { TelegramID: guard.TelegramID, Pending: '' };
    return reply('Cancelled.');
  }

  if (text === BTN.STATUS) {
    const hrs = isIn && lastInTs ? ` (${((nowSec - lastInTs) / 3600).toFixed(1)} h)` : '';
    return reply(`👤 ${name}\n📍 ${siteName}\nStatus: <b>${isIn ? 'ON DUTY' : 'OFF DUTY'}</b>${isIn ? `\nSince: ${esc(guard.LastCheckIn)}${hrs}` : ''}${shift ? `\nShift: ${fmtHHMM(shift.start)}–${fmtHHMM(shift.end)}` : ''}`);
  }

  if (msg.location) {
    if (msg.forward_origin || msg.forward_date || msg.forward_from) return reply('❌ Forwarded locations are not accepted. Use the 📍 Share Location button.');
    if (msg.venue) return reply('❌ Venue/place locations are not accepted. Use the 📍 Share Location button.');

    const [pAction, pTs] = String(guard.Pending || '').split(':');
    if (!['IN', 'OUT'].includes(pAction) || nowSec - (+pTs || 0) > cfg.PENDING_TTL_SEC) {
      return reply(`Tap <b>${BTN.IN}</b> or <b>${BTN.OUT}</b> first, then share your location.`);
    }
    if (pAction === 'IN' && isIn) return reply('You are already checked in.');
    if (pAction === 'OUT' && !isIn) return reply('You are not checked in.');

    const { latitude: lat, longitude: lng, horizontal_accuracy: acc } = msg.location;
    const radius = toNum(site.RadiusM) || 150;
    const dist = Math.round(haversineM(lat, lng, siteLat, siteLng));
    const within = dist <= radius;
    const flags = [];
    if (acc === undefined) flags.push('NO_GPS_ACCURACY');
    else if (acc > cfg.LOW_ACCURACY_M) flags.push(`LOW_ACCURACY_${Math.round(acc)}m`);
    if (msg.date && nowSec - msg.date > 120) flags.push('DELAYED_MESSAGE');
    if (!within) flags.push('OUTSIDE_FENCE');

    const row = {
      Timestamp: now.stamp, Date: now.date, TelegramID: guard.TelegramID, Name: guard.Name || '',
      SiteID: site.SiteID, SiteName: site.SiteName || '', Action: pAction,
      Latitude: lat, Longitude: lng, DistanceM: dist, AccuracyM: acc === undefined ? '' : Math.round(acc),
      WithinFence: within ? 'YES' : 'NO', HoursWorked: '', Flags: '',
    };

    if (!within && cfg.STRICT_GEOFENCE) {
      row.Action = `${pAction}_REJECTED`;
      row.Flags = flags.join(' ');
      out.logRow = row;
      alertTo(sups, `⛔ ${name} tried to check ${pAction.toLowerCase()} at ${siteName} but is <b>${dist} m</b> away (allowed ${radius} m).`);
      return reply(`❌ Check-${pAction.toLowerCase()} rejected.\nYou are <b>${dist} m</b> from ${siteName} (allowed ${radius} m).\nMove closer and tap 📍 Share Location again.`, 'location');
    }

    if (pAction === 'IN') {
      let lateNote = '';
      if (shift) {
        const late = minsSince(now.minutes, shift.start);
        if (late > cfg.GRACE_MIN && late < shift.len) {
          flags.push(`LATE_${late}m`);
          lateNote = `\n⚠️ You are ${late} min late (shift starts ${fmtHHMM(shift.start)}).`;
          alertTo(sups, `⏰ ${name} checked in <b>${late} min late</b> at ${siteName} (shift ${fmtHHMM(shift.start)}).`);
        }
      }
      row.Flags = flags.join(' ');
      out.logRow = row;
      out.guardUpdate = { TelegramID: guard.TelegramID, Status: 'IN', LastCheckIn: now.stamp, LastCheckInTs: nowSec, Pending: '' };
      if (!within) alertTo(sups, `⚠️ ${name} checked in ${dist} m outside ${siteName} (geofence not enforced).`);
      return reply(`✅ Checked in at <b>${siteName}</b>\n🕒 ${now.time}\n📏 ${dist} m from site${lateNote}`);
    }

    // OUT
    const hours = lastInTs ? Math.round((nowSec - lastInTs) / 36) / 100 : '';
    let earlyNote = '';
    if (shift && lastInTs && nowSec - lastInTs < shift.len * 60) {
      const early = minsSince(shift.end, now.minutes); // minutes until shift end
      if (early > cfg.GRACE_MIN && early < shift.len) {
        flags.push(`EARLY_OUT_${early}m`);
        earlyNote = `\n⚠️ ${early} min before shift end (${fmtHHMM(shift.end)}).`;
        alertTo(sups, `🚪 ${name} checked out <b>${early} min early</b> at ${siteName} (shift ends ${fmtHHMM(shift.end)}).`);
      }
    }
    row.HoursWorked = hours;
    row.Flags = flags.join(' ');
    out.logRow = row;
    out.guardUpdate = { TelegramID: guard.TelegramID, Status: 'OUT', Pending: '' };
    return reply(`👋 Checked out from <b>${siteName}</b>\n🕒 ${now.time}${hours !== '' ? `\n⏱ ${hours} h worked` : ''}${earlyNote}`);
  }

  return reply('Use the buttons below 👇');
}

// ---------- scheduled: no-shows & forgotten check-outs ----------
function checkShifts(guardRows, siteRows, nowSec, cfg, sent) {
  sent = Object.assign({}, sent || {});
  const messages = [];
  const sites = cleanRows(siteRows);
  const now = localParts(nowSec, cfg.TIMEZONE);

  for (const g of cleanRows(guardRows)) {
    if (!isActive(g.Active) || !normId(g.TelegramID)) continue;
    const shift = shiftInfo(g);
    if (!shift) continue;
    const site = sites.find(s => String(s.SiteID).trim() === String(g.SiteID).trim());
    const sups = supervisorsFor(site, cfg);
    const name = esc(g.Name || g.TelegramID);
    const siteName = esc(site ? (site.SiteName || site.SiteID) : g.SiteID);
    const isIn = String(g.Status || '').trim().toUpperCase() === 'IN';
    const lastInTs = toNum(g.LastCheckInTs);

    const since = minsSince(now.minutes, shift.start);
    const shiftStartTs = nowSec - since * 60 - (nowSec % 60);
    const shiftDay = localParts(shiftStartTs, cfg.TIMEZONE);

    // no-show
    if (!isIn && since > cfg.GRACE_MIN && since < shift.len && worksOn(g.WorkDays, shiftDay.weekday)) {
      const checkedInThisShift = lastInTs && lastInTs >= shiftStartTs - cfg.EARLY_CHECKIN_MIN * 60;
      const key = `miss:${normId(g.TelegramID)}:${shiftDay.date}`;
      if (!checkedInThisShift && !sent[key]) {
        sent[key] = nowSec;
        messages.push({ chatId: normId(g.TelegramID), text: `⚠️ You have not checked in for your ${fmtHHMM(shift.start)} shift at ${siteName}. Please check in now.` });
        sups.forEach(id => messages.push({ chatId: id, text: `🚨 <b>NO-SHOW</b>: ${name} at ${siteName}\nShift ${fmtHHMM(shift.start)}, ${since} min ago — not checked in.` }));
      }
    }

    // forgot to check out
    if (isIn && lastInTs && nowSec - lastInTs > (shift.len + cfg.FORGOT_CHECKOUT_MIN) * 60) {
      const key = `forgot:${normId(g.TelegramID)}:${lastInTs}`;
      if (!sent[key]) {
        sent[key] = nowSec;
        const h = ((nowSec - lastInTs) / 3600).toFixed(1);
        messages.push({ chatId: normId(g.TelegramID), text: `⚠️ You are still checked in (${h} h). Did you forget to check out?` });
        sups.forEach(id => messages.push({ chatId: id, text: `❓ ${name} at ${siteName} has been checked in for <b>${h} h</b> (since ${esc(g.LastCheckIn)}). Possibly forgot to check out.` }));
      }
    }
  }

  for (const k of Object.keys(sent)) if (nowSec - sent[k] > 3 * 86400) delete sent[k];
  return { messages, sent };
}
