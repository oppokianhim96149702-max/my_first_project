# my_first_project
guard attendance system 7amto7pm

---

# Daily Email Expense Automation (n8n)

Runs at **8:00 PM daily** via an n8n workflow. Reads DBS iBanking alert emails
from `kianhimn8na@gmail.com`, extracts transactions, and writes results to the
Google Sheet **daily_expenses_claude**.

## Workflow file

`daily_expense_automation.n8n.json` — import this into your n8n instance.

## Node overview

```
Schedule Trigger (8 PM)
  └─► Get DBS Emails          (Gmail — from:iBanking.alert@dbs.com, today, read+unread)
        └─► Parse Transactions (Code — extract date, time, amount, payee, direction)
              └─► Group & Categorise (Code — subtotals, Big In / Big Out > SGD 25)
                    ├─► Flatten Detail Rows  ──► Write Daily Tab       (Sheets: YYYY-MM-DD)
                    └─► Flatten Summary Rows ──► Upsert Master Payee List (Sheets: master_payee_list)
```

## Google Sheet layout

**Daily tab** (named `YYYY-MM-DD`):

| Date | Time | Amount | Payee | Big In | Big Out |
|------|------|--------|-------|--------|---------|

**`master_payee_list` tab** (cumulative, upserted by payee name):

| Payee | Total In | Total Out |
|-------|----------|-----------|

## Import & configure

1. In n8n go to **Workflows → Import from file** and select `daily_expense_automation.n8n.json`.
2. Open the **Get DBS Emails** node → assign a **Gmail OAuth2** credential for `kianhimn8na@gmail.com`.
3. Open both **Google Sheets** nodes → assign a **Google Sheets OAuth2** credential for the same account.
4. Make sure the Google Sheet named `daily_expenses_claude` exists (create it manually first, or let n8n create the tabs on first run).
5. **Activate** the workflow — it will fire every day at 20:00 (server local time).
