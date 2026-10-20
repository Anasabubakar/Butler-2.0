package com.anas.butler

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Little Butler on your phone: peeks from the bottom-right corner over every app.
 * Tap it for Save this, Copy this, Analyze this and Solve this.
 */
class PetService : Service() {

    private class Shot(val jpeg: ByteArray, val width: Int, val height: Int)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var windows: WindowManager
    private lateinit var pet: ButlerSpriteView
    private lateinit var petLayout: WindowManager.LayoutParams
    private lateinit var panel: LinearLayout
    private lateinit var menu: LinearLayout
    private lateinit var note: TextView
    private var panelShown = false
    private var busy = false
    private var noteTapped: CompletableDeferred<Unit>? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return
        }
        windows = getSystemService(WindowManager::class.java)
        val ui = ContextThemeWrapper(this, R.style.Theme_Butler)
        val dp = resources.displayMetrics.density

        pet = ButlerSpriteView(ui).apply {
            onTap = { toggle() }
            onDragBy = { dx, dy ->
                petLayout.x = (petLayout.x - dx.toInt()).coerceAtLeast(0)
                petLayout.y = (petLayout.y - dy.toInt()).coerceAtLeast(0)
                windows.updateViewLayout(this, petLayout)
            }
        }
        petLayout = overlay((72 * dp).toInt(), (90 * dp).toInt()).apply { x = (16 * dp).toInt() }
        windows.addView(pet, petLayout)

        menu = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(0xFFFFFFFF.toInt(), 16 * dp)
            setPadding((8 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
            addView(TextView(ui).apply {
                setText(R.string.pet_menu_title)
                setTextColor(0xFF555B66.toInt())
                setPadding((8 * dp).toInt(), (4 * dp).toInt(), (8 * dp).toInt(), (4 * dp).toInt())
            })
            for ((label, action) in listOf<Pair<Int, () -> Unit>>(
                R.string.pet_save to ::saveThis,
                R.string.pet_copy to ::copyThis,
                R.string.pet_analyze to { look("analyze") },
                R.string.pet_solve to { look("solve") },
                R.string.pet_hide to { stopSelf() },
            )) {
                addView(Button(ui).apply {
                    setText(label)
                    isAllCaps = false
                    setOnClickListener { action() }
                })
            }
        }
        note = TextView(ui).apply {
            background = rounded(0xFF1B1B22.toInt(), 14 * dp)
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 15f
            maxWidth = (300 * dp).toInt()
            setPadding((14 * dp).toInt(), (10 * dp).toInt(), (14 * dp).toInt(), (10 * dp).toInt())
            visibility = View.GONE
            setOnClickListener { noteTapped?.complete(Unit) }
        }
        panel = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
            addView(note)
            addView(menu)
            visibility = View.GONE
        }
        windows.addView(panel, overlay(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
            x = (16 * dp).toInt()
            y = (96 * dp).toInt()
        })
        pet.setState("peek")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        scope.cancel()
        if (::pet.isInitialized) {
            runCatching { windows.removeView(pet) }
            runCatching { windows.removeView(panel) }
        }
        super.onDestroy()
    }

    // --- windows -------------------------------------------------------------------------

    private fun overlay(width: Int, height: Int) = WindowManager.LayoutParams(
        width, height,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.BOTTOM or Gravity.END }

    private fun rounded(color: Int, radius: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
    }

    private fun toggle() {
        if (busy) return
        panelShown = !panelShown
        menu.visibility = View.VISIBLE
        note.visibility = View.GONE
        panel.visibility = if (panelShown) View.VISIBLE else View.GONE
        pet.setState(if (panelShown) "summon" else "hide")
    }

    private fun say(text: String) {
        note.text = text
        note.visibility = View.VISIBLE
        panel.visibility = View.VISIBLE
    }

    /** Runs an action with a working face and a note, then shows the result until it's read. */
    private fun work(working: String, face: String = "work", action: suspend () -> String) {
        if (busy) return
        busy = true
        menu.visibility = View.GONE
        pet.setState(face)
        say(working)
        scope.launch {
            val message = runCatching { action() }.fold(
                onSuccess = { pet.setState("success"); it },
                onFailure = { pet.setState("error"); getString(R.string.pet_failed, it.message ?: it.toString()) },
            )
            say(message)
            noteTapped = CompletableDeferred()
            withTimeoutOrNull((message.length * 50L).coerceIn(2200L, 30_000L)) { noteTapped?.await() }
            noteTapped = null
            panelShown = false
            panel.visibility = View.GONE
            pet.setState("hide")
            busy = false
        }
    }

    // --- seeing and tapping ------------------------------------------------------------

    private fun hands(): HandsService =
        HandsService.instance ?: throw IllegalStateException(getString(R.string.pet_needs_hands))

    /** A screenshot without the pet or its notes in it. */
    private suspend fun snap(): Shot {
        val hands = hands()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw IllegalStateException(getString(R.string.pet_needs_android_11))
        pet.visibility = View.INVISIBLE
        panel.visibility = View.INVISIBLE
        delay(150)
        try {
            val bitmap = hands.screenshot() ?: throw IllegalStateException(getString(R.string.pet_no_screenshot))
            val jpeg = withContext(Dispatchers.Default) {
                ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
            }
            return Shot(jpeg, bitmap.width, bitmap.height)
        } finally {
            pet.visibility = View.VISIBLE
            panel.visibility = View.VISIBLE
        }
    }

    /** Asks Butler where `target` is and taps it. False if it isn't on screen. */
    private suspend fun tapOn(shot: Shot, target: String): Boolean {
        val (x, y) = ScreenClient(Config(this)).locate(shot.jpeg, target) ?: return false
        return hands().tap(x / 1000f * shot.width, y / 1000f * shot.height)
    }

    /** Taps the post's Share button, then Copy link, and reads the link. Null if any step fails. */
    private suspend fun linkFromShare(shot: Shot): String? {
        var menuOpen = false
        return try {
            if (!tapOn(shot, "the Share button of the main post in view")) return null
            menuOpen = true
            delay(900)
            if (!tapOn(snap(), "the \"Copy link\" option")) return null
            menuOpen = false
            delay(500)
            ClipReadActivity.read(this)?.let { URL.find(it)?.value }
        } catch (e: Exception) {
            null
        } finally {
            if (menuOpen) HandsService.instance?.back() // close a share menu that's still open
        }
    }

    private fun copyToClipboard(text: String) {
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Butler", text))
    }

    // --- the buttons -------------------------------------------------------------------

    /** Saves a screenshot plus the post's link: from the address bar, or Share → Copy link in apps and feeds. */
    private fun saveThis() = work(getString(R.string.pet_grabbing)) {
        val config = Config(this)
        if (!config.isReady) throw IllegalStateException(getString(R.string.setup_first))
        val shot = snap()
        var link = hands().browserUrl()
        if (link == null || isFeed(link) || Uri.parse(link).path.isNullOrBlank() || Uri.parse(link).path == "/") {
            say(getString(R.string.pet_finding_share))
            link = linkFromShare(shot) ?: link
        }
        val dir = File(filesDir, "outbox/${UUID.randomUUID()}").apply { mkdirs() }
        val file = File(dir, "screenshot.jpg").apply { writeBytes(shot.jpeg) }
        UploadWorker.enqueue(this, link, null, file, "image/jpeg")
        getString(if (link != null) R.string.pet_saved_link else R.string.pet_saved_screenshot)
    }

    private fun copyThis() = work(getString(R.string.pet_copying)) {
        val text = hands().selectedText() ?: throw IllegalStateException(getString(R.string.pet_select_first))
        copyToClipboard(text)
        getString(R.string.pet_copied)
    }

    /** Analyze this or Solve this: Butler looks at the screen and answers. The answer is copied too. */
    private fun look(mode: String) = work(
        getString(if (mode == "solve") R.string.pet_solving else R.string.pet_looking), face = "think",
    ) {
        val config = Config(this)
        if (!config.isReady) throw IllegalStateException(getString(R.string.setup_first))
        val answer = ScreenClient(config).look(snap().jpeg, mode).trim()
        copyToClipboard(answer)
        getString(R.string.pet_answer, answer)
    }

    // --- foreground notification ------------------------------------------------------

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.pet_channel), NotificationManager.IMPORTANCE_MIN),
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setContentTitle(getString(R.string.pet_notification))
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, 1, notification, type)
    }

    companion object {
        private const val CHANNEL = "pet"
        private val URL = Regex("https?://\\S+")

        // Feed pages, where the address bar shows the feed rather than the post you're looking at.
        private val FEEDS = listOf(
            Regex("^https?://(www\\.|m\\.)?tiktok\\.com/(foryou|following|explore)?/?([?#].*)?$"),
            Regex("^https?://(www\\.|mobile\\.)?(x|twitter)\\.com/(home|explore)/?([?#].*)?$"),
            Regex("^https?://(www\\.)?instagram\\.com/(explore/?)?([?#].*)?$"),
            Regex("^https?://(www\\.|m\\.|web\\.)?facebook\\.com/(watch/?)?([?#].*)?$"),
            Regex("^https?://(www\\.)?linkedin\\.com/feed/?([?#].*)?$"),
            Regex("^https?://(www\\.|m\\.)?youtube\\.com/?([?#].*)?$"),
            Regex("^https?://(www\\.)?threads\\.(net|com)/?([?#].*)?$"),
        )

        fun isFeed(url: String) = FEEDS.any { it.matches(url) }

        fun start(context: Context) {
            context.startForegroundService(Intent(context, PetService::class.java))
        }
    }
}
