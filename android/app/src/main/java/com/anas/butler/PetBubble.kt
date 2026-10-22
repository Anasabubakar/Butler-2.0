package com.anas.butler

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * The speech bubble over Little Butler's head. While it works: a spinner, one short line
 * of what it's doing, and Stop. When it's done: a tick (or a cross), the first line of the
 * answer, and Copy, Share and close. Tap the line to read all of it.
 */
class PetBubble(context: Context) : LinearLayout(context) {

    var onCopy: ((String) -> Unit)? = null
    var onShare: ((String) -> Unit)? = null
    var onClose: (() -> Unit)? = null

    /** True while you're reading the whole answer, so it doesn't go away under you. */
    var expanded = false
        private set
    var working = false
        private set
    private var full = ""
    private var stopAction: (() -> Unit)? = null

    private val dp = resources.displayMetrics.density
    private val spinner = ProgressBar(context, null, android.R.attr.progressBarStyleSmall).apply {
        indeterminateTintList = android.content.res.ColorStateList.valueOf(ACCENT)
    }
    private val mark = TextView(context).apply {
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
    }
    private val line = TextView(context).apply {
        setTextColor(WHITE)
        textSize = 14f
        isSingleLine = true
        ellipsize = TextUtils.TruncateAt.END
        maxWidth = (230 * dp).toInt()
    }
    private val body = TextView(context).apply {
        setTextColor(0xFFE4E4EA.toInt())
        textSize = 14f
        maxWidth = (290 * dp).toInt()
        setTextIsSelectable(true)
        visibility = View.GONE
    }
    private val stop = chip(context.getString(R.string.bubble_stop), STOP_RED) { stopAction?.invoke() }
    private val copy = chip(context.getString(R.string.bubble_copy)) { onCopy?.invoke(full) }
    private val share = chip(context.getString(R.string.bubble_share)) { onShare?.invoke(full) }
    private val close = chip("×") { onClose?.invoke() }

    init {
        orientation = VERTICAL
        background = GradientDrawable().apply {
            setColor(0xF01B1B22.toInt())
            cornerRadius = 20 * dp
        }
        setPadding((12 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
        val top = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(spinner, LayoutParams((18 * dp).toInt(), (18 * dp).toInt()).apply { marginEnd = (8 * dp).toInt() })
            addView(mark, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { marginEnd = (8 * dp).toInt() })
            addView(line)
            for (button in listOf(stop, copy, share, close)) addView(button)
            setOnClickListener { toggleExpanded() }
        }
        addView(top)
        addView(body, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (6 * dp).toInt() })
        line.setOnClickListener { toggleExpanded() }
        body.setOnClickListener { toggleExpanded() }
    }

    /** Working on something: spinner, a short line, and Stop if it can be stopped. */
    fun working(text: String, onStop: (() -> Unit)? = null) {
        working = true
        stopAction = onStop
        show(text, spinning = true)
        stop.visibility = if (onStop != null) View.VISIBLE else View.GONE
        copy.visibility = View.GONE
        share.visibility = View.GONE
        close.visibility = View.GONE
    }

    /** Changes what it says it's doing, keeping Stop as it was. */
    fun progress(text: String) {
        if (!working) return working(text)
        full = text
        line.text = firstLine(text)
        body.text = text
    }

    /** Finished: a tick or a cross, the answer, and Copy, Share and close. */
    fun result(text: String, ok: Boolean = true) {
        working = false
        stopAction = null
        show(text, spinning = false)
        mark.text = if (ok) "✓" else "!"
        mark.setTextColor(if (ok) OK_GREEN else STOP_RED)
        mark.visibility = View.VISIBLE
        stop.visibility = View.GONE
        val worthKeeping = text.length > 40
        copy.visibility = if (worthKeeping) View.VISIBLE else View.GONE
        share.visibility = if (worthKeeping) View.VISIBLE else View.GONE
        close.visibility = View.VISIBLE
        // Long answers open up straight away; short ones fit on the line.
        if (text.length > 90 || text.contains('\n')) setExpanded(true)
    }

    /** Something to say that isn't a job: no spinner, just close. */
    fun info(text: String) {
        result(text, ok = true)
        mark.visibility = View.GONE
    }

    private fun show(text: String, spinning: Boolean) {
        full = text
        line.text = firstLine(text)
        body.text = text
        spinner.visibility = if (spinning) View.VISIBLE else View.GONE
        mark.visibility = View.GONE
        setExpanded(false)
    }

    private fun toggleExpanded() = setExpanded(!expanded && full.length > firstLine(full).length)

    private fun setExpanded(on: Boolean) {
        expanded = on
        body.visibility = if (on) View.VISIBLE else View.GONE
        line.alpha = if (on) 0.6f else 1f
    }

    private fun chip(label: String, color: Int = 0xFF2E2E3A.toInt(), onClick: () -> Unit) = TextView(context).apply {
        text = label
        setTextColor(WHITE)
        textSize = 13f
        gravity = Gravity.CENTER
        background = GradientDrawable().apply {
            setColor(color)
            cornerRadius = 14 * dp
        }
        setPadding((10 * dp).toInt(), (5 * dp).toInt(), (10 * dp).toInt(), (5 * dp).toInt())
        layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { marginStart = (6 * dp).toInt() }
        setOnClickListener { onClick() }
        visibility = View.GONE
    }

    companion object {
        private const val WHITE = 0xFFFFFFFF.toInt()
        private const val ACCENT = 0xFFB9A4FF.toInt()
        private const val OK_GREEN = 0xFF5BD68A.toInt()
        private const val STOP_RED = 0xFFE5484D.toInt()

        /** The first non-empty line; the view cuts it short with "…" if it's long. */
        fun firstLine(text: String) = text.trim().lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
    }
}
