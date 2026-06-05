# my_first_project
guard attendance system 7amto7pm

---

# Daily Email Expense Automation

Runs at **8:00 PM daily**. Reads DBS iBanking alert emails from `kianhimn8na@gmail.com`,
extracts transactions, and writes results to the Google Sheet **daily_expenses_claude**.

## What it does

| Step | Action |
|------|--------|
| 1 | Queries Gmail for emails from `iBanking.alert@dbs.com` received today (read + unread) |
| 2 | Parses each email for **date, time, amount, payee** |
| 3 | Groups transactions by payee, calculates subtotals |
| 4 | Flags amounts > SGD 25 as **Big In** or **Big Out** |
| 5 | Writes a dated daily tab + updates the `master_payee_list` tab in Google Sheets |

## Google Sheet layout

**Daily tab** (named `YYYY-MM-DD`):

| Date | Time | Amount | Payee | Big In | Big Out |
|------|------|--------|-------|--------|---------|

**`master_payee_list` tab** (cumulative across all days):

| Payee | Total In | Total Out |
|-------|----------|-----------|

## Setup

### 1. Enable Google APIs

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create or select a project.
2. Enable **Gmail API**, **Google Sheets API**, and **Google Drive API**.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
4. Application type: **Desktop app**.
5. Download the JSON and save it as `credentials.json` in this directory.

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Authorise (first run only)

```bash
python3 expense_automation.py
```

A browser window will open for Google OAuth consent. After approval, `token.json`
is saved and reused automatically for all future runs.

### 4. Install the daily cron job

```bash
bash setup_cron.sh
```

This registers `0 20 * * * python3 expense_automation.py` in your crontab.
Logs are appended to `expense_automation.log`.

### 5. Manual run

```bash
python3 expense_automation.py
```

## File overview

```
expense_automation.py   # Main script
setup_cron.sh           # One-time cron installer
requirements.txt        # Python dependencies
credentials.json        # OAuth client secret (you supply — do NOT commit)
token.json              # OAuth access token (auto-generated — do NOT commit)
expense_automation.log  # Runtime log (auto-generated)
```

> **Security**: `credentials.json` and `token.json` contain sensitive tokens.
> They are listed in `.gitignore` and must never be committed to the repository.
