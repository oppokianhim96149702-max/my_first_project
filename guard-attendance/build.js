// Builds dist/guard-attendance.workflow.json from src/*.js
// Usage: node build.js [GOOGLE_SHEET_ID]
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.argv[2] || 'YOUR_GOOGLE_SHEET_ID';
const read = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const header = read('config.js') + '\n' + read('lib.js') + '\n// ---------- n8n glue ----------\n';

let n = 0;
const id = () => `node-${++n}`;
const pos = (x, y) => [x * 220, y * 180];

const sheet = (name, sheetName, p, extra = {}) => ({
  id: id(), name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: p,
  parameters: {
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: sheetName, mode: 'name' },
    ...extra.parameters,
    options: {},
  },
  ...(extra.node || {}),
});

const readSheet = (name, sheetName, p, once) =>
  sheet(name, sheetName, p, { parameters: { operation: 'read' }, node: { alwaysOutputData: true, ...(once ? { executeOnce: true } : {}) } });

const code = (name, js, p) => ({
  id: id(), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: p,
  parameters: { mode: 'runOnceForAllItems', jsCode: js },
});

const tgSend = (name, p, keyboard) => ({
  id: id(), name, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: p,
  parameters: {
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.text }}',
    ...(keyboard ? { replyMarkup: 'replyKeyboard', replyKeyboard: keyboard, replyKeyboardOptions: { resize_keyboard: true } } : {}),
    additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
  },
  // keep sending other messages if one recipient has blocked the bot
  onError: 'continueRegularOutput',
});

const kbRow = (...buttons) => ({ row: { buttons } });
const MENU_KB = { rows: [kbRow({ text: '🟢 Check In' }, { text: '🔴 Check Out' }), kbRow({ text: '📋 My Status' })] };
const LOC_KB = { rows: [kbRow({ text: '📍 Share Location', additionalFields: { request_location: true } }), kbRow({ text: '❌ Cancel' })] };

const filterKb = kb => `return $input.all().filter(i => i.json.keyboard === '${kb}').map(i => ({ json: { chatId: i.json.chatId, text: i.json.text } }));`;

// ---------- Branch 1: Telegram bot ----------
const trigger = {
  id: id(), name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.1, position: pos(0, 1),
  parameters: { updates: ['message'], additionalFields: {} }, webhookId: 'guard-attendance-bot',
};
const readGuards = readSheet('Read Guards', 'Guards', pos(1, 1));
const readSites = readSheet('Read Sites', 'Sites', pos(2, 1), true);
const processNode = code('Process Message', header + `
const update = $('Telegram Trigger').first().json;
const guards = $('Read Guards').all().map(i => i.json);
const sites = $('Read Sites').all().map(i => i.json);
const out = processMessage(update, guards, sites, Math.floor(Date.now() / 1000), CONFIG);
return out ? [{ json: out }] : [];
`, pos(3, 1));

const fMenu = code('Only Menu Replies', filterKb('menu'), pos(4, -0.5));
const fLoc = code('Only Location Requests', filterKb('location'), pos(4, 0.3));
const fNone = code('Only Plain Replies', filterKb('none'), pos(4, 1.1));
const sMenu = tgSend('Reply + Menu', pos(5, -0.5), MENU_KB);
const sLoc = tgSend('Reply + Ask Location', pos(5, 0.3), LOC_KB);
const sNone = tgSend('Reply (no keyboard)', pos(5, 1.1), null);
sNone.parameters.replyMarkup = 'replyKeyboardRemove';
sNone.parameters.replyKeyboardRemove = { remove_keyboard: true };

const fLog = code('Attendance Row', `const o = $input.first().json;\nreturn o.logRow ? [{ json: o.logRow }] : [];`, pos(4, 2));
const appendLog = sheet('Append Attendance', 'Attendance', pos(5, 2), {
  parameters: { operation: 'append', columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] } },
});
const fGuard = code('Guard Update Row', `const o = $input.first().json;\nreturn o.guardUpdate ? [{ json: o.guardUpdate }] : [];`, pos(4, 2.8));
const updateGuard = sheet('Update Guard', 'Guards', pos(5, 2.8), {
  parameters: { operation: 'update', columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['TelegramID'], schema: [] } },
});
const fAlerts = code('Alert Messages', `return ($input.first().json.alerts || []).map(a => ({ json: a }));`, pos(4, 3.6));
const sAlerts = tgSend('Send Alerts', pos(5, 3.6), null);

// ---------- Branch 2: every 15 min, no-show / forgot check-out ----------
const sched = {
  id: id(), name: 'Every 15 Minutes', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: pos(0, 5),
  parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
};
const readGuards2 = readSheet('Read Guards (schedule)', 'Guards', pos(1, 5));
const readSites2 = readSheet('Read Sites (schedule)', 'Sites', pos(2, 5), true);
const checkNode = code('Check Shifts', header + `
const store = $getWorkflowStaticData('global');
const guards = $('Read Guards (schedule)').all().map(i => i.json);
const sites = $('Read Sites (schedule)').all().map(i => i.json);
const { messages, sent } = checkShifts(guards, sites, Math.floor(Date.now() / 1000), CONFIG, store.sent);
store.sent = sent; // remembers which alerts were already sent (only saved when the workflow is active)
return messages.map(m => ({ json: m }));
`, pos(3, 5));
const sShift = tgSend('Send Shift Alerts', pos(4, 5), null);

const nodes = [trigger, readGuards, readSites, processNode, fMenu, fLoc, fNone, sMenu, sLoc, sNone,
  fLog, appendLog, fGuard, updateGuard, fAlerts, sAlerts, sched, readGuards2, readSites2, checkNode, sShift];

const link = (...targets) => ({ main: [targets.map(t => ({ node: t.name, type: 'main', index: 0 }))] });
const connections = {
  [trigger.name]: link(readGuards),
  [readGuards.name]: link(readSites),
  [readSites.name]: link(processNode),
  [processNode.name]: link(fMenu, fLoc, fNone, fLog, fGuard, fAlerts),
  [fMenu.name]: link(sMenu),
  [fLoc.name]: link(sLoc),
  [fNone.name]: link(sNone),
  [fLog.name]: link(appendLog),
  [fGuard.name]: link(updateGuard),
  [fAlerts.name]: link(sAlerts),
  [sched.name]: link(readGuards2),
  [readGuards2.name]: link(readSites2),
  [readSites2.name]: link(checkNode),
  [checkNode.name]: link(sShift),
};

const workflow = { name: 'Guard Attendance (Telegram + Google Sheets)', nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
const outFile = path.join(__dirname, 'dist', 'guard-attendance.workflow.json');
fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2));
console.log(`Wrote ${outFile} (${nodes.length} nodes, sheet id: ${SHEET_ID})`);
