package com.anas.butler

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * An invisible screen that opens for a moment to read the clipboard, then closes.
 * Android only lets the app you're using read the clipboard, so after the pet
 * taps "Copy link" in another app, this is how it gets the link.
 */
class ClipReadActivity : Activity() {

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) return
        val clip = getSystemService(ClipboardManager::class.java).primaryClip
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        pending?.complete(text)
        pending = null
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }

    companion object {
        private var pending: CompletableDeferred<String?>? = null

        /** The clipboard's text, or null if it's empty or couldn't be read in time. */
        suspend fun read(context: Context): String? {
            val answer = CompletableDeferred<String?>()
            pending = answer
            context.startActivity(
                Intent(context, ClipReadActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
                ),
            )
            return withTimeoutOrNull(2000) { answer.await() }
        }
    }
}
