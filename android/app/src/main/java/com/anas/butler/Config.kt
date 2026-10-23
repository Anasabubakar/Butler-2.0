package com.anas.butler

import android.content.Context
import android.os.Build

/** Where to send saves, and how this phone identifies itself. Stored in app-private prefs. */
class Config(context: Context) {
    private val prefs = context.getSharedPreferences("butler", Context.MODE_PRIVATE)

    var saveUrl: String
        get() = prefs.getString(KEY_URL, "") ?: ""
        set(v) = prefs.edit().putString(KEY_URL, v.trim()).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(v) = prefs.edit().putString(KEY_TOKEN, v.trim()).apply()

    var deviceName: String
        get() = prefs.getString(KEY_DEVICE, null) ?: defaultDeviceName()
        set(v) = prefs.edit().putString(KEY_DEVICE, v.trim()).apply()

    /** Whether what you copy on the phone goes to your laptop's clipboard too. */
    var clipboardSync: Boolean
        get() = prefs.getBoolean(KEY_SYNC, false)
        set(v) = prefs.edit().putBoolean(KEY_SYNC, v).apply()

    /** Speak answers aloud on this phone. Off unless you turn it on (B2 · 11, B2 · 16). */
    var voiceReplies: Boolean
        get() = prefs.getBoolean(KEY_VOICE, false)
        set(v) = prefs.edit().putBoolean(KEY_VOICE, v).apply()

    /** Allow spoken commands when you press the mic. A separate switch from voice replies. */
    var microphone: Boolean
        get() = prefs.getBoolean(KEY_MIC, true)
        set(v) = prefs.edit().putBoolean(KEY_MIC, v).apply()

    /** Replace the pet's movement with subtle state changes on this phone. */
    var reducedMotion: Boolean
        get() = prefs.getBoolean(KEY_MOTION, false)
        set(v) = prefs.edit().putBoolean(KEY_MOTION, v).apply()

    /** Quiet mode, shared by every device; the phone keeps the last copy it read from Butler. */
    var quiet: Boolean
        get() = prefs.getBoolean(KEY_QUIET, false)
        set(v) = prefs.edit().putBoolean(KEY_QUIET, v).apply()

    /** Teasing ("on", "less" or "off"), shared by every device. */
    var teasing: String
        get() = prefs.getString(KEY_TEASING, "off") ?: "off"
        set(v) = prefs.edit().putString(KEY_TEASING, v).apply()

    val isReady: Boolean
        get() = saveUrl.startsWith("https://") && token.isNotEmpty()

    private fun defaultDeviceName() =
        "android-" + Build.MODEL.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

    private companion object {
        const val KEY_URL = "save_url"
        const val KEY_TOKEN = "token"
        const val KEY_DEVICE = "device"
        const val KEY_SYNC = "clipboard_sync"
        const val KEY_VOICE = "voice_replies"
        const val KEY_MIC = "microphone"
        const val KEY_MOTION = "reduced_motion"
        const val KEY_QUIET = "quiet"
        const val KEY_TEASING = "teasing"
    }
}
