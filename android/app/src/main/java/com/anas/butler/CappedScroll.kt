package com.anas.butler

import android.content.Context
import android.util.AttributeSet
import android.widget.ScrollView

/**
 * A ScrollView that grows with what's in it, up to a share of the screen's height, then scrolls.
 * Long answers stay readable to the last word without pushing buttons or the reply box off screen.
 */
class CappedScroll @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : ScrollView(context, attrs) {

    /** The most of the screen's height it may take, from 0 to 1. */
    var share = 0.45f
        set(value) {
            field = value
            requestLayout()
        }

    init {
        isFillViewport = false
        isVerticalScrollBarEnabled = true
        overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        var cap = (resources.displayMetrics.heightPixels * share).toInt()
        if (MeasureSpec.getMode(heightMeasureSpec) != MeasureSpec.UNSPECIFIED) cap = minOf(cap, MeasureSpec.getSize(heightMeasureSpec))
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(cap, MeasureSpec.AT_MOST))
    }
}
