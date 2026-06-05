#!/usr/bin/env bash
# Installs (or replaces) the 8 PM daily cron job for expense_automation.py.
# Usage: bash setup_cron.sh [/path/to/python3]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${1:-$(command -v python3)}"
LOG_FILE="$SCRIPT_DIR/expense_automation.log"

CRON_JOB="0 20 * * * $PYTHON $SCRIPT_DIR/expense_automation.py >> $LOG_FILE 2>&1"
CRON_MARKER="expense_automation.py"

# Remove any old entry for this script, then add the new one
( crontab -l 2>/dev/null | grep -v "$CRON_MARKER"; echo "$CRON_JOB" ) | crontab -

echo "Cron job installed:"
echo "  $CRON_JOB"
echo ""
echo "Logs will be written to: $LOG_FILE"
echo ""
echo "Next steps:"
echo "  1. Place credentials.json in $SCRIPT_DIR"
echo "     (OAuth 2.0 client secret downloaded from Google Cloud Console)"
echo "  2. Run once manually to complete OAuth consent:"
echo "     $PYTHON $SCRIPT_DIR/expense_automation.py"
echo "  3. token.json will be saved and reused for all future runs."
