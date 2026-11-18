// ================= CONFIG — edit these =================
const CONFIG = {
  TIMEZONE: 'Asia/Singapore',   // IANA timezone of your sites
  ADMIN_CHAT_ID: '',            // Telegram chat ID for admin alerts (a person or a group, groups start with -100...)
  GRACE_MIN: 15,                // minutes after shift start before a guard counts as late / no-show
  STRICT_GEOFENCE: true,        // true = reject check-in/out outside the site radius
  PENDING_TTL_SEC: 300,         // guard must send location within 5 min of tapping Check In/Out
  LOW_ACCURACY_M: 100,          // GPS accuracy worse than this gets flagged
  FORGOT_CHECKOUT_MIN: 120,     // alert if still IN this long after the shift should have ended
  EARLY_CHECKIN_MIN: 120,       // check-ins up to 2h before shift start count for that shift
};
// =======================================================
