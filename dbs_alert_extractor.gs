/**
 * DBS iBanking Alert - Amount Extractor
 *
 * Searches Gmail for emails from ibanking.alert@dbs.com and extracts
 * transaction amounts. Results are written to the active Google Sheet.
 *
 * Usage:
 *   1. Open a Google Sheet
 *   2. Go to Extensions > Apps Script, paste this file
 *   3. Run extractDbsAlerts() or use the custom menu
 */

var SENDER = "ibanking.alert@dbs.com";

// -------------------------------------------------------------------
// Entry point – run this function
// -------------------------------------------------------------------
function extractDbsAlerts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("DBS Alerts") || ss.insertSheet("DBS Alerts");

  // Write header row if the sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Date", "Subject", "Transaction Type", "Amount (SGD)", "Account / Card", "Raw Snippet"]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  }

  var rows = fetchAndParse();

  if (rows.length === 0) {
    SpreadsheetApp.getUi().alert("No DBS alert emails found.");
    return;
  }

  rows.forEach(function (r) { sheet.appendRow(r); });

  SpreadsheetApp.getUi().alert(
    "Done! Extracted " + rows.length + " transaction(s) into the \"DBS Alerts\" sheet."
  );
}

// -------------------------------------------------------------------
// Core: fetch emails and return parsed rows
// -------------------------------------------------------------------
function fetchAndParse() {
  // Search for all emails from the DBS sender (adjust date range as needed)
  var query = "from:" + SENDER;
  var threads = GmailApp.search(query, 0, 500); // up to 500 threads
  var rows = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var date    = msg.getDate();
      var subject = msg.getSubject();
      var body    = msg.getPlainBody() || stripHtml(msg.getBody());

      var parsed = parseBody(body);
      parsed.forEach(function (p) {
        rows.push([
          Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
          subject,
          p.type,
          p.amount,
          p.account,
          p.snippet
        ]);
      });
    });
  });

  return rows;
}

// -------------------------------------------------------------------
// Parser: extract amounts from a single email body
// -------------------------------------------------------------------
function parseBody(body) {
  var results = [];

  // Patterns ordered from most-specific to least-specific.
  // DBS alert emails vary slightly by alert type; these cover the
  // common formats observed in DBS PayNow, FAST, card, and ATM alerts.
  var patterns = [
    // e.g.  "Withdrawal of SGD1,234.56"
    // e.g.  "Deposit of SGD 500.00"
    {
      re: /(withdrawal|deposit|transfer|payment|debit|credit|purchase|refund|reversal)\s+of\s+SGD\s?([\d,]+\.?\d*)/gi,
      typeGroup: 1, amountGroup: 2
    },
    // e.g.  "SGD 1,234.56 has been debited"
    // e.g.  "SGD1,234.56 credited"
    {
      re: /SGD\s?([\d,]+\.?\d*)\s+(?:has been\s+)?(debited|credited|transferred|withdrawn|deposited)/gi,
      typeGroup: 2, amountGroup: 1
    },
    // e.g.  "Amount: SGD 999.00"
    // e.g.  "Transaction Amount SGD1,000.00"
    {
      re: /(?:amount[:\s]+)SGD\s?([\d,]+\.?\d*)/gi,
      typeGroup: null, amountGroup: 1
    },
    // Fallback: any bare SGD figure in the message
    {
      re: /SGD\s?([\d,]+\.?\d*)/gi,
      typeGroup: null, amountGroup: 1
    }
  ];

  var matched = false;

  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    var m;
    p.re.lastIndex = 0;

    while ((m = p.re.exec(body)) !== null) {
      var type    = p.typeGroup !== null ? capitalize(m[p.typeGroup]) : inferType(body);
      var amount  = parseFloat(m[p.amountGroup].replace(/,/g, ""));
      var account = extractAccount(body);
      var snippet = body.substring(Math.max(0, m.index - 40), m.index + 80)
                        .replace(/\s+/g, " ").trim();

      // Avoid duplicate entries from overlapping patterns
      if (!isDuplicate(results, amount)) {
        results.push({ type: type, amount: amount, account: account, snippet: snippet });
        matched = true;
      }
    }

    if (matched) break; // stop at the first pattern family that yields results
  }

  return results;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function extractAccount(body) {
  // Card number ending / account number
  var patterns = [
    /card\s+(?:ending|no\.?|number)[:\s]+[xX*]+(\d{4})/i,
    /account\s+(?:no\.?|number)[:\s]+[xX*-]+(\d{4,})/i,
    /a\/c\s+(?:no\.?)?[:\s]+[xX*-]+(\d{4,})/i,
    /\*{3,}(\d{4})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = body.match(patterns[i]);
    if (m) return "****" + m[1];
  }
  return "";
}

function inferType(body) {
  var lower = body.toLowerCase();
  if (/debit|withdraw|purchase|spent/.test(lower)) return "Debit";
  if (/credit|deposit|received/.test(lower))        return "Credit";
  if (/transfer/.test(lower))                        return "Transfer";
  return "Transaction";
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function isDuplicate(results, amount) {
  return results.some(function (r) { return r.amount === amount; });
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

// -------------------------------------------------------------------
// Optional: add a custom menu when the spreadsheet opens
// -------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DBS Tools")
    .addItem("Extract Alert Amounts", "extractDbsAlerts")
    .addToUi();
}

// -------------------------------------------------------------------
// Optional: scheduled trigger – run daily at 8 AM
// Call installDailyTrigger() once from the script editor to set it up
// -------------------------------------------------------------------
function installDailyTrigger() {
  // Remove any existing triggers for this function first
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "extractDbsAlerts") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("extractDbsAlerts")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  SpreadsheetApp.getUi().alert("Daily trigger installed — runs every day at 8 AM.");
}
