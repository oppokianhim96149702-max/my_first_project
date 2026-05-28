var SENDER  = "ibanking.alert@dbs.com";
var DAYS    = 2;    // only last 2 days
var MAX_TH  = 100;  // reduce if still timing out

function extractDbsAlerts() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("DBS Alerts") || ss.insertSheet("DBS Alerts");

  sheet.clearContents();

  var headers = ["Date & Time", "Type", "Amount (SGD)", "From", "To", "A/C Ending"];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length)
       .setFontWeight("bold")
       .setBackground("#4a86e8")
       .setFontColor("#ffffff");

  var since    = new Date();
  since.setDate(since.getDate() - DAYS);
  var afterStr = Utilities.formatDate(since, "GMT", "yyyy/MM/dd");
  var query    = "from:" + SENDER + " after:" + afterStr;

  var threads  = GmailApp.search(query, 0, MAX_TH);
  if (threads.length === 0) {
    notify("No DBS alert emails found in the last " + DAYS + " days.");
    return;
  }

  // Batch-fetch ALL messages in one API call instead of one-by-one
  var allThreadMessages = GmailApp.getMessagesForThreads(threads);
  var data = [];

  allThreadMessages.forEach(function (threadMsgs) {
    threadMsgs.forEach(function (msg) {
      var body   = msg.getPlainBody() || stripHtml(msg.getBody());
      var parsed = parseBody(body, msg.getDate());
      if (parsed) data.push(parsed);
    });
  });

  if (data.length === 0) {
    notify("Emails found but no SGD amounts could be extracted.");
    return;
  }

  data.sort(function (a, b) { return new Date(b[0]) - new Date(a[0]); });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  sheet.autoResizeColumns(1, headers.length);

  notify("Done! Extracted " + data.length + " transaction(s) from the last " + DAYS + " days.");
}

function parseBody(body, date) {
  body = body.replace(/\s+/g, " ").trim();

  var amountMatch = body.match(/Amount\s*:\s*SGD\s*([\d,]+\.?\d*)/i);
  if (!amountMatch) return null;
  var amount = parseFloat(amountMatch[1].replace(/,/g, ""));

  var fromMatch = body.match(/From\s*:\s*(.+?)(?=\s+To\s*:)/i);
  var from = fromMatch ? fromMatch[1].trim() : "";

  var toMatch = body.match(/To\s*:\s*(.+?)(?=\s+(?:Date|Reference|Remarks|SGD|$))/i);
  var to = toMatch ? toMatch[1].trim() : "";

  var acMatch = body.match(/(?:A\/C\s+ending|ending\s+in|ending)\s+(\d{4,})/i);
  var ac = acMatch ? "****" + acMatch[1] : "";

  var type    = inferType(body, from, to);
  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");

  return [dateStr, type, amount, from, to, ac];
}

function inferType(body, from, to) {
  var lower = body.toLowerCase();
  if (/paynow|fast transfer|fund transfer/.test(lower)) {
    if (/posb|dbs/i.test(from)) return "Transfer Out";
    if (/posb|dbs/i.test(to))   return "Transfer In";
    return "Transfer";
  }
  if (/card.*(?:debit|payment|purchase|spent)|merchant/i.test(lower)) return "Card Debit";
  if (/credit|deposit|received|incoming/.test(lower)) return "Credit";
  if (/debit|withdraw|payment|spent/.test(lower))     return "Debit";
  if (/posb|dbs/i.test(from)) return "Debit";
  if (/posb|dbs/i.test(to))   return "Credit";
  return "Transaction";
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

// -------------------------------------------------------------------
// Clean column F: remove all text BEFORE "bbb" in every data row
// -------------------------------------------------------------------
function cleanColumnFBeforeBbb() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName("DBS Alerts") || ss.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    notify("No data rows found in the sheet.");
    return;
  }

  var range   = sheet.getRange(2, 6, lastRow - 1, 1); // column F, rows 2 to last
  var values  = range.getValues();
  var keyword = "bbb";
  var count   = 0;

  var updated = values.map(function (row) {
    var cell = row[0] !== null && row[0] !== undefined ? String(row[0]) : "";
    var idx  = cell.indexOf(keyword);
    if (idx > 0) {
      count++;
      return [cell.substring(idx)];
    }
    return [cell];
  });

  range.setValues(updated);
  notify('Done! Removed text before "' + keyword + '" in ' + count + ' cell(s) in column F.');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DBS Tools")
    .addItem("Extract Alert Amounts",        "extractDbsAlerts")
    .addItem("Clean Col F (remove pre-bbb)", "cleanColumnFBeforeBbb")
    .addToUi();
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "extractDbsAlerts") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("extractDbsAlerts").timeBased().everyDays(1).atHour(8).create();
  notify("Daily trigger installed — runs every day at 8 AM.");
}

// Safe alert: works both from spreadsheet UI and from triggers/script editor
function notify(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) {}
}
