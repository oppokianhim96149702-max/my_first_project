"""
Daily expense automation: reads DBS iBanking emails, extracts transactions,
and writes results to Google Sheets (daily_expenses_claude).

Run manually or via cron: 0 20 * * * /usr/bin/python3 /path/to/expense_automation.py
"""

import base64
import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from email import message_from_bytes

from dateutil import parser as dateutil_parser
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
GMAIL_ADDRESS = "kianhimn8na@gmail.com"
SENDER_FILTER = "iBanking.alert@dbs.com"
SHEET_TITLE = "daily_expenses_claude"
MASTER_TAB = "master_payee_list"
BIG_THRESHOLD = 25.0

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "token.json")
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "credentials.json")


# ── Auth ──────────────────────────────────────────────────────────────────────
def get_credentials() -> Credentials:
    """Load or refresh OAuth2 credentials, prompting the user if needed."""
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                raise FileNotFoundError(
                    f"Missing {CREDENTIALS_FILE}. Download it from Google Cloud Console "
                    "(APIs & Services → Credentials → OAuth 2.0 Client IDs)."
                )
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as fh:
            fh.write(creds.to_json())
    return creds


# ── Gmail helpers ─────────────────────────────────────────────────────────────
def _decode_body(part) -> str:
    """Return decoded UTF-8 text from a Gmail message part."""
    data = part.get("body", {}).get("data", "")
    if not data:
        return ""
    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")


def _get_plain_text(payload: dict) -> str:
    """Recursively extract plain-text body from a Gmail message payload."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        return _decode_body(payload)
    if mime.startswith("multipart/"):
        for part in payload.get("parts", []):
            text = _get_plain_text(part)
            if text:
                return text
    return ""


def fetch_today_emails(gmail_svc) -> list[dict]:
    """
    Return a list of raw email dicts sent today from SENDER_FILTER.
    Both read and unread messages are included.
    """
    today_str = datetime.now().strftime("%Y/%m/%d")
    query = f"from:{SENDER_FILTER} after:{today_str}"
    log.info("Gmail query: %s", query)

    messages = []
    page_token = None
    while True:
        resp = gmail_svc.users().messages().list(
            userId="me",
            q=query,
            pageToken=page_token,
        ).execute()
        messages.extend(resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    log.info("Found %d message(s) matching query", len(messages))

    emails = []
    for msg_stub in messages:
        msg = gmail_svc.users().messages().get(
            userId="me", id=msg_stub["id"], format="full"
        ).execute()
        emails.append(msg)
    return emails


# ── Transaction parsing ───────────────────────────────────────────────────────
# Example DBS iBanking alert body:
#   Dear Customer,
#   A payment of SGD 120.50 was made to John Doe on 05 Jun 2026 at 14:32.
#
# The patterns below are intentionally flexible to cope with minor wording changes.

_AMOUNT_RE = re.compile(r"(?:SGD|S\$)\s*([\d,]+\.\d{2})", re.IGNORECASE)
_PAYEE_RE = re.compile(
    r"(?:paid? to|payment (?:was )?made to|transferred? to|credited? to)\s+([^\n,\.]+)",
    re.IGNORECASE,
)
_DATE_RE = re.compile(
    r"\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})\b",
    re.IGNORECASE,
)
_TIME_RE = re.compile(r"\b(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\b", re.IGNORECASE)


def parse_transaction(email_msg: dict) -> dict | None:
    """
    Extract {date, time, amount, payee, direction} from a Gmail message.
    Returns None if required fields cannot be parsed.
    direction: 'in' | 'out'
    """
    payload = email_msg.get("payload", {})
    body = _get_plain_text(payload)

    if not body:
        log.warning("Empty body for message %s, skipping", email_msg.get("id"))
        return None

    # Amount
    amount_match = _AMOUNT_RE.search(body)
    if not amount_match:
        log.warning("No amount found in message %s", email_msg.get("id"))
        return None
    amount = float(amount_match.group(1).replace(",", ""))

    # Payee
    payee_match = _PAYEE_RE.search(body)
    payee = payee_match.group(1).strip() if payee_match else "Unknown"

    # Date — prefer explicit date in body, fall back to email header
    date_match = _DATE_RE.search(body)
    if date_match:
        try:
            tx_date = dateutil_parser.parse(date_match.group(1))
        except ValueError:
            tx_date = datetime.now()
    else:
        header_date = next(
            (h["value"] for h in payload.get("headers", []) if h["name"] == "Date"),
            None,
        )
        tx_date = dateutil_parser.parse(header_date) if header_date else datetime.now()

    # Time
    time_match = _TIME_RE.search(body)
    tx_time = time_match.group(1).strip() if time_match else tx_date.strftime("%H:%M")

    # Direction: treat credits/incoming as 'in', everything else as 'out'
    direction = "in" if re.search(r"\b(credit|received|deposit)\b", body, re.IGNORECASE) else "out"

    return {
        "date": tx_date.strftime("%Y-%m-%d"),
        "time": tx_time,
        "amount": amount,
        "payee": payee,
        "direction": direction,
    }


# ── Data processing ───────────────────────────────────────────────────────────
def process_transactions(transactions: list[dict]) -> tuple[list[list], list[list]]:
    """
    Build two tables:
      1. detail_rows  — one row per transaction with Big In / Big Out columns
      2. summary_rows — one row per payee with subtotals

    Returns (detail_rows, summary_rows) each as list-of-lists ready for Sheets.
    """
    detail_rows = []
    payee_totals: dict[str, dict] = defaultdict(lambda: {"in": 0.0, "out": 0.0})

    for tx in transactions:
        amount = tx["amount"]
        direction = tx["direction"]
        payee = tx["payee"]

        big_in = amount if direction == "in" and amount > BIG_THRESHOLD else ""
        big_out = amount if direction == "out" and amount > BIG_THRESHOLD else ""

        detail_rows.append([
            tx["date"],
            tx["time"],
            amount,
            payee,
            big_in,
            big_out,
        ])

        payee_totals[payee][direction] += amount

    summary_rows = [
        [payee, round(totals["in"], 2), round(totals["out"], 2)]
        for payee, totals in sorted(payee_totals.items())
    ]

    return detail_rows, summary_rows


# ── Google Sheets helpers ─────────────────────────────────────────────────────
def _find_or_create_spreadsheet(drive_svc, sheets_svc) -> str:
    """Return the spreadsheet ID for SHEET_TITLE, creating it if absent."""
    query = f"name='{SHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
    results = drive_svc.files().list(q=query, fields="files(id,name)").execute()
    files = results.get("files", [])
    if files:
        sid = files[0]["id"]
        log.info("Found existing spreadsheet: %s", sid)
        return sid

    log.info("Creating new spreadsheet '%s'", SHEET_TITLE)
    body = {
        "properties": {"title": SHEET_TITLE},
        "sheets": [
            {"properties": {"title": "Sheet1"}},
            {"properties": {"title": MASTER_TAB}},
        ],
    }
    sheet = sheets_svc.spreadsheets().create(body=body, fields="spreadsheetId").execute()
    return sheet["spreadsheetId"]


def _ensure_tab(sheets_svc, spreadsheet_id: str, tab_name: str) -> int:
    """Ensure a tab exists; return its sheetId."""
    meta = sheets_svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()

    for sh in meta.get("sheets", []):
        props = sh["properties"]
        if props["title"] == tab_name:
            return props["sheetId"]

    # Create it
    req = {"addSheet": {"properties": {"title": tab_name}}}
    resp = (
        sheets_svc.spreadsheets()
        .batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": [req]})
        .execute()
    )
    return resp["replies"][0]["addSheet"]["properties"]["sheetId"]


def _clear_and_write(sheets_svc, spreadsheet_id: str, tab_name: str, rows: list[list]):
    """Clear the tab and write rows (including a header as first row)."""
    range_name = f"{tab_name}!A1"
    sheets_svc.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=tab_name
    ).execute()
    sheets_svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption="USER_ENTERED",
        body={"values": rows},
    ).execute()
    log.info("Wrote %d row(s) to tab '%s'", len(rows), tab_name)


def write_to_sheets(
    sheets_svc,
    drive_svc,
    detail_rows: list[list],
    summary_rows: list[list],
    run_date: str,
):
    spreadsheet_id = _find_or_create_spreadsheet(drive_svc, sheets_svc)

    # ── Daily tab named by run date (e.g. "2026-06-05") ──────────────────────
    daily_tab = run_date
    _ensure_tab(sheets_svc, spreadsheet_id, daily_tab)
    detail_header = [["Date", "Time", "Amount", "Payee", "Big In", "Big Out"]]
    _clear_and_write(sheets_svc, spreadsheet_id, daily_tab, detail_header + detail_rows)

    # ── master_payee_list tab ────────────────────────────────────────────────
    _ensure_tab(sheets_svc, spreadsheet_id, MASTER_TAB)
    summary_header = [["Payee", "Total In", "Total Out"]]

    # Merge with any existing master data
    existing = (
        sheets_svc.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=MASTER_TAB)
        .execute()
        .get("values", [])
    )
    existing_map: dict[str, list] = {}
    for row in existing[1:]:  # skip header
        if row:
            existing_map[row[0]] = row

    for new_row in summary_rows:
        payee = new_row[0]
        if payee in existing_map:
            old = existing_map[payee]
            existing_map[payee] = [
                payee,
                round(float(old[1] if len(old) > 1 else 0) + new_row[1], 2),
                round(float(old[2] if len(old) > 2 else 0) + new_row[2], 2),
            ]
        else:
            existing_map[payee] = new_row

    merged = summary_header + sorted(existing_map.values(), key=lambda r: r[0])
    _clear_and_write(sheets_svc, spreadsheet_id, MASTER_TAB, merged)

    log.info("Spreadsheet URL: https://docs.google.com/spreadsheets/d/%s", spreadsheet_id)
    return spreadsheet_id


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    run_date = datetime.now().strftime("%Y-%m-%d")
    log.info("=== Daily expense automation starting for %s ===", run_date)

    creds = get_credentials()
    gmail_svc = build("gmail", "v1", credentials=creds)
    sheets_svc = build("sheets", "v4", credentials=creds)
    drive_svc = build("drive", "v3", credentials=creds)

    emails = fetch_today_emails(gmail_svc)

    transactions = []
    for email_msg in emails:
        tx = parse_transaction(email_msg)
        if tx:
            transactions.append(tx)

    log.info("Parsed %d valid transaction(s)", len(transactions))

    if not transactions:
        log.info("No transactions found today — writing empty report.")

    detail_rows, summary_rows = process_transactions(transactions)
    spreadsheet_id = write_to_sheets(sheets_svc, drive_svc, detail_rows, summary_rows, run_date)

    log.info("=== Done. Spreadsheet: https://docs.google.com/spreadsheets/d/%s ===", spreadsheet_id)


if __name__ == "__main__":
    main()
