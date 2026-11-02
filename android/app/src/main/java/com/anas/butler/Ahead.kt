package com.anas.butler

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reminders and events that ring with no internet. While online, the phone keeps a copy of
 * what's coming in the next two days (from /api/device/ahead) and sets an alarm for each.
 * If Butler hasn't reached the phone by then (mobile data off), the alarm shows it here.
 * Whichever comes first, the alarm or Butler online, is shown; the other is skipped.
 */
object Ahead {
    private const val PREFS = "ahead"
    private const val PLAN = "plan"
    private const val SHOWN = "shown"
    private const val REFRESHED = "refreshed"
    private const val KEEP_SHOWN_MS = 3 * 24 * 3_600_000L
    // An event note from Butler and the phone's own copy are the same one if this close.
    private const val SAME_EVENT_MS = 2 * 3_600_000L
    const val EXTRA_KEY = "key"
    const val INBOX_CHANNEL = "inbox"
    const val QUIET_CHANNEL = "updates"
    private val lock = Any()

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Fetches the plan and sets the alarms. Quietly does nothing when offline (keeps the old plan). */
    suspend fun refresh(context: Context) {
        val config = Config(context)
        if (!config.isReady) return
        val answer = runCatching {
            JSONObject(ButlerClient(config).get("/api/device/ahead?device=" + Uri.encode(config.deviceName)))
        }.getOrNull() ?: return
        val items = answer.optJSONArray("items") ?: return
        val old = plan(context)
        synchronized(lock) {
            prefs(context).edit().putString(PLAN, items.toString()).putLong(REFRESHED, System.currentTimeMillis()).apply()
        }
        val keys = (0 until items.length()).map { items.getJSONObject(it).getString("key") }.toSet()
        for (gone in old.filter { it.getString("key") !in keys }) cancel(context, gone.getString("key"))
        arm(context)
    }

    /** Refreshes at most every few minutes, for callers that run often. */
    suspend fun refreshIfStale(context: Context, everyMs: Long) {
        if (System.currentTimeMillis() - prefs(context).getLong(REFRESHED, 0) >= everyMs) refresh(context)
    }

    /** Sets an alarm for each planned item still to come and not yet shown. After a restart too. */
    fun arm(context: Context) {
        val now = System.currentTimeMillis()
        val shown = shown(context)
        for (item in plan(context)) {
            val key = item.getString("key")
            val at = parseTime(item.getString("at")) ?: continue
            if (at <= now || key in shown) continue
            schedule(context, key, at)
        }
    }

    /**
     * Butler reached the phone online with a reminder (its id) or a note (its text). True when
     * the phone already showed it from its own copy, so it shouldn't be shown again.
     */
    fun alreadyShown(context: Context, kind: String, id: String, body: String): Boolean {
        val now = System.currentTimeMillis()
        val item = plan(context).firstOrNull {
            when (it.getString("kind")) {
                "reminder" -> kind == "reminder" && it.optString("match") == id
                "event" -> kind == "note" && body.startsWith(it.optString("match")) &&
                    Math.abs((parseTime(it.getString("at")) ?: 0L) - now) < SAME_EVENT_MS
                else -> false
            }
        } ?: return false
        val key = item.getString("key")
        synchronized(lock) {
            if (key in shown(context)) return true
            markShown(context, key) // shown now, online: the alarm shouldn't show it again
        }
        cancel(context, key)
        return false
    }

    /** The alarm went off: shows the item unless Butler already did. */
    fun fire(context: Context, key: String) {
        val item = plan(context).firstOrNull { it.getString("key") == key } ?: return
        synchronized(lock) {
            if (key in shown(context)) return
            markShown(context, key)
        }
        val reminder = item.getString("kind") == "reminder"
        val title = if (reminder) context.getString(R.string.inbox_reminder)
        else context.getString(R.string.inbox_note, context.getString(R.string.inbox_from, "Butler"))
        show(context, key, title, item.optString("body"), item.optString("url").takeIf { it.startsWith("https://") }, essential = reminder)
    }

    private fun show(context: Context, key: String, title: String, text: String, url: String?, essential: Boolean) {
        val quiet = Config(context).quiet && !essential
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(INBOX_CHANNEL, context.getString(R.string.inbox_channel), NotificationManager.IMPORTANCE_HIGH),
        )
        manager.createNotificationChannel(
            NotificationChannel(QUIET_CHANNEL, context.getString(R.string.quiet_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val tap = url?.let {
            PendingIntent.getActivity(
                context, key.hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(it)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
        val notification = NotificationCompat.Builder(context, if (quiet) QUIET_CHANNEL else INBOX_CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setColor(Ui.ACCENT)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(if (quiet) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (essential) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_EVENT)
            .setAutoCancel(true)
            .apply {
                tap?.let {
                    setContentIntent(it)
                    addAction(0, context.getString(R.string.notify_open), it)
                }
            }
            .build()
        runCatching { manager.notify(key.hashCode(), notification) }
    }

    private fun schedule(context: Context, key: String, at: Long) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val pending = alarmIntent(context, key)
        // Exact when Android allows it (USE_EXACT_ALARM on 13+); otherwise within a few minutes.
        val exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
        runCatching {
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
        }.onFailure { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending) }
    }

    private fun cancel(context: Context, key: String) {
        context.getSystemService(AlarmManager::class.java).cancel(alarmIntent(context, key))
    }

    private fun alarmIntent(context: Context, key: String): PendingIntent = PendingIntent.getBroadcast(
        context, key.hashCode(),
        Intent(context, AheadReceiver::class.java).setAction("com.anas.butler.AHEAD/$key").putExtra(EXTRA_KEY, key),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun plan(context: Context): List<JSONObject> {
        val raw = prefs(context).getString(PLAN, null) ?: return emptyList()
        val list = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }
    }

    /** Keys already shown, with when; entries older than a few days are dropped. */
    private fun shown(context: Context): Set<String> {
        val raw = prefs(context).getString(SHOWN, null) ?: return emptySet()
        val map = runCatching { JSONObject(raw) }.getOrNull() ?: return emptySet()
        return map.keys().asSequence().toSet()
    }

    private fun markShown(context: Context, key: String) = synchronized(lock) {
        val now = System.currentTimeMillis()
        val map = runCatching { JSONObject(prefs(context).getString(SHOWN, null) ?: "{}") }.getOrDefault(JSONObject())
        map.keys().asSequence().toList().forEach { if (now - map.optLong(it) > KEEP_SHOWN_MS) map.remove(it) }
        map.put(key, now)
        prefs(context).edit().putString(SHOWN, map.toString()).commit()
    }

    private fun parseTime(iso: String): Long? = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull()
}

/** Wakes for one planned reminder or event, and puts the alarms back after a restart or an update. */
class AheadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> Ahead.arm(context)
            else -> intent.getStringExtra(Ahead.EXTRA_KEY)?.let { Ahead.fire(context, it) }
        }
    }
}
