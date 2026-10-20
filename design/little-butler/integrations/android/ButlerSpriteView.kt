package your.app.butler

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot

/** Sprite renderer only. Your app owns overlay placement, controls and permissions. */
class ButlerSpriteView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs), Choreographer.FrameCallback {
    var onTap: (() -> Unit)? = null
    var onHold: (() -> Unit)? = null
    var onDragBy: ((Float, Float) -> Unit)? = null
    var onDragEnd: (() -> Unit)? = null
    var reduceMotion = false
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val src = Rect()
    private val dst = RectF()
    private val definitions = JSONObject(context.assets.open("butler/motion.json")
        .bufferedReader().use { it.readText() }).getJSONObject("states")
    private var strip: Bitmap? = null
    private var started = SystemClock.uptimeMillis()
    private var running = false
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var moved = false
    private var held = false
    private var beforeDrag = "idle"
    var state: String = "peek"
        private set
    private val holdAction = Runnable { held = true; onHold?.invoke() }

    init {
        contentDescription = "Little Butler. Tap to open controls."
        isClickable = true
        isFocusable = true
        setState("peek")
    }

    fun setState(name: String) {
        require(definitions.has(name)) { "Unknown Butler state: $name" }
        if (state != name || strip == null) {
            val next = context.assets.open("butler/animations/$name.png").use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inScaled = false })
            } ?: error("Invalid sprite strip: $name")
            val old = strip
            strip = next
            old?.recycle()
        }
        state = name
        started = SystemClock.uptimeMillis()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val spec = definitions.getJSONObject(state)
        val duration = spec.getLong("duration")
        val elapsed = SystemClock.uptimeMillis() - started
        if (!spec.getBoolean("loop") && elapsed >= duration) {
            setState(spec.optString("next", "idle"))
        }
        val current = definitions.getJSONObject(state)
        val time = SystemClock.uptimeMillis() - started
        val frame = if (reduceMotion) {
            // End frame of hidden clips preserves docked position; otherwise use a static key pose.
            if (state == "hide") 11 else 0
        } else ((time % current.getLong("duration")) * 12 / current.getLong("duration")).toInt().coerceIn(0, 11)
        strip?.let { image ->
            val frameWidth = image.width / 12
            src.set(frame * frameWidth, 0, (frame + 1) * frameWidth, image.height)
            val scale = minOf(width.toFloat() / frameWidth, height.toFloat() / image.height)
            val w = frameWidth * scale
            val h = image.height * scale
            dst.set((width - w) / 2, height - h, (width + w) / 2, height.toFloat())
            canvas.drawBitmap(image, src, dst, paint)
        }
    }

    private fun updateRunning() {
        val shouldRun = isAttachedToWindow && windowVisibility == VISIBLE && isShown
        if (shouldRun && !running) {
            running = true
            Choreographer.getInstance().postFrameCallback(this)
        } else if (!shouldRun && running) {
            running = false
            Choreographer.getInstance().removeFrameCallback(this)
        }
    }
    override fun doFrame(frameTimeNanos: Long) {
        if (!running) return
        invalidate()
        Choreographer.getInstance().postFrameCallback(this)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); updateRunning() }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility); updateRunning()
    }
    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(this)
        removeCallbacks(holdAction)
        super.onDetachedFromWindow()
    }
    override fun performClick(): Boolean {
        super.performClick(); onTap?.invoke(); return true
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.rawX; downY = event.rawY
                lastX = downX; lastY = downY; moved = false; held = false
                beforeDrag = state
                postDelayed(holdAction, 500)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val threshold = 7 * resources.displayMetrics.density
                if (hypot(event.rawX - downX, event.rawY - downY) > threshold) {
                    removeCallbacks(holdAction)
                    if (!moved) { moved = true; setState("drag") }
                    onDragBy?.invoke(event.rawX - lastX, event.rawY - lastY)
                    lastX = event.rawX; lastY = event.rawY
                }
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(holdAction)
                if (moved) { setState(beforeDrag); onDragEnd?.invoke() }
                else if (!held) performClick()
            }
            MotionEvent.ACTION_CANCEL -> {
                removeCallbacks(holdAction)
                if (moved) { setState(beforeDrag); onDragEnd?.invoke() }
            }
        }
        return true
    }
}
