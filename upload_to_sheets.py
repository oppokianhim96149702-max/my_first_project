"""
Upload WhatsApp extracted messages to Google Sheets.

Usage:
    python upload_to_sheets.py chat.txt --sender Leong --keyword OT --sheet "OT Records"

Requirements:
    pip install gspread google-auth

Setup: See README or instructions printed by --setup flag.
"""

import sys
import argparse
import json
from pathlib import Path

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    print("\nMissing libraries. Please run this command first:\n")
    print("    pip install gspread google-auth\n")
    sys.exit(1)

from whatsapp_extractor import extract_messages, filter_messages

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SETUP_INSTRUCTIONS = """
============================================================
  GOOGLE SHEETS SETUP GUIDE (one-time setup)
============================================================

Step 1: Create a Google Cloud project
  1. Go to https://console.cloud.google.com/
  2. Click "Select a project" (top left) → "New Project"
  3. Name it anything e.g. "WhatsApp Extractor" → Create

Step 2: Enable Google Sheets API
  1. In the left menu go to: APIs & Services → Library
  2. Search "Google Sheets API" → Click it → Enable
  3. Also search "Google Drive API" → Enable

Step 3: Create a Service Account
  1. Go to: APIs & Services → Credentials
  2. Click "+ Create Credentials" → Service Account
  3. Name it anything → Click Done
  4. Click the service account email you just created
  5. Go to "Keys" tab → Add Key → Create New Key → JSON
  6. A file downloads automatically — save it as:
         credentials.json
     in the SAME folder as this script

Step 4: Share your Google Sheet
  1. Open (or create) the Google Sheet you want to write to
  2. Click Share → paste the service account email
     (looks like: something@something.iam.gserviceaccount.com)
  3. Give it Editor access → Share

Step 5: Run the script
  python upload_to_sheets.py chat.txt --sender Leong --keyword OT --sheet "My Sheet Name"

============================================================
"""


def get_sheet(credentials_file: str, sheet_name: str):
    creds_path = Path(credentials_file)
    if not creds_path.exists():
        print(f"\nError: credentials file '{credentials_file}' not found.")
        print("Run with --setup to see setup instructions.\n")
        sys.exit(1)

    creds = Credentials.from_service_account_file(str(creds_path), scopes=SCOPES)
    client = gspread.authorize(creds)

    try:
        spreadsheet = client.open(sheet_name)
    except gspread.SpreadsheetNotFound:
        print(f"\nError: Google Sheet '{sheet_name}' not found.")
        print("Make sure you shared the sheet with your service account email.")
        print("Run with --setup for full instructions.\n")
        sys.exit(1)

    return spreadsheet.sheet1


def upload(messages, sheet, tab_label: str = "") -> None:
    headers = ["Date", "Time", "Sender", "Message"]
    rows = [[m.date, m.time, m.sender, m.message] for m in messages]

    sheet.clear()
    sheet.update([headers] + rows)

    # Bold the header row
    sheet.format("A1:D1", {"textFormat": {"bold": True}})

    print(f"\nUploaded {len(rows)} messages to Google Sheet.")
    print("Open your Google Sheet to view the results.")


def main():
    parser = argparse.ArgumentParser(description="Extract WhatsApp messages and upload to Google Sheets.")
    parser.add_argument("input", nargs="?", help="WhatsApp exported .txt file")
    parser.add_argument("--sender", default="Leong", help="Filter by sender name (default: Leong)")
    parser.add_argument("--keyword", default="OT", help="Filter by keyword (default: OT)")
    parser.add_argument("--sheet", default="WhatsApp OT", help="Google Sheet name (default: 'WhatsApp OT')")
    parser.add_argument("--credentials", default="credentials.json", help="Path to credentials JSON file")
    parser.add_argument("--setup", action="store_true", help="Show Google Sheets setup instructions")
    args = parser.parse_args()

    if args.setup:
        print(SETUP_INSTRUCTIONS)
        return

    if not args.input:
        parser.print_help()
        sys.exit(1)

    print(f"Reading: {args.input}")
    messages = extract_messages(args.input)

    print(f"Filtering: sender='{args.sender}', keyword='{args.keyword}'")
    filtered = filter_messages(messages, sender=args.sender, keyword=args.keyword)

    if not filtered:
        print(f"\nNo messages found matching sender='{args.sender}' and keyword='{args.keyword}'.")
        print("Check that the name and keyword spelling are correct.")
        sys.exit(0)

    print(f"Found {len(filtered)} matching messages.")
    print(f"Connecting to Google Sheet: '{args.sheet}' ...")

    sheet = get_sheet(args.credentials, args.sheet)
    upload(filtered, sheet)


if __name__ == "__main__":
    main()
