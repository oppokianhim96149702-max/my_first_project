var SENDER = "ibanking.alert@dbs.com";

function extractDbsAlerts() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("DBS Alerts") || ss.insertSheet("DBS Alerts");

  sheet.clearContents();

  var headers = ["Date & Time", "Type", "Amount (SGD)", "From", "To", "A/C Ending"];
  sheet.appendRow(headers);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#4a86e8");
  headerRange.setFontColor("#ffffff");

  var rows = fetchAndParse();

  if (rows.length === 0) {
    SpreadsheetApp.getUi().alert("No DBS alert emails found.");
    return;
  }

  rows.forEach(function (r) { sheet.appendRow(r); });

  // Auto-resize all columns
  sheet.autoResizeColumns(1, headers.length);

  SpreadsheetApp.getUi().alert("Done! Extracted " + rows.length + " transaction(s).");
}

function fetchAndParse() {
  var threads = GmailApp.search("from:" + SENDER, 0, 500);
  var rows = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var date = msg.getDate();
      var body = msg.getPlainBody() || stripHtml(msg.getBody());

      var parsed = parseBody(body, date);
      if (parsed) rows.push(parsed);
    });
  });

  // Sort newest first
  rows.sort(function (a, b) { return new Date(b[0]) - new Date(a[0]); });
  return rows;
}

function parseBody(body, date) {
  // Normalise whitespace
  body = body.replace(/\s+/g, " ").trim();

  // Extract amount: "Amount: SGD 3.40" or "Amount: SGD3.40"
  var amountMatch = body.match(/Amount\s*:\s*SGD\s*([\d,]+\.?\d*)/i);
  if (!amountMatch) return null;
  var amount = parseFloat(amountMatch[1].replace(/,/g, ""));

  // Extract From
  var fromMatch = body.match(/From\s*:\s*([^T]+?)(?=\s+To\s*:|$)/i);
  var from = fromMatch ? fromMatch[1].trim() : "";

  // Extract To
  var toMatch = body.match(/To\s*:\s*([^\n\r]+?)(?=\s+(?:Date|Reference|$))/i);
  var to = toMatch ? toMatch[1].trim() : "";

  // Extract A/C ending — "A/C ending 8520" or "ending in 1234"
  var acMatch = body.match(/(?:A\/C\s+ending|ending\s+in|ending)\s+(\d{4,})/i);
  var ac = acMatch ? "****" + acMatch[1] : "";

  // Determine type
  var type = inferType(body, from, to);

  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");

  return [dateStr, type, amount, from, to, ac];
}

function inferType(body, from, to) {
  var lower = body.toLowerCase();

  // PayNow / FAST / bank transfer
  if (/paynow|fast transfer|fund transfer/.test(lower)) {
    if (from && /posb|dbs/i.test(from)) return "Transfer Out";
    if (to   && /posb|dbs/i.test(to))   return "Transfer In";
    return "Transfer";
  }

  // Card spend
  if (/card.*(?:debit|payment|purchase|spent)|merchant/i.test(lower)) return "Card Debit";

  // Credit
  if (/credit|deposit|received|incoming/.test(lower)) return "Credit";

  // Debit / withdrawal
  if (/debit|withdraw|payment|spent/.test(lower)) return "Debit";

  // Fall back: if From contains user's bank → money going out
  if (from && /posb|dbs/i.test(from)) return "Debit";
  if (to   && /posb|dbs/i.test(to))   return "Credit";

  return "Transaction";
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DBS Tools")
    .addItem("Extract Alert Amounts", "extractDbsAlerts")
    .addToUi();
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "extractDbsAlerts") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("extractDbsAlerts").timeBased().everyDays(1).atHour(8).create();
  SpreadsheetApp.getUi().alert("Daily trigger installed — runs every day at 8 AM.");
}
