package com.anas.butler

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * "Where's my phone?": rings loudly on the alarm stream, so it sounds even on silent,
 * and buzzes. Stops when you tap the pet or the notification, or after a minute.
 */
object Ringer {
    private const val RING_MS = 60_000L
    const val NOTIFICATION = 7

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var oldVolume = -1
    private val handler = Handler(Looper.getMainLooper())
    private val timeUp = Runnable { stop(appContext) }
    private var appContext: Context? = null

    val ringing get() = player != null

    fun start(context: Context) {
        if (ringing) return
        val app = context.applicationContext
        appContext = app
        val audio = app.getSystemService(AudioManager::class.java)
        oldVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)

        val sound = RingtoneManager.getActualDefaultRingtoneUri(app, RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(app, sound)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()

        vibrator = if (Build.VERSION.SDK_INT >= 31) {
            app.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            app.getSystemService(Vibrator::class.java)
        }
        vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 400), 0))

        // No sound at all (no ringtone set): the buzzing still counts as ringing.
        if (player == null) player = MediaPlayer()
        handler.postDelayed(timeUp, RING_MS)
    }

    fun stop(context: Context?) {
        handler.removeCallbacks(timeUp)
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
        vibrator?.cancel()
        vibrator = null
        val app = context?.applicationContext ?: appContext ?: return
        app.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
        if (oldVolume >= 0) {
            app.getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, oldVolume, 0)
        }
        oldVolume = -1
    }
}
