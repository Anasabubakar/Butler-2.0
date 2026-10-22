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
 * The look Little Butler's floating pieces share: a dark palette (zinc, like shadcn/ui's dark
 * theme), round icon buttons, and quick fade-and-zoom animations for things coming and going.
 */
object Ui {
    const val BACKGROUND = 0xF209090B.toInt() // zinc-950, nearly opaque
    const val CARD = 0xFF18181B.toInt()       // zinc-900
    const val MUTED = 0xFF27272A.toInt()      // zinc-800
    const val BORDER = 0xFF3F3F46.toInt()     // zinc-700
    const val TEXT = 0xFFFAFAFA.toInt()       // zinc-50
    const val SUBTLE = 0xFFA1A1AA.toInt()     // zinc-400
    const val ACCENT = 0xFFE4462D.toInt()     // Butler 2.0 vermilion (--b2-vermilion)
    const val OK = 0xFF4ADE80.toInt()         // green-400
    const val DANGER = 0xFFF87171.toInt()     // red-400

    // shadcn's animations are 150-200 ms with a gentle ease-out.
    private val EASE_OUT = PathInterpolator(0.16f, 1f, 0.3f, 1f)
    private val EASE_IN = PathInterpolator(0.7f, 0f, 0.84f, 0f)

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

    /** Fades in while growing from 95% and rising a few pixels, like a shadcn popover. */
    fun appear(view: View) {
        val dp = view.resources.displayMetrics.density
        view.animate().cancel()
        if (view.visibility != View.VISIBLE) {
            view.alpha = 0f
            view.scaleX = 0.95f
            view.scaleY = 0.95f
            view.translationY = 8 * dp
        }
        view.visibility = View.VISIBLE
        view.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
            .setDuration(200).setInterpolator(EASE_OUT).withEndAction(null).start()
    }

    /** The reverse of appear, then GONE and `then`. */
    fun disappear(view: View, then: () -> Unit = {}) {
        if (view.visibility != View.VISIBLE) return then()
        val dp = view.resources.displayMetrics.density
        view.animate().cancel()
        view.animate().alpha(0f).scaleX(0.95f).scaleY(0.95f).translationY(4 * dp)
            .setDuration(130).setInterpolator(EASE_IN).withEndAction {
                view.visibility = View.GONE
                view.alpha = 1f
                view.scaleX = 1f
                view.scaleY = 1f
                view.translationY = 0f
                then()
            }.start()
    }
}
