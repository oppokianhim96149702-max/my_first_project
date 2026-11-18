# Guard Attendance System — Telegram + n8n + Google Sheets

Guards check in and out by tapping a button in a Telegram bot and sharing their GPS location.
n8n checks they are inside the site's geofence and logs every event to Google Sheets.
Supervisors get Telegram alerts for late arrivals, no-shows, early leaves, check-ins from outside the site, and forgotten check-outs.

## How it works

```
Guard taps "🟢 Check In"  →  bot asks for location  →  guard taps "📍 Share Location"
        │
        ▼
n8n: is this a registered guard? did they tap Check In in the last 5 min?
     how far are they from the site? are they late?
        │
        ├── within radius  → log IN to Attendance, set Status=IN, reply ✅
        └── outside radius → log IN_REJECTED, alert supervisor, reply ❌

Every 15 min: no check-in after shift start + 15 min  → alert guard + supervisor
              still IN long after shift end           → "forgot to check out?" alert
```

**Guard buttons:** 🟢 Check In · 🔴 Check Out · 📋 My Status

## Google Sheet (3 tabs, exact names)

Import the CSVs in `sheets/` (File → Import → *Insert new sheet*), or copy the header rows by hand.

**Guards** — one row per guard. You fill in the first 8 columns. The bot fills in `Status`, `LastCheckIn`, `LastCheckInTs` and `Pending`, so don't edit those.

| Column | Example | Notes |
|---|---|---|
| TelegramID | 123456789 | Guard gets this by sending `/start` to the bot |
| Name | Ali Bin Ahmad | |
| Phone | +6591234567 | For reference only |
| SiteID | S1 | Must match a SiteID in **Sites** |
| ShiftStart / ShiftEnd | 20:00 / 08:00 | Overnight shifts are OK |
| WorkDays | `Mon-Fri`, `Sat,Sun`, or blank | Blank means every day |
| Active | YES / NO | NO blocks the guard |

**Sites:** `SiteID, SiteName, Latitude, Longitude, RadiusM, SupervisorChatID`
To get coordinates, right-click the spot in Google Maps and click the numbers to copy them. Start with a radius of 100–200 m, because GPS indoors is often 30–80 m off.

**Attendance:** the bot appends rows here. Treat it as read-only. `Flags` can contain `LATE_25m`, `EARLY_OUT_60m`, `OUTSIDE_FENCE`, `NO_GPS_ACCURACY`, `LOW_ACCURACY_250m` or `DELAYED_MESSAGE`.

## Setup (about 30 min)

1. **Create the bot:** in Telegram, message `@BotFather`, send `/newbot` and copy the token.
2. **n8n:** you need an instance reachable over **public HTTPS**, either n8n Cloud or self-hosted behind a domain. Telegram webhooks don't work on `localhost`.
3. **Edit the workflow file:** open `dist/guard-attendance.workflow.json` in a text editor and replace every `YOUR_GOOGLE_SHEET_ID` with your sheet ID (the long part of the sheet URL between `/d/` and `/edit`). If you have Node installed, you can run `node build.js <SHEET_ID>` instead.
4. **Import it into n8n:** Workflows → Import from File.
5. **Credentials:** open each Telegram node and each Google Sheets node and select or create a credential (Telegram API = bot token; Google Sheets = OAuth2).
6. **Config:** open the **Process Message** and **Check Shifts** Code nodes and edit the `CONFIG` block at the top **in both nodes**. Set `TIMEZONE` and `ADMIN_CHAT_ID`.
   - To find a chat ID, message the bot once (it will reply with your ID), or add the bot to your supervisor group and use a bot like `@RawDataBot`. Group IDs start with `-100`.
7. **Activate** the workflow with the toggle at the top right.
8. **Register guards:** each guard sends `/start` to the bot and the admin receives their ID. Add a row for them in **Guards**.

> **Testing:** test with the workflow *activated* and your real phone. The Check In → Share Location flow spans two Telegram messages, and the 15-minute alert dedupe only persists in active (production) runs.

## Known limitations

Know these before you rely on this system for payroll or disputes:

- **GPS can be faked.** On Android, a mock-location app can defeat any Telegram-based geofence. The bot rejects forwarded and venue locations and flags locations that have no GPS accuracy (a hint that the guard picked a spot on the map), but it cannot *prove* the guard was there. If this matters, add a selfie step or an NFC/QR checkpoint at the site.
- **Buddy punching.** A guard can hand their phone to someone else. Location alone can't catch that.
- **The bot doesn't track the guard during the shift.** It records only the two moments when they check in and out. Patrol checkpoints would be a separate feature.
- **Rotating rosters** (e.g. 4-on/4-off) can't be expressed with `WorkDays`. Those guards will trigger false no-show alerts. You'd need a Roster tab, which is the natural v2.
- **Google Sheets** works up to roughly 50 guards. Each message reads the whole Guards tab. Past ~100k Attendance rows, archive yearly or move to a database.
- If two messages arrive at the exact same second for the same guard, they can race. In practice this doesn't happen with human tapping.
- **Privacy:** you are collecting employees' location data. Most data-protection laws (PDPA, GDPR, etc.) require you to tell guards what is collected and why, and to keep it only as long as needed. Put a one-line notice in the employment terms.

## Development

```
node test/test.js     # 21 logic tests (geofence, late/early, overnight shifts, no-shows, ...)
node build.js         # regenerates dist/guard-attendance.workflow.json from src/
```

All the logic lives in `src/lib.js` as plain JS. `build.js` inlines it into the n8n Code nodes. If you edit the code inside n8n instead, your changes won't flow back to `src/`.
