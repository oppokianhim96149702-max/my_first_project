function sendDailyOTSummary() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Daily_OT");
  if (!sheet) {
    Logger.log("Sheet 'Daily_OT' not found.");
    return;
  }

  // Extract M1, M2, M3 (values) and N1, N2, N3 (labels)
  var m1 = sheet.getRange("M1").getValue();
  var m2 = sheet.getRange("M2").getValue();
  var m3 = sheet.getRange("M3").getValue();

  var n1 = sheet.getRange("N1").getValue();
  var n2 = sheet.getRange("N2").getValue();
  var n3 = sheet.getRange("N3").getValue();

  var recipient = "oppokianhim96149702@gmail.com";
  var subject = "Daily OT Summary - " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  var body = "Daily OT Summary\n"
    + "================\n\n"
    + (n1 || "M1") + ": " + m1 + "\n"
    + (n2 || "M2") + ": " + m2 + "\n"
    + (n3 || "M3") + ": " + m3 + "\n\n"
    + "Sent from Google Sheets: Daily_OT";

  var htmlBody = "<h2>Daily OT Summary</h2>"
    + "<table style='border-collapse:collapse; font-family:Arial, sans-serif;'>"
    + "<tr><th style='border:1px solid #ccc; padding:8px; background:#f9f9f9;'>Label</th>"
    + "<th style='border:1px solid #ccc; padding:8px; background:#f9f9f9;'>Value</th></tr>"
    + "<tr><td style='border:1px solid #ccc; padding:8px;'>" + (n1 || "M1") + "</td><td style='border:1px solid #ccc; padding:8px;'>" + m1 + "</td></tr>"
    + "<tr><td style='border:1px solid #ccc; padding:8px;'>" + (n2 || "M2") + "</td><td style='border:1px solid #ccc; padding:8px;'>" + m2 + "</td></tr>"
    + "<tr><td style='border:1px solid #ccc; padding:8px;'>" + (n3 || "M3") + "</td><td style='border:1px solid #ccc; padding:8px;'>" + m3 + "</td></tr>"
    + "</table>"
    + "<p style='color:gray; font-size:12px;'>Sent from Google Sheets: Daily_OT</p>";

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });

  Logger.log("Email sent to " + recipient);
}
