package com.anas.butler

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Butler's hands: the Accessibility helper that lets the pet see the screen,
 * read the browser's address bar, copy a selection and tap for you.
 * It only acts when you press one of the pet's buttons.
 */
class HandsService : AccessibilityService() {

    override fun onServiceConnected() {
        instance = this
    }

    /** Notices you copying: a tap on a Copy button, or a "Copied" message from the system or the app. */
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.packageName == packageName) return
        val words = (event.text.joinToString(" ") + " " + (event.contentDescription ?: "")).trim()
        val copied = when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_CLICKED -> words.length <= 30 && COPY.containsMatchIn(words)
            AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED,
            AccessibilityEvent.TYPE_ANNOUNCEMENT,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> COPIED.containsMatchIn(words)
            else -> false
        }
        if (copied) PetService.instance?.copiedSomething()
    }

    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    /** The app you're looking at, such as com.zhiliaoapp.musically for TikTok. */
    fun foregroundApp(): String? = rootInActiveWindow?.packageName?.toString()

    /** A screenshot of the whole screen. Needs Android 11 or newer. */
    suspend fun screenshot(): Bitmap? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        return suspendCancellableCoroutine { cont ->
            takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
                override fun onSuccess(result: ScreenshotResult) {
                    val buffer = result.hardwareBuffer
                    val bitmap = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)
                        ?.copy(Bitmap.Config.ARGB_8888, false)
                    buffer.close()
                    cont.resume(bitmap)
                }

                override fun onFailure(errorCode: Int) {
                    cont.resume(null)
                }
            })
        }
    }

    /** Taps the screen at (x, y) in screen pixels. */
    suspend fun tap(x: Float, y: Float): Boolean = stroke(Path().apply { moveTo(x, y) }, 60)

    /** Presses and holds at (x, y). */
    suspend fun longPress(x: Float, y: Float): Boolean = stroke(Path().apply { moveTo(x, y) }, 800)

    /** Drags (or swipes) from one point to another over `ms` milliseconds. */
    suspend fun drag(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long = 500): Boolean =
        stroke(Path().apply { moveTo(x1, y1); lineTo(x2, y2) }, ms)

    /** Types `text` into the field that has focus. False if no field has focus. */
    fun type(text: String): Boolean {
        val field = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val now = field.text?.toString().orEmpty().takeUnless { field.isShowingHintText }.orEmpty()
        val args = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, now + text)
        }
        return field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    /** Presses the keyboard's Enter (Search, Go, Send…) on the field that has focus. Android 11+. */
    fun enter(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        val field = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return field.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    fun home() {
        performGlobalAction(GLOBAL_ACTION_HOME)
    }

    private suspend fun stroke(path: Path, ms: Long): Boolean = suspendCancellableCoroutine { cont ->
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, ms))
            .build()
        val started = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                if (cont.isActive) cont.resume(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                if (cont.isActive) cont.resume(false)
            }
        }, null)
        if (!started && cont.isActive) cont.resume(false)
    }

    fun back() {
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    /** The link in a browser's address bar, or null outside a browser. */
    fun browserUrl(): String? {
        val root = rootInActiveWindow ?: return null
        val id = URL_BARS[root.packageName?.toString()] ?: return null
        val text = root.findAccessibilityNodeInfosByViewId(id).firstOrNull()?.text?.toString()?.trim()
        if (text.isNullOrEmpty() || text.contains(' ')) return null // empty, or a search being typed
        return if (text.startsWith("http://") || text.startsWith("https://")) text else "https://$text"
    }

    /**
     * Presses the button on screen whose label (what TalkBack would read) matches [want], the
     * way a finger would. Apps label their buttons, so this hits Share, not the Save or
     * Favourites button next to it, which a guess from the screenshot sometimes did.
     * False if no such button is showing.
     */
    fun pressLabelled(want: Regex): Boolean {
        val roots = windows.mapNotNull { it.root }.ifEmpty { listOfNotNull(rootInActiveWindow) }
        val node = roots.firstNotNullOfOrNull { findLabelled(it, want) } ?: return false
        var target: AccessibilityNodeInfo? = node
        while (target != null && !target.isClickable) target = target.parent
        return target?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    private fun findLabelled(node: AccessibilityNodeInfo, want: Regex): AccessibilityNodeInfo? {
        if (!node.isVisibleToUser || node.packageName == packageName) return null // not the pet's own buttons
        val label = (node.contentDescription ?: node.text)?.toString()?.trim().orEmpty()
        if (label.length <= 40 && want.containsMatchIn(label) && !NOT_SHARE.containsMatchIn(label)) return node
        for (i in 0 until node.childCount) {
            val found = node.getChild(i)?.let { findLabelled(it, want) }
            if (found != null) return found
        }
        return null
    }

    /** Scrolls the first list on screen that isn't Butler's own (a share menu's apps) one page on. */
    fun scrollForward(): Boolean {
        val roots = windows.mapNotNull { it.root }.ifEmpty { listOfNotNull(rootInActiveWindow) }
        val list = roots.firstNotNullOfOrNull { findScrollable(it) } ?: return false
        return list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
    }

    private fun findScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (!node.isVisibleToUser || node.packageName == packageName) return null
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val found = node.getChild(i)?.let(::findScrollable)
            if (found != null) return found
        }
        return null
    }

    /** The selected text in the app you're looking at, or null if nothing is selected. */
    fun selectedText(): String? {
        val node = findSelection(rootInActiveWindow ?: return null) ?: return null
        val text = node.text?.toString() ?: return null
        val start = minOf(node.textSelectionStart, node.textSelectionEnd)
        val end = maxOf(node.textSelectionStart, node.textSelectionEnd)
        if (start < 0 || end > text.length || start == end) return null
        return text.substring(start, end)
    }

    private fun findSelection(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.textSelectionStart >= 0 && node.textSelectionStart != node.textSelectionEnd) return node
        for (i in 0 until node.childCount) {
            val found = node.getChild(i)?.let(::findSelection)
            if (found != null) return found
        }
        return null
    }

    companion object {
        private val COPY = Regex("\\bcopy\\b", RegexOption.IGNORE_CASE)
        private val COPIED = Regex("\\bcopied\\b", RegexOption.IGNORE_CASE)

        /** The Share button on a post: TikTok, Instagram, YouTube, X, Facebook and most others. */
        val SHARE = Regex("^(share|send post|share (video|post|reel|this))\\b", RegexOption.IGNORE_CASE)

        /** The Copy link option in an app's share menu. */
        val COPY_LINK = Regex("^copy( link|\\s*$)", RegexOption.IGNORE_CASE)

        /** Buttons that sit beside Share and must never be pressed by mistake. */
        private val NOT_SHARE = Regex("save|favou?rite|bookmark|collect|like|repost|download", RegexOption.IGNORE_CASE)

        /** Set while you've turned the helper on in Accessibility settings. */
        @Volatile
        var instance: HandsService? = null
            private set

        private val URL_BARS = mapOf(
            "com.android.chrome" to "com.android.chrome:id/url_bar",
            "com.chrome.beta" to "com.chrome.beta:id/url_bar",
            "com.brave.browser" to "com.brave.browser:id/url_bar",
            "com.microsoft.emmx" to "com.microsoft.emmx:id/url_bar",
            "com.opera.browser" to "com.opera.browser:id/url_field",
            "org.mozilla.firefox" to "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            "com.sec.android.app.sbrowser" to "com.sec.android.app.sbrowser:id/location_bar_edit_text",
        )
    }
}
