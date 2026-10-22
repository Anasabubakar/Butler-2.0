package com.anas.butler

import android.content.Context
import android.content.res.ColorStateList
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * The speech bubble over Little Butler's head. While it works: a spinner, one short line
 * of what it's doing, and Stop. When it's done: a tick (or a warning), the first line of the
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
        indeterminateTintList = ColorStateList.valueOf(Ui.ACCENT)
    }
    private val markIcon = ImageView(context)
    private val mark = FrameLayout(context).apply {
        addView(markIcon, FrameLayout.LayoutParams((14 * dp).toInt(), (14 * dp).toInt(), Gravity.CENTER))
    }
    private val line = TextView(context).apply {
        setTextColor(Ui.TEXT)
        textSize = 14f
        isSingleLine = true
        ellipsize = TextUtils.TruncateAt.END
        maxWidth = (210 * dp).toInt()
    }
    private val body = TextView(context).apply {
        setTextColor(Ui.SUBTLE)
        textSize = 14f
        setLineSpacing(0f, 1.15f)
        maxWidth = (290 * dp).toInt()
        setTextIsSelectable(true)
        visibility = View.GONE
    }
    private val stop = Ui.iconButton(context, R.drawable.ic_stop, context.getString(R.string.bubble_stop), size = 28,
        tint = Ui.DANGER) { stopAction?.invoke() }
    private val copy = Ui.iconButton(context, R.drawable.ic_copy, context.getString(R.string.bubble_copy), size = 28) { onCopy?.invoke(full) }
    private val share = Ui.iconButton(context, R.drawable.ic_share, context.getString(R.string.bubble_share), size = 28) { onShare?.invoke(full) }
    private val close = Ui.iconButton(context, R.drawable.ic_close, context.getString(R.string.close), size = 28) { onClose?.invoke() }

    init {
        orientation = VERTICAL
        background = Ui.rounded(Ui.BACKGROUND, 18 * dp, Ui.MUTED, dp.toInt())
        elevation = 6 * dp
        setPadding((12 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
        val top = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(spinner, LayoutParams((16 * dp).toInt(), (16 * dp).toInt()).apply { marginEnd = (10 * dp).toInt() })
            addView(mark, LayoutParams((22 * dp).toInt(), (22 * dp).toInt()).apply { marginEnd = (8 * dp).toInt() })
            addView(line)
            for (button in listOf(stop, copy, share, close)) {
                (button.layoutParams as LayoutParams).marginStart = (6 * dp).toInt()
                button.visibility = View.GONE
                addView(button)
            }
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

    /** Changes what it says it's doing, keeping Stop as it was. The new line slides in. */
    fun progress(text: String) {
        if (!working) return working(text)
        full = text
        body.text = text
        val next = firstLine(text)
        if (line.text.toString() == next) return
        line.animate().cancel()
        line.animate().alpha(0f).translationY(-4 * dp).setDuration(90).withEndAction {
            line.text = next
            line.translationY = 4 * dp
            line.animate().alpha(1f).translationY(0f).setDuration(160).withEndAction(null).start()
        }.start()
    }

    /** Finished: a tick or a warning that pops in, the answer, and Copy, Share and close. */
    fun result(text: String, ok: Boolean = true) {
        working = false
        stopAction = null
        show(text, spinning = false)
        markIcon.setImageResource(if (ok) R.drawable.ic_check else R.drawable.ic_alert)
        markIcon.imageTintList = ColorStateList.valueOf(Ui.CARD)
        mark.background = Ui.rounded(if (ok) Ui.OK else Ui.DANGER, 11 * dp)
        mark.visibility = View.VISIBLE
        mark.scaleX = 0.4f
        mark.scaleY = 0.4f
        mark.animate().scaleX(1f).scaleY(1f).setDuration(260)
            .setInterpolator(android.view.animation.OvershootInterpolator(3f)).start()
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
        line.animate().cancel()
        line.alpha = 1f
        line.translationY = 0f
        line.text = firstLine(text)
        body.text = text
        spinner.visibility = if (spinning) View.VISIBLE else View.GONE
        mark.visibility = View.GONE
        setExpanded(false)
    }

    private fun toggleExpanded() = setExpanded(!expanded && full.length > firstLine(full).length)

    private fun setExpanded(on: Boolean) {
        expanded = on
        if (on && body.visibility != View.VISIBLE) {
            body.alpha = 0f
            body.visibility = View.VISIBLE
            body.animate().alpha(1f).setDuration(180).setInterpolator(LinearInterpolator()).start()
        } else if (!on) {
            body.visibility = View.GONE
        }
        line.alpha = if (on) 0.7f else 1f
    }

    companion object {
        /** The first non-empty line; the view cuts it short with "…" if it's long. */
        fun firstLine(text: String) = text.trim().lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
    }
}
