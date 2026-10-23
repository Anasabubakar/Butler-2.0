package com.anas.butler

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView

/**
 * The Butler 2.0 look for Little Butler's floating pieces (Figma B2 · 02, B2 · 06, B2 · 17):
 * ink and charcoal surfaces with white text, vermilion only as a small accent, and the
 * B2 · 07 motion: quick, restrained, and instant when reduced motion is on.
 */
object Ui {
    const val BACKGROUND = 0xF2111111.toInt() // --b2-ink, nearly opaque
    const val CARD = 0xFF191919.toInt()       // --b2-dark-surface
    const val MUTED = 0xFF262523.toInt()      // pressed and secondary surfaces on dark
    const val BORDER = 0xFF2E2C29.toInt()     // --b2-border in dark
    const val TEXT = 0xFFFFFFFF.toInt()       // --b2-white
    const val SUBTLE = 0xFFA8A49E.toInt()     // muted text on dark, about 7:1
    const val ACCENT = 0xFFE4462D.toInt()     // --b2-vermilion: marks and highlights, never behind small white text
    const val ACTION = 0xFFB83120.toInt()     // --b2-action-red: red buttons that carry white text (Stop)
    const val OK = TEXT                       // complete is calm: white, with a tick, no green
    const val DANGER = 0xFFFF8A73.toInt()     // failed text on dark, as on the website

    // B2 · 07: enter cubic-bezier(.2, .8, .2, 1), exit cubic-bezier(.4, 0, 1, 1).
    private val EASE_OUT = PathInterpolator(0.2f, 0.8f, 0.2f, 1f)
    private val EASE_IN = PathInterpolator(0.4f, 0f, 1f, 1f)
    const val LISTEN_MS = 160L   // open the bubble; show mic state and Stop
    const val BASE_MS = 200L
    const val DISMISS_MS = 220L  // tuck away

    /** Reduced motion from Butler's setting or the phone's own "Remove animations". */
    fun reducedMotion(context: Context): Boolean =
        Config(context).reducedMotion || android.provider.Settings.Global.getFloat(
            context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f,
        ) == 0f

    fun rounded(color: Int, radius: Float, stroke: Int? = null, strokeWidth: Int = 1) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
        stroke?.let { setStroke(strokeWidth, it) }
    }

    /** A round button with one icon in it. */
    fun iconButton(
        context: Context, icon: Int, label: String, size: Int = 32, tint: Int = TEXT,
        background: Int = MUTED, onClick: () -> Unit,
    ): View {
        val dp = context.resources.displayMetrics.density
        return FrameLayout(context).apply {
            this.background = rounded(background, size * dp / 2)
            contentDescription = label
            isClickable = true
            setOnClickListener { onClick() }
            addView(ImageView(context).apply {
                setImageResource(icon)
                imageTintList = ColorStateList.valueOf(tint)
            }, FrameLayout.LayoutParams((size * dp * 0.55f).toInt(), (size * dp * 0.55f).toInt(), Gravity.CENTER))
            layoutParams = android.widget.LinearLayout.LayoutParams((size * dp).toInt(), (size * dp).toInt())
        }
    }

    /**
     * Fades in while growing from 95% and rising a few pixels, settling without a bounce.
     * With reduced motion it only fades, in 100 ms.
     */
    fun appear(view: View) {
        val dp = view.resources.displayMetrics.density
        val still = reducedMotion(view.context)
        view.animate().cancel()
        if (view.visibility != View.VISIBLE) {
            view.alpha = 0f
            view.scaleX = if (still) 1f else 0.95f
            view.scaleY = if (still) 1f else 0.95f
            view.translationY = if (still) 0f else 8 * dp
        }
        view.visibility = View.VISIBLE
        view.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
            .setDuration(if (still) 100 else LISTEN_MS).setInterpolator(EASE_OUT).withEndAction(null).start()
    }

    /** The reverse of appear, then GONE and `then`. */
    fun disappear(view: View, then: () -> Unit = {}) {
        if (view.visibility != View.VISIBLE) return then()
        val dp = view.resources.displayMetrics.density
        val still = reducedMotion(view.context)
        view.animate().cancel()
        view.animate().alpha(0f).scaleX(if (still) 1f else 0.95f).scaleY(if (still) 1f else 0.95f)
            .translationY(if (still) 0f else 4 * dp)
            .setDuration(if (still) 100 else DISMISS_MS).setInterpolator(EASE_IN).withEndAction {
                view.visibility = View.GONE
                view.alpha = 1f
                view.scaleX = 1f
                view.scaleY = 1f
                view.translationY = 0f
                then()
            }.start()
    }
}
