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

    val isReady: Boolean
        get() = saveUrl.startsWith("https://") && token.isNotEmpty()

    private fun defaultDeviceName() =
        "android-" + Build.MODEL.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

    private companion object {
        const val KEY_URL = "save_url"
        const val KEY_TOKEN = "token"
        const val KEY_DEVICE = "device"
        const val KEY_SYNC = "clipboard_sync"
    }
}
