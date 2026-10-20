package com.anas.butler

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
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
import android.os.Environment
import android.os.IBinder
import android.provider.MediaStore
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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Little Butler on your phone: peeks from the bottom-right corner over every app.
 * Tap it for Save this, Copy this, Analyze this, Solve this, Send to laptop and Ask Butler.
 * It also checks for reminders and things sent from your laptop.
 */
class PetService : Service() {

    private class Shot(val jpeg: ByteArray, val width: Int, val height: Int)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var windows: WindowManager
    private lateinit var pet: ButlerSpriteView
    private lateinit var petLayout: WindowManager.LayoutParams
    private lateinit var panel: LinearLayout
    private lateinit var panelLayout: WindowManager.LayoutParams
    private var petX = 0f // where the pet is while it's dragged: from the right and bottom edges
    private var petY = 0f
    private lateinit var menu: LinearLayout
    private lateinit var note: TextView
    private var panelShown = false
    private var busy = false
    private lateinit var syncButton: Button
    private var lastSynced: String? = null
    private var syncing = false
    private var noteTapped: CompletableDeferred<Unit>? = null
    private var operating = false
    private var stopOperating = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
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
            // Drag it anywhere; it stays where you drop it, and remembers the spot.
            onDragBy = { dx, dy ->
                if (panelShown && !busy) {
                    panelShown = false
                    panel.visibility = View.GONE
                }
                val screen = resources.displayMetrics
                petX = (petX - dx).coerceIn(0f, (screen.widthPixels - petLayout.width).toFloat())
                petY = (petY - dy).coerceIn(0f, (screen.heightPixels - petLayout.height).toFloat())
                petLayout.x = petX.toInt()
                petLayout.y = petY.toInt()
                windows.updateViewLayout(this, petLayout)
            }
            onDragEnd = { dropped() }
        }
        val prefs = getSharedPreferences("pet", MODE_PRIVATE)
        petLayout = overlay((72 * dp).toInt(), (90 * dp).toInt()).apply {
            x = prefs.getInt("x", (16 * dp).toInt())
            y = prefs.getInt("y", 0)
        }
        petX = petLayout.x.toFloat()
        petY = petLayout.y.toFloat()
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
            // Looks like a text box; tapping it opens the Ask sheet with the keyboard up.
            // (A box inside the floating pet can't take typing itself.)
            addView(TextView(ui).apply {
                setText(R.string.pet_ask_box)
                setTextColor(0xFF8A8F99.toInt())
                textSize = 16f
                background = GradientDrawable().apply {
                    setColor(0xFFF4F4F6.toInt())
                    setStroke(dp.toInt(), 0xFFD9DBE0.toInt())
                    cornerRadius = 10 * dp
                }
                setPadding((12 * dp).toInt(), (10 * dp).toInt(), (12 * dp).toInt(), (10 * dp).toInt())
                setOnClickListener { askButler(talk = false) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                setMargins((4 * dp).toInt(), (4 * dp).toInt(), (4 * dp).toInt(), (6 * dp).toInt())
            })
            for ((label, action) in listOf<Pair<Int, () -> Unit>>(
                R.string.pet_save to ::saveThis,
                R.string.pet_copy to ::copyThis,
                R.string.pet_analyze to { look("analyze") },
                R.string.pet_solve to { look("solve") },
                R.string.pet_send_laptop to ::sendToLaptop,
                R.string.pet_talk to { askButler(talk = true) },
                R.string.pet_hide to { stopSelf() },
            )) {
                addView(Button(ui).apply {
                    setText(label)
                    isAllCaps = false
                    setOnClickListener { action() }
                })
            }
            // Clipboard sync: what you copy here goes to the laptop's clipboard too. Off until you turn it on.
            addView(Button(ui).apply {
                syncButton = this
                text = syncLabel()
                isAllCaps = false
                setOnClickListener { toggleSync() }
            })
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
        panelLayout = overlay(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT)
        windows.addView(panel, panelLayout)
        placePanel()
        pet.setState(restingFace())

        // Reminders and things sent from your laptop.
        scope.launch {
            while (isActive) {
                checkInbox()
                delay(INBOX_EVERY_MS)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        if (instance === this) instance = null
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

    /** On the bottom edge it peeks; anywhere else it stands. */
    private fun restingFace() = if (petLayout.y < 24 * resources.displayMetrics.density) "peek" else "idle"

    private fun dropped() {
        val dp = resources.displayMetrics.density
        if (petLayout.y < 24 * dp) { // close to the bottom: dock on the edge again
            petLayout.y = 0
            petY = 0f
            windows.updateViewLayout(pet, petLayout)
        }
        getSharedPreferences("pet", MODE_PRIVATE).edit()
            .putInt("x", petLayout.x).putInt("y", petLayout.y).apply()
        pet.setState(restingFace())
        placePanel()
    }

    /** Puts the menu and notes above the pet, or below it when it's near the top. */
    private fun placePanel() {
        val screen = resources.displayMetrics
        val gap = (8 * resources.displayMetrics.density).toInt()
        panel.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        val above = petLayout.y + petLayout.height + gap
        panelLayout.y = if (above + panel.measuredHeight <= screen.heightPixels) above
        else (petLayout.y - panel.measuredHeight - gap).coerceAtLeast(0)
        panelLayout.x = petLayout.x.coerceAtMost((screen.widthPixels - panel.measuredWidth).coerceAtLeast(0))
        windows.updateViewLayout(panel, panelLayout)
    }

    private fun toggle() {
        if (operating) {
            stopOperating = true
            say(getString(R.string.pet_stopping))
            return
        }
        if (busy) return
        panelShown = !panelShown
        menu.visibility = View.VISIBLE
        note.visibility = View.GONE
        panel.visibility = if (panelShown) View.VISIBLE else View.GONE
        if (panelShown) placePanel()
        pet.setState(if (panelShown) "summon" else if (restingFace() == "peek") "hide" else "idle")
    }

    // --- clipboard sync ------------------------------------------------------------------

    private fun syncLabel() = getString(if (Config(this).clipboardSync) R.string.pet_sync_on else R.string.pet_sync_off)

    private fun toggleSync() {
        val config = Config(this)
        config.clipboardSync = !config.clipboardSync
        syncButton.text = syncLabel()
        say(getString(if (config.clipboardSync) R.string.pet_sync_turned_on else R.string.pet_sync_turned_off))
    }

    /**
     * Butler's hands saw you copy something. Android only lets the app in front read the
     * clipboard, so a see-through screen opens for a moment to read it, then it goes to the laptop.
     */
    fun copiedSomething() {
        val config = Config(this)
        if (!config.clipboardSync || !config.isReady || busy || syncing) return // the pet's own copying isn't yours
        syncing = true
        scope.launch {
            try {
                delay(400) // let the app finish copying
                val text = ClipReadActivity.read(this@PetService)
                if (text.isNullOrBlank() || text.length > SYNC_MAX || text == lastSynced) return@launch
                lastSynced = text
                runCatching { ButlerClient(config).send("laptop", "sync", text = text) }
            } finally {
                syncing = false
            }
        }
    }

    private fun say(text: String) {
        note.text = text
        note.visibility = View.VISIBLE
        panel.visibility = View.VISIBLE
        placePanel()
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
            pet.setState(if (restingFace() == "peek") "hide" else "idle")
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

    /** Send to laptop: the page in a browser, else the selected text, else a screenshot. */
    private fun sendToLaptop() = work(getString(R.string.pet_sending)) {
        val config = Config(this)
        if (!config.isReady) throw IllegalStateException(getString(R.string.setup_first))
        val butler = ButlerClient(config)
        val link = HandsService.instance?.browserUrl()
        val selected = HandsService.instance?.selectedText()
        when {
            link != null -> butler.send("laptop", "link", url = link).let { getString(R.string.pet_sent_page) }
            selected != null -> butler.send("laptop", "clip", text = selected).let { getString(R.string.pet_sent_text) }
            else -> butler.send("laptop", "file", file = ButlerClient.Attachment("screenshot.jpg", snap().jpeg, "image/jpeg"))
                .let { getString(R.string.pet_sent_screenshot) }
        }
    }

    /** Ask Butler: takes a screenshot of what you're looking at, then opens the typing (or talking) sheet. */
    private fun askButler(talk: Boolean) {
        if (busy) return
        busy = true
        scope.launch {
            val shot = runCatching { snap() }.getOrNull()?.let { s ->
                File(cacheDir, "ask-${UUID.randomUUID()}.jpg").apply { writeBytes(s.jpeg) }
            }
            val link = HandsService.instance?.browserUrl()
            panelShown = false
            panel.visibility = View.GONE
            pet.setState(restingFace())
            busy = false
            AskActivity.open(this@PetService, shot, link, talk)
        }
    }

    // --- doing things on screen --------------------------------------------------------

    /** Starts working on `goal` once the Ask sheet has closed. */
    fun operateSoon(goal: String) {
        scope.launch {
            delay(700)
            operate(goal)
        }
    }

    /**
     * Works towards `goal` one step at a time: a screenshot, Butler picks the next tap,
     * swipe or typing, the pet does it, repeat. Tap the pet to stop.
     */
    private fun operate(goal: String) = work(getString(R.string.pet_thinking), face = "work") {
        val config = Config(this)
        val done = mutableListOf<String>()
        operating = true
        stopOperating = false
        try {
            for (i in 1..MAX_STEPS) {
                if (stopOperating) return@work getString(R.string.pet_stopped)
                val shot = snap()
                val step = ScreenClient(config).step(shot.jpeg, goal, done)
                val what = step.optString("say")
                when (step.optString("do")) {
                    "done" -> return@work what.ifBlank { getString(R.string.pet_done) }
                    "stop" -> return@work what.ifBlank { getString(R.string.pet_cant_finish) }
                }
                if (stopOperating) return@work getString(R.string.pet_stopped)
                say(getString(R.string.pet_step, i, what.ifBlank { step.optString("do") }))
                val result = perform(step, shot)
                done += listOfNotNull(step.optString("do"), step.optString("text").takeIf { !step.isNull("text") && it.isNotBlank() }?.let { "\"$it\"" },
                    step.optString("key").takeIf { !step.isNull("key") && it.isNotBlank() })
                    .joinToString(" ") + ": $what" + (result?.let { " ($it)" } ?: "")
                delay(if (step.optString("do") == "wait") 1500 else 900)
            }
            getString(R.string.pet_too_many_steps, MAX_STEPS)
        } finally {
            operating = false
        }
    }

    /** Does one step. Returns a note if it couldn't, which Butler sees on the next step. */
    private suspend fun perform(step: JSONObject, shot: Shot): String? {
        val hands = hands()
        fun x(key: String, fallback: Double = 500.0) = (step.optDouble(key, fallback) / 1000.0 * shot.width).toFloat()
        fun y(key: String, fallback: Double = 500.0) = (step.optDouble(key, fallback) / 1000.0 * shot.height).toFloat()
        touchThrough(true) // our overlays mustn't catch the taps
        try {
            when (step.optString("do")) {
                "click" -> hands.tap(x("x"), y("y"))
                "double_click" -> { hands.tap(x("x"), y("y")); delay(90); hands.tap(x("x"), y("y")) }
                "long_press" -> hands.longPress(x("x"), y("y"))
                "type" -> if (!hands.type(step.optString("text"))) return "no text field had focus"
                "key" -> when (step.optString("key")) {
                    "enter" -> if (!hands.enter()) return "enter didn't work here"
                    "back", "escape" -> hands.back()
                    "home" -> hands.home()
                    else -> return "that key isn't on a phone"
                }
                "scroll" -> {
                    // Scrolling down means swiping up, by 40% of the screen.
                    val sx = x("x"); val sy = y("y")
                    val dx = shot.width * 0.4f; val dy = shot.height * 0.4f
                    when (step.optString("direction", "down")) {
                        "up" -> hands.drag(sx, sy - dy / 2, sx, sy + dy / 2, 350)
                        "left" -> hands.drag(sx - dx / 2, sy, sx + dx / 2, sy, 350)
                        "right" -> hands.drag(sx + dx / 2, sy, sx - dx / 2, sy, 350)
                        else -> hands.drag(sx, sy + dy / 2, sx, sy - dy / 2, 350)
                    }
                }
                "drag" -> hands.drag(x("x"), y("y"), x("x2", step.optDouble("x", 500.0)), y("y2", step.optDouble("y", 500.0)), 700)
            }
        } finally {
            touchThrough(false)
        }
        return null
    }

    /** While true, touches pass straight through the pet and its notes to the app underneath. */
    private fun touchThrough(on: Boolean) {
        for ((view, layout) in listOf(pet to petLayout, panel to panelLayout)) {
            layout.flags = if (on) layout.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            else layout.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
            windows.updateViewLayout(view, layout)
        }
    }

    // --- the inbox: reminders and things sent from your laptop -------------------------

    private suspend fun checkInbox() {
        val config = Config(this)
        if (!config.isReady) return
        val messages = runCatching { ButlerClient(config).inbox() }.getOrNull() ?: return // offline: next time
        for (i in 0 until messages.length()) runCatching { deliver(config, messages.getJSONObject(i)) }
    }

    private suspend fun deliver(config: Config, message: JSONObject) {
        val from = message.optString("from_device").takeIf { it != config.deviceName }
            ?.let { getString(R.string.inbox_from, it) }.orEmpty()
        val body = message.optString("body").takeIf { !message.isNull("body") }.orEmpty()
        when (message.optString("kind")) {
            "reminder" -> announce(getString(R.string.inbox_reminder), body, null)
            "sync" -> { // what you copied on the laptop, quietly
                lastSynced = body // so it isn't sent straight back
                copyToClipboard(body)
            }
            "clip" -> {
                copyToClipboard(body)
                announce(getString(R.string.inbox_copied, from), body.take(200), null)
            }
            "link" -> {
                val url = message.optString("url")
                announce(getString(R.string.inbox_link, from), url, Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
            "file" -> {
                val (bytes, name) = ButlerClient(config).download(message.getString("item_id"))
                val open = saveDownload(bytes, name)
                announce(getString(R.string.inbox_file, from), name, open)
            }
            else -> announce(getString(R.string.inbox_note, from), body, null)
        }
    }

    /** Puts a file in Downloads/Butler and returns an Intent that opens it (Android 10+). */
    private fun saveDownload(bytes: ByteArray, name: String): Intent? {
        val mime = android.webkit.MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
            File(dir, name).writeBytes(bytes)
            return null
        }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Butler")
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
        return Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    /** A notification you can tap (to open `open`), plus the pet saying it if it isn't busy. */
    private fun announce(title: String, text: String, open: Intent?) {
        val tap = open?.let {
            PendingIntent.getActivity(
                this, nextNotification, it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
        val notification = NotificationCompat.Builder(this, INBOX_CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .apply { tap?.let(::setContentIntent) }
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(nextNotification++, notification) }
        if (!busy) work(title, face = "attention") { "$title: $text" }
    }

    // --- foreground notification ------------------------------------------------------

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.pet_channel), NotificationManager.IMPORTANCE_MIN),
        )
        manager.createNotificationChannel(
            NotificationChannel(INBOX_CHANNEL, getString(R.string.inbox_channel), NotificationManager.IMPORTANCE_HIGH),
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
        private const val INBOX_CHANNEL = "inbox"
        private const val INBOX_EVERY_MS = 20_000L
        private const val MAX_STEPS = 15
        private const val SYNC_MAX = 20_000 // characters; bigger copies stay on the phone

        /** The running pet, so the Ask sheet can hand it screen tasks. */
        var instance: PetService? = null
            private set
        private var nextNotification = 100
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
