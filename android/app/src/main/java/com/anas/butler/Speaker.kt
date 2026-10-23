package com.anas.butler

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Voice replies (B2 · 11): speaks Butler's answer aloud, only when Voice replies is on for
 * this phone and quiet mode is off. A separate switch from the microphone.
 */
object Speaker {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var waiting: String? = null

    fun say(context: Context, text: String) {
        val config = Config(context)
        if (!config.voiceReplies || config.quiet || text.isBlank()) return
        val line = text.trim().take(400)
        if (ready) return speak(line)
        waiting = line
        if (tts == null) {
            tts = TextToSpeech(context.applicationContext) { status ->
                ready = status == TextToSpeech.SUCCESS
                if (ready) {
                    tts?.language = Locale.getDefault()
                    waiting?.let(::speak)
                }
                waiting = null
            }
        }
    }

    fun stop() {
        tts?.stop()
    }

    private fun speak(text: String) {
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "butler")
    }
}
