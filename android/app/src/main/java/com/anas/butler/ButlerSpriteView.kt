package com.anas.butler

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Sprite renderer only. Your app owns overlay placement, controls and permissions.
 *
 * On top of the sprite's own clips it plays effects you can see from across the room:
 * a pop and bob with "…" dots while working, a hop and a green tick when done, and a
 * shake and a red "!" when something failed. The space above the sprite is for those.
 */
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

    enum class Effect { NONE, WORKING, DONE, FAILED }
    private var effect = Effect.NONE
    private var effectAt = 0L
    private val dp = resources.displayMetrics.density
    private val effectPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val markPath = Path()

    /** Starts an effect. DONE and FAILED play once and end by themselves; WORKING runs until changed. */
    fun effect(kind: Effect) {
        if (kind == effect && kind == Effect.WORKING) return
        effect = kind
        effectAt = SystemClock.uptimeMillis()
        invalidate()
    }

    private companion object {
        const val POP_MS = 380f
        const val HOP_MS = 520f
        const val SHAKE_MS = 700f
        const val BADGE_MS = 1800f
        const val ACCENT = 0xFFA78BFA.toInt()
        const val OK = 0xFF4ADE80.toInt()
        const val DANGER = 0xFFF87171.toInt()
    }

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
            canvas.save()
            if (!reduceMotion) moveForEffect(canvas)
            canvas.drawBitmap(image, src, dst, paint)
            canvas.restore()
            drawEffect(canvas)
        }
    }

    /** Pop, bob, hop or shake the sprite for the current effect. */
    private fun moveForEffect(canvas: Canvas) {
        val t = (SystemClock.uptimeMillis() - effectAt).toFloat()
        val cx = width / 2f
        val bottom = height.toFloat()
        when (effect) {
            Effect.WORKING -> {
                if (t < POP_MS) { // a quick pop as it starts
                    val s = 1f + 0.14f * sin(PI * t / POP_MS).toFloat()
                    canvas.scale(s, s, cx, bottom)
                }
                canvas.translate(0f, -3 * dp * abs(sin(2 * PI * t / 760)).toFloat())
            }
            Effect.DONE -> if (t < HOP_MS) canvas.translate(0f, -12 * dp * sin(PI * t / HOP_MS).toFloat())
            Effect.FAILED -> if (t < SHAKE_MS) {
                canvas.translate(7 * dp * sin(t / 28.0).toFloat() * exp(-t / 220.0).toFloat(), 0f)
            }
            Effect.NONE -> {}
        }
    }

    /** "…" dots over its head while working; a tick or "!" badge when it finishes. */
    private fun drawEffect(canvas: Canvas) {
        val t = (SystemClock.uptimeMillis() - effectAt).toFloat()
        when (effect) {
            Effect.WORKING -> {
                effectPaint.style = Paint.Style.FILL
                effectPaint.color = ACCENT
                for (i in 0..2) {
                    val phase = sin(2 * PI * (t / 900.0 - i * 0.18)).toFloat()
                    effectPaint.alpha = (150 + 105 * phase.coerceAtLeast(0f)).toInt()
                    canvas.drawCircle(width / 2f + (i - 1) * 9 * dp, 8 * dp - 3 * dp * phase.coerceAtLeast(0f), 3 * dp, effectPaint)
                }
            }
            Effect.DONE, Effect.FAILED -> {
                if (t > BADGE_MS) {
                    effect = Effect.NONE
                    return
                }
                // Pops in, stays, then fades.
                val grow = (t / 220f).coerceAtMost(1f)
                val size = 9 * dp * (if (grow < 1f) 1.25f * grow - 0.25f * grow * grow * grow else 1f)
                val fade = if (t > BADGE_MS - 400) (BADGE_MS - t) / 400f else 1f
                val x = width - 12 * dp
                val y = 12 * dp
                effectPaint.style = Paint.Style.FILL
                effectPaint.color = if (effect == Effect.DONE) OK else DANGER
                effectPaint.alpha = (255 * fade).toInt()
                canvas.drawCircle(x, y, size, effectPaint)
                effectPaint.color = 0xFF18181B.toInt()
                effectPaint.alpha = (255 * fade).toInt()
                effectPaint.strokeWidth = 2.2f * dp * grow
                effectPaint.strokeCap = Paint.Cap.ROUND
                effectPaint.style = Paint.Style.STROKE
                markPath.reset()
                if (effect == Effect.DONE) {
                    markPath.moveTo(x - 4 * dp, y)
                    markPath.lineTo(x - 1 * dp, y + 3 * dp)
                    markPath.lineTo(x + 4.5f * dp, y - 3.5f * dp)
                } else {
                    markPath.moveTo(x, y - 4.5f * dp)
                    markPath.lineTo(x, y + 1 * dp)
                    markPath.moveTo(x, y + 4 * dp)
                    markPath.lineTo(x, y + 4.2f * dp)
                }
                canvas.drawPath(markPath, effectPaint)
            }
            Effect.NONE -> {}
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
