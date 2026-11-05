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
 * B2/PetBubble, the speech bubble over Little Butler's head (Figma B2 · 17): an ink card with
 * where and what state on top ("My laptop • Working") beside Stop, and what it's doing under
 * that. When it's done: a tick (or a warning), Copy, Share and close on top, the answer under
 * them, wrapped over as many lines as it needs, and a reply box to answer back. A long answer
 * shows its first lines and "Show more"; open, it scrolls inside the bubble, so every word can
 * be read without the bubble running off the screen.
 */
class PetBubble(context: Context) : LinearLayout(context) {

    var onCopy: ((String) -> Unit)? = null
    var onShare: ((String) -> Unit)? = null
    var onClose: (() -> Unit)? = null
    /** The reply box was tapped, with what the bubble says, so you can answer it. */
    var onReply: ((String) -> Unit)? = null

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
    private val where = TextView(context).apply {
        setTextColor(Ui.SUBTLE)
        textSize = 13f
        isSingleLine = true
        ellipsize = TextUtils.TruncateAt.END
        visibility = View.INVISIBLE
    }
    // What Butler says, all of it: wrapped, never cut to one line. Closed, it shows the first
    // few lines; open, every line, scrolling inside `scroll` once it's taller than that allows.
    private val line = TextView(context).apply {
        setTextColor(Ui.TEXT)
        textSize = 15f
        setLineSpacing(0f, 1.15f)
        maxLines = CLOSED_LINES
        ellipsize = TextUtils.TruncateAt.END
        breakStrategy = android.text.Layout.BREAK_STRATEGY_HIGH_QUALITY
    }
    private val scroll = CappedScroll(context).apply {
        addView(line, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }
    // Only there when something is hidden (or to close it again), with a 40 dp target.
    private val more = TextView(context).apply {
        setText(R.string.bubble_more)
        setTextColor(Ui.ACCENT)
        textSize = 14f
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER_VERTICAL
        minHeight = (40 * dp).toInt()
        isClickable = true
        setOnClickListener { toggleExpanded() }
        visibility = View.GONE
    }
    // "Stop" in words, as in B2 · 17, with a 48 dp target. Never hidden while something runs.
    private val stop = TextView(context).apply {
        setText(R.string.bubble_stop)
        setTextColor(Ui.TEXT)
        textSize = 15f
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        minHeight = (48 * dp).toInt()
        setPadding((12 * dp).toInt(), 0, (8 * dp).toInt(), 0)
        isClickable = true
        setOnClickListener { stopAction?.invoke() }
        layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    }
    private val copy = Ui.iconButton(context, R.drawable.ic_copy, context.getString(R.string.bubble_copy), size = 28) { onCopy?.invoke(full) }
    private val share = Ui.iconButton(context, R.drawable.ic_share, context.getString(R.string.bubble_share), size = 28) { onShare?.invoke(full) }
    private val close = Ui.iconButton(context, R.drawable.ic_close, context.getString(R.string.close), size = 28) { onClose?.invoke() }
    // Files on their way: a bar that fills, and how far along under it ("45% · 12 MB of 27 MB").
    private val bar = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
        max = 1000
        isIndeterminate = false
        progressTintList = ColorStateList.valueOf(Ui.ACCENT)
        progressBackgroundTintList = ColorStateList.valueOf(Ui.MUTED)
        visibility = View.GONE
    }
    private val detail = TextView(context).apply {
        setTextColor(Ui.SUBTLE)
        textSize = 12.5f
        isSingleLine = true
        ellipsize = TextUtils.TruncateAt.END
        visibility = View.GONE
    }
    // One thing to do with the result, such as "Open" or "Show in Downloads", with a 48 dp target.
    private var actionRun: (() -> Unit)? = null
    private val action = TextView(context).apply {
        setTextColor(Ui.TEXT)
        textSize = 14f
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        minHeight = (40 * dp).toInt()
        background = Ui.rounded(Ui.MUTED, 20 * dp)
        setPadding((16 * dp).toInt(), 0, (16 * dp).toInt(), 0)
        isClickable = true
        setOnClickListener { actionRun?.invoke() }
        visibility = View.GONE
    }
    // Looks like a text box; the typing happens in the Ask sheet, since the pet's window can't hold a keyboard.
    private val reply = TextView(context).apply {
        setText(R.string.bubble_reply)
        setTextColor(Ui.SUBTLE)
        textSize = 15f
        gravity = Gravity.CENTER_VERTICAL
        minHeight = (44 * dp).toInt()
        background = Ui.rounded(Ui.MUTED, 22 * dp, Ui.BORDER, dp.toInt())
        setPadding((14 * dp).toInt(), 0, (14 * dp).toInt(), 0)
        setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_reply, 0, 0, 0)
        compoundDrawablePadding = (8 * dp).toInt()
        compoundDrawableTintList = ColorStateList.valueOf(Ui.SUBTLE)
        isClickable = true
        contentDescription = context.getString(R.string.bubble_reply)
        setOnClickListener { onReply?.invoke(full) }
        visibility = View.GONE
    }

    init {
        orientation = VERTICAL
        background = Ui.rounded(Ui.BACKGROUND, 12 * dp, Ui.BORDER, dp.toInt())
        elevation = 6 * dp
        setPadding((16 * dp).toInt(), (10 * dp).toInt(), (8 * dp).toInt(), (10 * dp).toInt())
        // Top row: spinner or tick, where and what state, then the buttons. The text goes under
        // it at the bubble's full width, so the buttons never squeeze it down to a few words.
        val top = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(spinner, LayoutParams((16 * dp).toInt(), (16 * dp).toInt()).apply { marginEnd = (10 * dp).toInt() })
            addView(mark, LayoutParams((22 * dp).toInt(), (22 * dp).toInt()).apply { marginEnd = (8 * dp).toInt() })
            addView(where, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
            for (button in listOf(stop, copy, share, close)) {
                (button.layoutParams as LayoutParams).marginStart = (6 * dp).toInt()
                button.visibility = View.GONE
                addView(button)
            }
        }
        addView(top, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(scroll, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
            topMargin = (4 * dp).toInt()
            marginEnd = (8 * dp).toInt()
        })
        addView(more, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
        addView(bar, LayoutParams(LayoutParams.MATCH_PARENT, (6 * dp).toInt()).apply {
            topMargin = (8 * dp).toInt()
            marginEnd = (8 * dp).toInt()
        })
        addView(detail, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (4 * dp).toInt() })
        addView(action, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (8 * dp).toInt() })
        addView(reply, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
            topMargin = (8 * dp).toInt()
            marginEnd = (8 * dp).toInt()
        })
        line.setOnClickListener { toggleExpanded() }
        // Whether "Show more" is needed depends on how the text wrapped, known after layout.
        line.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updateMore() }
    }

    // As wide as the screen allows (less a margin each side), up to a comfortable reading width.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        var cap = minOf(resources.displayMetrics.widthPixels - (16 * dp).toInt(), (MAX_WIDTH_DP * dp).toInt())
        if (MeasureSpec.getMode(widthMeasureSpec) != MeasureSpec.UNSPECIFIED) cap = minOf(cap, MeasureSpec.getSize(widthMeasureSpec))
        super.onMeasure(MeasureSpec.makeMeasureSpec(cap, MeasureSpec.AT_MOST), heightMeasureSpec)
    }

    /**
     * Working on something: spinner, a short line, and Stop if it can be stopped. `device`
     * names where it's happening ("My laptop"), shown with the Working state word.
     */
    fun working(text: String, onStop: (() -> Unit)? = null, device: String? = null) {
        working = true
        stopAction = onStop
        show(text, spinning = !Ui.reducedMotion(context))
        setWhere(device, R.string.state_working)
        stop.visibility = if (onStop != null) View.VISIBLE else View.GONE
        copy.visibility = View.GONE
        share.visibility = View.GONE
        close.visibility = View.GONE
        reply.visibility = View.GONE
    }

    /** Changes what it says it's doing, keeping Stop as it was. The new line slides in. */
    fun progress(text: String) {
        if (!working) return working(text)
        full = text
        val next = text.trim()
        if (line.text.toString() == next) return
        line.animate().cancel()
        if (Ui.reducedMotion(context)) {
            line.text = next
            return
        }
        line.animate().alpha(0f).translationY(-4 * dp).setDuration(90).withEndAction {
            line.text = next
            updateMore()
            line.translationY = 4 * dp
            line.animate().alpha(1f).translationY(0f).setDuration(Ui.LISTEN_MS).withEndAction(null).start()
        }.start()
    }

    /**
     * Finished: a tick or a warning that settles in (a small nod, no bounce), the answer, and
     * Copy, Share and close. With `device`, the top line says where and Complete or Failed.
     */
    fun result(text: String, ok: Boolean = true, device: String? = null) {
        working = false
        stopAction = null
        show(text, spinning = false)
        setWhere(device, if (ok) R.string.state_complete else R.string.state_failed)
        markIcon.setImageResource(if (ok) R.drawable.ic_check else R.drawable.ic_alert)
        markIcon.imageTintList = ColorStateList.valueOf(Ui.CARD)
        mark.background = Ui.rounded(if (ok) Ui.OK else Ui.DANGER, 11 * dp)
        mark.visibility = View.VISIBLE
        if (!Ui.reducedMotion(context)) {
            mark.scaleX = 0.7f
            mark.scaleY = 0.7f
            mark.animate().scaleX(1f).scaleY(1f).setDuration(320)
                .setInterpolator(android.view.animation.PathInterpolator(0.2f, 0.8f, 0.2f, 1f)).start()
        }
        stop.visibility = View.GONE
        val worthKeeping = text.length > 40
        copy.visibility = if (worthKeeping) View.VISIBLE else View.GONE
        share.visibility = if (worthKeeping) View.VISIBLE else View.GONE
        close.visibility = View.VISIBLE
        reply.visibility = if (onReply != null) View.VISIBLE else View.GONE
    }

    /** Something to say that isn't a job: no spinner, just close. */
    fun info(text: String) {
        result(text, ok = true)
        where.visibility = View.INVISIBLE
        mark.visibility = View.GONE
    }

    /** How far along files are (0 to 1), with the detail line under the bar. Null hides the bar. */
    fun bar(fraction: Double?, detailText: String = "") {
        bar.visibility = if (fraction != null) View.VISIBLE else View.GONE
        if (fraction != null) bar.progress = (fraction.coerceIn(0.0, 1.0) * 1000).toInt()
        detail.text = detailText
        detail.visibility = if (fraction != null && detailText.isNotEmpty()) View.VISIBLE else View.GONE
    }

    /** A button under the result, such as "Open". Null takes it away. */
    fun offer(label: String?, run: (() -> Unit)?) {
        actionRun = run
        action.text = label
        action.visibility = if (label != null && run != null) View.VISIBLE else View.GONE
    }

    /** Sets the top line as given, for updates that already name the device and state ("My laptop • Complete"). */
    fun heading(text: String?) {
        where.text = text
        where.visibility = if (text.isNullOrBlank()) View.INVISIBLE else View.VISIBLE
    }

    private fun setWhere(device: String?, state: Int) {
        where.text = device?.let { context.getString(R.string.bubble_where, it, context.getString(state)) }
        where.visibility = if (device != null) View.VISIBLE else View.INVISIBLE
    }

    private fun show(text: String, spinning: Boolean) {
        bar(null)
        offer(null, null)
        full = text
        line.animate().cancel()
        line.alpha = 1f
        line.translationY = 0f
        line.text = text.trim()
        scroll.scrollTo(0, 0)
        spinner.visibility = if (spinning) View.VISIBLE else View.GONE
        mark.visibility = View.GONE
        setExpanded(false)
    }

    private fun toggleExpanded() = setExpanded(!expanded && (cutShort() || line.lineCount > CLOSED_LINES))

    private fun setExpanded(on: Boolean) {
        if (expanded == on && line.maxLines == (if (on) Int.MAX_VALUE else CLOSED_LINES)) return updateMore()
        expanded = on
        line.maxLines = if (on) Int.MAX_VALUE else CLOSED_LINES
        line.ellipsize = if (on) null else TextUtils.TruncateAt.END
        if (!on) scroll.scrollTo(0, 0)
        more.setText(if (on) R.string.bubble_less else R.string.bubble_more)
        if (on && !Ui.reducedMotion(context)) {
            line.alpha = 0.6f
            line.animate().alpha(1f).setDuration(180).setInterpolator(LinearInterpolator()).start()
        }
        updateMore()
    }

    /** True when the closed text ends in "…" because more is hidden. */
    private fun cutShort(): Boolean {
        val layout = line.layout ?: return needsMore(full)
        val last = layout.lineCount - 1
        return last >= 0 && layout.getEllipsisCount(last) > 0
    }

    /** "Show more" only when something is hidden; "Show less" while it's open. */
    private fun updateMore() {
        val show = expanded || cutShort()
        val want = if (show) View.VISIBLE else View.GONE
        if (more.visibility != want) post { more.visibility = if (expanded || cutShort()) View.VISIBLE else View.GONE }
    }

    companion object {
        /** How many lines a closed bubble shows before "Show more". */
        const val CLOSED_LINES = 6
        /** The widest the bubble gets, for comfortable reading on tablets and landscape. */
        const val MAX_WIDTH_DP = 360

        /** The first non-empty line. */
        fun firstLine(text: String) = text.trim().lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()

        /**
         * A guess, before the text is laid out, at whether it needs "Show more": more lines than
         * a closed bubble shows, or more than about that many lines' worth of characters.
         */
        fun needsMore(text: String, perLine: Int = 38): Boolean {
            val lines = text.trim().lines()
            return lines.size > CLOSED_LINES || lines.sumOf { maxOf(1, (it.length + perLine - 1) / perLine) } > CLOSED_LINES
        }
    }
}
