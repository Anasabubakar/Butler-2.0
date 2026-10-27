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
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import com.anas.butler.transfer.Laptop
import com.anas.butler.transfer.Link
import com.anas.butler.transfer.Progress
import com.anas.butler.transfer.Saved
import com.anas.butler.transfer.Transfers
import kotlinx.coroutines.Job
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Little Butler on your phone: peeks from the bottom-right corner over every app.
 * Tap it for Save this, Copy this, Analyze this, Solve this, Send to laptop and Ask Butler;
 * hold it to type a command straight away. A bubble over its head says what it's doing.
 * It also checks for reminders and things sent from your laptop.
 */
class PetService : Service() {

    /** `dark`: nearly all black, so the picture may be missing what you saw. */
    private class Shot(val jpeg: ByteArray, val width: Int, val height: Int, val dark: Boolean = false)

    /** The app on screen hid it, so the screenshot came out black. */
    private class ScreenHidden(message: String) : IllegalStateException(message)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var windows: WindowManager
    private lateinit var pet: ButlerSpriteView
    private lateinit var petLayout: WindowManager.LayoutParams
    private lateinit var panel: LinearLayout
    private lateinit var panelLayout: WindowManager.LayoutParams
    private var petX = 0f // where the pet is while it's dragged: from the right and bottom edges
    private var petY = 0f
    private lateinit var menu: LinearLayout
    private lateinit var bubble: PetBubble
    private var bubbleTurn = 0 // goes up whenever the bubble says something new
    private var panelShown = false
    private var busy = false
    private lateinit var syncButton: TextView
    private var lastSynced: String? = null
    private var syncing = false
    private var operating = false
    private var stopOperating = false
    // A job you gave the laptop is running. The laptop reports at least every 10 minutes,
    // so after 15 minutes of silence the pet stops waiting on it.
    private var laptopUntil = 0L
    private val laptopWorking get() = SystemClock.elapsedRealtime() < laptopUntil
    // Files on their way, to or from the laptop: Stop cancels this.
    private var transfer: Job? = null
    private var progressAt = 0L

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
            reduceMotion = Ui.reducedMotion(this@PetService)
            onTap = { toggle() }
            onHold = { askButler(talk = false) } // hold: straight to typing a command
            // Drag it anywhere; it stays where you drop it, and remembers the spot.
            onDragBy = { dx, dy ->
                if (panelShown && !busy) {
                    panelShown = false
                    menu.visibility = View.GONE
                    panelIfEmpty()
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
        // Taller than the sprite, which sits at the bottom: the top is room for its "…" and badges.
        petLayout = overlay((72 * dp).toInt(), (106 * dp).toInt()).apply {
            x = prefs.getInt("x", (16 * dp).toInt())
            y = prefs.getInt("y", 0)
        }
        petX = petLayout.x.toFloat()
        petY = petLayout.y.toFloat()
        windows.addView(pet, petLayout)

        val wide = (MENU_WIDTH_DP * dp).toInt()
        menu = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.rounded(Ui.BACKGROUND, 20 * dp, Ui.MUTED, dp.toInt())
            elevation = 8 * dp
            setPadding((12 * dp).toInt(), (10 * dp).toInt(), (12 * dp).toInt(), (10 * dp).toInt())
            // Title and close: X puts the menu away and leaves just the pet.
            addView(LinearLayout(ui).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                // B2 · 17: "What needs handling?" in bold white on ink.
                addView(TextView(ui).apply {
                    setText(R.string.pet_menu_heading)
                    setTextColor(Ui.TEXT)
                    textSize = 18f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(Ui.iconButton(ui, R.drawable.ic_close, getString(R.string.close), size = 30, tint = Ui.SUBTLE,
                    background = 0x00000000) { closeMenu() })
            }, LinearLayout.LayoutParams(wide, LinearLayout.LayoutParams.WRAP_CONTENT))
            // The command bar. Tapping it opens the typing sheet with the keyboard up
            // (a box inside the floating pet can't take typing itself); the mic opens it listening.
            addView(LinearLayout(ui).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.CARD, 14 * dp, Ui.BORDER, dp.toInt())
                setPadding((12 * dp).toInt(), (6 * dp).toInt(), (6 * dp).toInt(), (6 * dp).toInt())
                setOnClickListener { askButler(talk = false) }
                addView(icon(ui, R.drawable.ic_sparkle, Ui.ACCENT, 18), LinearLayout.LayoutParams((18 * dp).toInt(), (18 * dp).toInt()).apply {
                    marginEnd = (10 * dp).toInt()
                })
                addView(TextView(ui).apply {
                    setText(R.string.pet_ask_box)
                    setTextColor(Ui.SUBTLE)
                    textSize = 15f
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                if (Config(this@PetService).microphone) {
                    addView(Ui.iconButton(ui, R.drawable.ic_mic, getString(R.string.pet_talk), size = 36, tint = Ui.CARD,
                        background = Ui.TEXT) { askButler(talk = true) })
                }
            }, LinearLayout.LayoutParams(wide, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = (8 * dp).toInt() })
            addView(TextView(ui).apply {
                setText(R.string.pet_menu_title)
                setTextColor(Ui.SUBTLE)
                textSize = 12f
                setPadding((4 * dp).toInt(), (12 * dp).toInt(), 0, (4 * dp).toInt())
            })
            // Quick actions, two to a row.
            val actions = listOf<Triple<Int, Int, () -> Unit>>(
                Triple(R.drawable.ic_bookmark, R.string.pet_save, ::saveThis),
                Triple(R.drawable.ic_copy, R.string.pet_copy, ::copyThis),
                Triple(R.drawable.ic_search, R.string.pet_analyze, { look("analyze") }),
                Triple(R.drawable.ic_lightbulb, R.string.pet_solve, { look("solve") }),
                Triple(R.drawable.ic_translate, R.string.pet_translate, { look("translate") }),
                Triple(R.drawable.ic_send, R.string.pet_send_laptop, ::sendToLaptop),
                Triple(R.drawable.ic_laptop, R.string.pet_laptop, ::openLaptop),
                Triple(R.drawable.ic_library, R.string.pet_library, ::openLibrary),
            )
            for (pair in actions.chunked(2)) {
                addView(LinearLayout(ui).apply {
                    orientation = LinearLayout.HORIZONTAL
                    for ((iconRes, label, action) in pair) {
                        addView(tile(ui, iconRes, getString(label), action),
                            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                                setMargins((3 * dp).toInt(), (3 * dp).toInt(), (3 * dp).toInt(), (3 * dp).toInt())
                            })
                    }
                }, LinearLayout.LayoutParams(wide, LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            // Clipboard sync (off until you turn it on) and Hide, smaller, at the bottom.
            addView(LinearLayout(ui).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, (6 * dp).toInt(), 0, 0)
                addView(small(ui, R.drawable.ic_sync, syncLabel()) { toggleSync() }.also { syncButton = it.getChildAt(1) as TextView },
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(small(ui, R.drawable.ic_hide, getString(R.string.pet_hide)) { stopSelf() })
            }, LinearLayout.LayoutParams(wide, LinearLayout.LayoutParams.WRAP_CONTENT))
            visibility = View.GONE
        }
        bubble = PetBubble(ui).apply {
            visibility = View.GONE
            onClose = {
                if (Ringer.ringing) stopRinging()
                bubbleTurn++
                hideBubble()
            }
            onCopy = { copyToClipboard(it); progressNote(getString(R.string.pet_copied)) }
            onShare = { shareText(it) }
            onReply = { said ->
                bubbleTurn++
                hideBubble()
                askButler(talk = false, replyTo = said)
            }
        }
        panel = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
            addView(bubble, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = (6 * dp).toInt()
            })
            addView(menu)
            visibility = View.GONE
        }
        panelLayout = overlay(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT)
        windows.addView(panel, panelLayout)
        placePanel()
        pet.setState(restingFace())

        // Reminders and things sent from your laptop. While the laptop is on a job of yours,
        // the pet keeps a line open so its updates show up within a second or two.
        scope.launch {
            var prefsAt = 0L
            while (isActive) {
                if (SystemClock.elapsedRealtime() - prefsAt > PREFS_EVERY_MS || prefsAt == 0L) {
                    prefsAt = SystemClock.elapsedRealtime()
                    refreshPrefs()
                }
                val waited = checkInbox(wait = laptopWorking)
                if (!laptopWorking || !waited) delay(INBOX_EVERY_MS)
            }
        }
        // Files the laptop hands over directly on the same Wi-Fi, even with no internet.
        scope.launch { laptopOffers() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP_RING) stopRinging()
        if (intent?.action == SEND_FILES && ::pet.isInitialized) {
            val clip = intent.clipData
            val uris = List(clip?.itemCount ?: 0) { clip!!.getItemAt(it).uri }.filterNotNull()
            if (uris.isNotEmpty()) sendFiles(uris)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        Ringer.stop(this)
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

    private fun icon(ui: Context, res: Int, tint: Int, sizeDp: Int) = ImageView(ui).apply {
        setImageResource(res)
        imageTintList = ColorStateList.valueOf(tint)
        val px = (sizeDp * resources.displayMetrics.density).toInt()
        layoutParams = LinearLayout.LayoutParams(px, px)
    }

    /** One of the menu's quick actions: an icon over a label, on a dark card that dims when pressed. */
    private fun tile(ui: Context, iconRes: Int, label: String, action: () -> Unit) = LinearLayout(ui).apply {
        val dp = resources.displayMetrics.density
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = Ui.rounded(Ui.CARD, 12 * dp, Ui.BORDER, dp.toInt())
        minimumHeight = (48 * dp).toInt()
        setPadding((10 * dp).toInt(), (11 * dp).toInt(), (8 * dp).toInt(), (11 * dp).toInt())
        addView(icon(ui, iconRes, Ui.TEXT, 18))
        addView(TextView(ui).apply {
            text = label
            setTextColor(Ui.TEXT)
            textSize = 13.5f
            isSingleLine = true
            setPadding((8 * dp).toInt(), 0, 0, 0)
        })
        pressable(this)
        setOnClickListener { action() }
    }

    private fun small(ui: Context, iconRes: Int, label: String, action: () -> Unit) = LinearLayout(ui).apply {
        val dp = resources.displayMetrics.density
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding((6 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt(), (4 * dp).toInt())
        addView(icon(ui, iconRes, Ui.SUBTLE, 16))
        addView(TextView(ui).apply {
            text = label
            setTextColor(Ui.SUBTLE)
            textSize = 12.5f
            setPadding((6 * dp).toInt(), 0, 0, 0)
        })
        pressable(this)
        setOnClickListener { action() }
    }

    /** Shrinks a touch while pressed, like a shadcn button. */
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    /** Pressed state: a slight shrink, or just a dim with reduced motion. */
    private fun pressable(view: View) = view.setOnTouchListener { v, event ->
        val still = Ui.reducedMotion(v.context)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> if (still) v.alpha = 0.7f else v.animate().scaleX(0.96f).scaleY(0.96f).setDuration(80).start()
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (still) v.alpha = 1f else v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        }
        false
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
        // Measured as wide as the screen at most, the way it will be shown, so it's placed right.
        panel.measure(View.MeasureSpec.makeMeasureSpec(screen.widthPixels, View.MeasureSpec.AT_MOST), View.MeasureSpec.UNSPECIFIED)
        val above = petLayout.y + petLayout.height + gap
        panelLayout.y = if (above + panel.measuredHeight <= screen.heightPixels) above
        else (petLayout.y - panel.measuredHeight - gap).coerceAtLeast(0)
        panelLayout.x = petLayout.x.coerceAtMost((screen.widthPixels - panel.measuredWidth).coerceAtLeast(0))
        windows.updateViewLayout(panel, panelLayout)
    }

    private fun toggle() {
        pet.reduceMotion = Ui.reducedMotion(this) // the setting may have changed since
        if (Ringer.ringing) return stopRinging()
        if (operating) {
            stopOperating = true
            say(getString(R.string.pet_stopping))
            return
        }
        if (busy) return
        if (panelShown) return closeMenu()
        panelShown = true
        // A laptop job's bubble stays up over the menu; anything else makes way.
        if (!laptopWorking) bubble.visibility = View.GONE
        panel.visibility = View.VISIBLE
        Ui.appear(menu)
        placePanel()
        pet.setState("summon")
    }

    private fun openLibrary() {
        closeMenu()
        startActivity(Intent(this, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // --- clipboard sync ------------------------------------------------------------------

    private fun syncLabel() = getString(if (Config(this).clipboardSync) R.string.pet_sync_on else R.string.pet_sync_off)

    private fun toggleSync() {
        val config = Config(this)
        config.clipboardSync = !config.clipboardSync
        syncButton.text = syncLabel()
        say(getString(if (config.clipboardSync) R.string.pet_sync_turned_on else R.string.pet_sync_turned_off))
        if (config.clipboardSync) askUnrestrictedBattery()
    }

    /**
     * Android's battery limits pause Butler while the phone is idle, and then nothing syncs.
     * Asks once (Android's own Allow / Deny box) to let Butler keep checking in.
     */
    private fun askUnrestrictedBattery() {
        if (getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)) return
        runCatching {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
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

    // --- the bubble over the pet's head ------------------------------------------------

    private fun showBubble() {
        panel.visibility = View.VISIBLE
        Ui.appear(bubble)
        placePanel()
    }

    private fun hideBubble() {
        Ui.disappear(bubble) { panelIfEmpty() }
        if (!panelShown && !busy && !operating && !laptopWorking) restPet()
    }

    /** X, or anything that takes you elsewhere: the menu goes, the pet stays. */
    private fun closeMenu() {
        panelShown = false
        Ui.disappear(menu) { panelIfEmpty() }
        if (!busy && !laptopWorking) restPet()
    }

    /** The floating window goes once nothing in it is showing; else it fits what's left. */
    private fun panelIfEmpty() {
        if (menu.visibility != View.VISIBLE && bubble.visibility != View.VISIBLE) panel.visibility = View.GONE
        else placePanel()
    }

    private fun restPet() {
        pet.effect(ButlerSpriteView.Effect.NONE)
        pet.setState(restingFace())
    }

    /** A new line in the bubble: what it's doing now, if it's working, else a short note. */
    private fun say(text: String) {
        bubbleTurn++
        if (bubble.working) bubble.progress(text) else bubble.info(text)
        showBubble()
        if (!bubble.working) lingerThenHide(text)
    }

    private fun progressNote(text: String) {
        if (bubble.working) bubble.progress(text) else say(text)
    }

    /** Shows a finished result with Copy and Share, then tucks it away unless you're reading it. */
    private fun tell(text: String, ok: Boolean, device: String? = null) {
        bubbleTurn++
        pet.setState(if (ok) "success" else "error")
        pet.effect(if (ok) ButlerSpriteView.Effect.DONE else ButlerSpriteView.Effect.FAILED)
        bubble.result(text, ok, device)
        showBubble()
        Speaker.say(this, text)
        lingerThenHide(text)
    }

    private fun lingerThenHide(text: String) {
        val mine = bubbleTurn
        scope.launch {
            val until = SystemClock.uptimeMillis() + (text.length * 60L).coerceIn(4000L, 30_000L)
            while (bubbleTurn == mine && (bubble.expanded || SystemClock.uptimeMillis() < until)) delay(250)
            if (bubbleTurn == mine) hideBubble()
        }
    }

    private fun shareText(text: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Runs an action with a working face and the bubble's spinner, then shows the result. */
    private fun work(working: String, face: String = "work", stoppable: Boolean = false, action: suspend () -> String) {
        if (busy) return
        busy = true
        panelShown = false
        menu.visibility = View.GONE
        pet.setState(face)
        pet.effect(ButlerSpriteView.Effect.WORKING)
        bubbleTurn++
        val here = getString(R.string.ask_on_phone)
        bubble.working(working, if (stoppable) ({
            stopOperating = true
            bubble.progress(getString(R.string.pet_stopping))
        }) else null, device = here)
        showBubble()
        scope.launch {
            val (message, ok) = runCatching { action() }.fold(
                onSuccess = { it to true },
                onFailure = { getString(R.string.pet_failed, it.message ?: it.toString()) to false },
            )
            busy = false
            tell(message, ok, here)
        }
    }

    // --- seeing and tapping ------------------------------------------------------------

    private fun hands(): HandsService =
        HandsService.instance ?: throw IllegalStateException(getString(R.string.pet_needs_hands))

    /** A screenshot without the pet or its notes in it. Never a black one: throws ScreenHidden instead. */
    private suspend fun snap(): Shot {
        val hands = hands()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw IllegalStateException(getString(R.string.pet_needs_android_11))
        val panelWas = panel.visibility
        pet.visibility = View.INVISIBLE
        panel.visibility = View.INVISIBLE
        delay(150)
        try {
            var bitmap = hands.screenshot() ?: throw IllegalStateException(getString(R.string.pet_no_screenshot))
            if (withContext(Dispatchers.Default) { HandsService.isBlank(bitmap) }) {
                // Once more, after a moment: a black one can be a frame caught mid-change.
                // Android allows one screenshot about every third of a second.
                delay(500)
                bitmap = hands.screenshot() ?: bitmap
            }
            if (withContext(Dispatchers.Default) { HandsService.isBlank(bitmap) }) throw ScreenHidden(getString(R.string.pet_screen_hidden))
            val dark = withContext(Dispatchers.Default) { HandsService.isMostlyDark(bitmap) }
            val jpeg = withContext(Dispatchers.Default) {
                ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
            }
            return Shot(jpeg, bitmap.width, bitmap.height, dark)
        } finally {
            pet.visibility = View.VISIBLE
            panel.visibility = panelWas
        }
    }

    /** Asks Butler where `target` is and taps it. False if it isn't on screen. */
    private suspend fun tapOn(shot: Shot, target: String): Boolean {
        val (x, y) = ScreenClient(Config(this)).locate(shot.jpeg, target) ?: return false
        return hands().tap(x / 1000f * shot.width, y / 1000f * shot.height)
    }

    /** Taps the post's Share button, then Copy link, and reads the link. Null if any step fails. */
    private suspend fun linkFromShare(shot: Shot?): String? {
        var menuOpen = false
        return try {
            // The button's label first; the screenshot guess only if the app doesn't label it.
            val shared = hands().pressLabelled(HandsService.SHARE) || (shot != null && tapOn(shot,
                SHARE_LOOK))
            if (!shared) return null
            menuOpen = true
            delay(900)
            // Empty first, so an old link on the clipboard is never saved as this post's.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) getSystemService(ClipboardManager::class.java).clearPrimaryClip()
            val copied = hands().pressLabelled(HandsService.COPY_LINK) || tapOn(snap(), "the \"Copy link\" option in the share menu")
            if (!copied) return null
            menuOpen = false
            // Apps copy a moment after the tap (some fetch a short link first), so look a few times.
            for (wait in listOf(600L, 900L, 1200L, 1500L)) {
                delay(wait)
                ClipReadActivity.read(this)?.let { URL.find(it)?.value }?.let { return it }
            }
            null
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
        // A hidden screen still saves the link, just without the black picture.
        val shot = try { snap() } catch (e: ScreenHidden) { null }
        // When the picture is black or nearly so, the words on screen are kept too. Read now,
        // before the Share menu covers them.
        val words = if (shot == null || shot.dark) hands().screenText() else null
        var link = hands().browserUrl()
        if (link == null || isFeed(link) || Uri.parse(link).path.isNullOrBlank() || Uri.parse(link).path == "/") {
            say(getString(R.string.pet_finding_share))
            link = linkFromShare(shot) ?: link
        }
        val text = listOfNotNull(link, words?.let { "On screen:\n$it" }).joinToString("\n\n").ifBlank { null }
        if (shot == null) {
            if (text == null) throw IllegalStateException(getString(R.string.pet_screen_hidden))
            UploadWorker.enqueue(this, text, null, null, null)
            return@work getString(if (words != null) R.string.pet_saved_words else R.string.pet_saved_link_only)
        }
        val dir = File(filesDir, "outbox/${UUID.randomUUID()}").apply { mkdirs() }
        val file = File(dir, "screenshot.jpg").apply { writeBytes(shot.jpeg) }
        UploadWorker.enqueue(this, text, null, file, "image/jpeg")
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

    /**
     * Send to laptop: the page in a browser, else the selected text, else the real file you're
     * looking at or picked (the pet presses the app's own Share button and chooses Butler's
     * "Send to laptop", since Android only hands files over through Share), else a screenshot.
     */
    private fun sendToLaptop() {
        val link = HandsService.instance?.browserUrl()
        val selected = HandsService.instance?.selectedText()
        if (link == null && selected == null && HandsService.instance != null) return shareForMe()
        work(getString(R.string.pet_sending)) {
            val config = Config(this)
            if (!config.isReady) throw IllegalStateException(getString(R.string.setup_first))
            val butler = ButlerClient(config)
            when {
                link != null -> butler.send("laptop", "link", url = link).let { getString(R.string.pet_sent_page) }
                selected != null -> butler.send("laptop", "clip", text = selected).let { getString(R.string.pet_sent_text) }
                else -> sendScreenshot(butler)
            }
        }
    }

    private suspend fun sendScreenshot(butler: ButlerClient): String {
        butler.send("laptop", "file", file = ButlerClient.Attachment("screenshot.jpg", snap().jpeg, "image/jpeg"))
        return getString(R.string.pet_sent_screenshot)
    }

    /**
     * Presses the Share button of the app you're in (Gallery, Files, Photos…), then Butler's
     * "Send to laptop" in the share menu, which hands over the real file or files you picked.
     * If Butler's option isn't in view, the menu stays open for you to tap it. With no Share
     * button at all, it sends a screenshot instead.
     */
    private fun shareForMe() {
        if (busy) return
        busy = true
        closeMenu()
        pet.setState("work")
        bubbleTurn++
        bubble.working(getString(R.string.pet_finding_file), device = getString(R.string.ask_on_phone))
        showBubble()
        scope.launch {
            delay(250) // the menu is out of the way
            val hands = HandsService.instance
            if (hands == null || !hands.pressLabelled(HandsService.SHARE)) {
                busy = false
                bubbleTurn++
                hideBubble()
                work(getString(R.string.pet_sending)) {
                    val config = Config(this@PetService)
                    if (!config.isReady) throw IllegalStateException(getString(R.string.setup_first))
                    sendScreenshot(ButlerClient(config))
                }
                return@launch
            }
            // Wait for the share menu, then look for "Send to laptop", scrolling its list if need be.
            val chose = run {
                repeat(8) { tries ->
                    delay(if (tries == 0) 900 else 450)
                    if (hands.pressLabelled(SEND_TARGET)) return@run true
                    if (tries in 3..6) hands.scrollForward()
                }
                false
            }
            busy = false
            if (chose) {
                bubbleTurn++
                hideBubble() // the share comes back to the pet, which shows it sending
            } else {
                bubbleTurn++
                bubble.info(getString(R.string.pet_pick_send))
                showBubble()
                lingerThenHide(getString(R.string.pet_pick_send))
            }
        }
    }

    // --- real files, to and from the laptop -----------------------------------------------

    /** Sends files picked in another app (from Share → Send to laptop). */
    private fun sendFiles(uris: List<Uri>) {
        if (transfer?.isActive == true) return say(getString(R.string.pet_busy_sending))
        val transfers = Transfers(this)
        val files = runCatching { transfers.describe(uris) }.getOrElse { e ->
            return tell(getString(R.string.pet_failed, e.message ?: e.toString()), false, getString(R.string.ask_on_phone))
        }
        if (files.isEmpty()) return say(getString(R.string.send_nothing))
        startTransfer(Progress(false, files.map { it.name }, 0, files.sumOf { it.size }, "", getString(R.string.transfer_laptop))) {
            val done = transfers.send("laptop", files, ::showTransfer)
            val via = getString(if (done.via == "wifi") R.string.transfer_wifi else R.string.transfer_server)
            val peer = if (done.via == "wifi") getString(R.string.transfer_laptop) else done.peer
            tell(getString(R.string.transfer_sent, filesWord(files.size), peer, via), true, getString(R.string.ask_on_phone))
        }
    }

    /** Files the laptop is sending through Butler. */
    private fun receiveFiles(from: String, body: JSONObject) {
        val transfers = Transfers(this)
        val files = body.optJSONArray("files")
        val names = List(files?.length() ?: 0) { files!!.getJSONObject(it).optString("name", "file") }
        scope.launch {
            while (transfer?.isActive == true) delay(1000) // one at a time
            startTransfer(Progress(true, names, 0, body.optLong("size"), "server", from)) {
                arrived(transfers.receiveFromServer(body, from, ::showTransfer))
            }
        }
    }

    /**
     * While this phone is on the same Wi-Fi as the laptop, it keeps asking the laptop (held
     * open, so it's answered at once) whether it has files to hand over. Works with no internet.
     */
    private suspend fun laptopOffers() {
        var laptop: Laptop? = null
        var lookedAt = 0L
        while (scope.isActive) {
            if (laptop == null) {
                if (Link.known(this) == null || SystemClock.elapsedRealtime() - lookedAt < LOOK_EVERY_MS && lookedAt != 0L) {
                    delay(15_000)
                    continue
                }
                lookedAt = SystemClock.elapsedRealtime()
                laptop = Link.find(this, listenMs = 2500)
                if (laptop == null) continue
            }
            val here = laptop!!
            val offers = runCatching {
                withContext(Dispatchers.IO) {
                    here.http(readSeconds = 40).newCall(here.request("/link/inbox?wait=25").build()).execute().use { res ->
                        if (!res.isSuccessful) throw java.io.IOException("answered ${res.code}")
                        org.json.JSONArray(res.body!!.string())
                    }
                }
            }.getOrNull()
            if (offers == null) {
                laptop = null // gone from this network: look again in a while
                continue
            }
            for (i in 0 until offers.length()) {
                val offer = offers.getJSONObject(i)
                while (transfer?.isActive == true) delay(1000) // one at a time
                val files = offer.getJSONArray("files")
                val names = List(files.length()) { files.getJSONObject(it).optString("name", "file") }
                startTransfer(Progress(true, names, 0, offer.optLong("size"), "wifi", getString(R.string.transfer_laptop))) {
                    arrived(Transfers(this@PetService).receiveFromLaptop(here, offer, ::showTransfer))
                }
                transfer?.join()
            }
        }
    }

    /** Shows files on their way over the pet's head, with Stop, and runs `action`. */
    private fun startTransfer(first: Progress, action: suspend () -> Unit) {
        busy = true
        panelShown = false
        menu.visibility = View.GONE
        pet.setState("work")
        pet.effect(ButlerSpriteView.Effect.WORKING)
        bubbleTurn++
        val where = if (first.incoming) getString(R.string.transfer_from, first.peer) else getString(R.string.ask_on_phone)
        bubble.working(transferLine(first), {
            transfer?.cancel()
            bubble.progress(getString(R.string.pet_stopping))
        })
        bubble.heading(getString(R.string.bubble_where, where, getString(if (first.incoming) R.string.state_receiving else R.string.state_sending)))
        bubble.bar(first.fraction, transferDetail(first))
        showBubble()
        transfer = scope.launch {
            try {
                action()
            } catch (e: kotlinx.coroutines.CancellationException) {
                tell(getString(R.string.pet_failed, getString(R.string.transfer_stopped)), false, where)
            } catch (e: Exception) {
                val why = e.message ?: e.toString()
                tell(if (first.incoming) getString(R.string.transfer_failed_in, first.peer, why) else getString(R.string.pet_failed, why), false, where)
            } finally {
                busy = false
            }
        }
    }

    /** A progress update, from whichever thread it came on; at most a few a second. */
    private fun showTransfer(p: Progress) {
        val now = SystemClock.elapsedRealtime()
        if (now - progressAt < 250 && p.done < p.size) return
        progressAt = now
        scope.launch {
            if (!busy || transfer?.isActive != true) return@launch
            bubble.progress(transferLine(p))
            bubble.bar(p.fraction, transferDetail(p))
        }
    }

    /** Files arrived: where they are, with Open (one file) or Show in Downloads (several). */
    private fun arrived(saved: Saved) {
        val text = getString(R.string.transfer_got, filesWord(saved.uris.size), saved.peer)
        tell(text, true, getString(R.string.ask_on_phone))
        bubble.heading(getString(R.string.bubble_where, getString(R.string.ask_on_phone), getString(R.string.state_received)))
        val open = Transfers.openIntent(this, saved).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        bubble.offer(getString(if (saved.uris.size == 1) R.string.transfer_open else R.string.transfer_show)) {
            runCatching { startActivity(open) }
            bubbleTurn++
            hideBubble()
        }
        placePanel()
        notifyArrived(text, open)
    }

    /** A notification too, for when the phone was in your pocket. */
    private fun notifyArrived(text: String, open: Intent) {
        val tap = PendingIntent.getActivity(this, nextNotification, open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, INBOX_CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setColor(Ui.ACCENT)
            .setContentTitle(getString(R.string.transfer_arrived))
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .addAction(0, getString(R.string.notify_open), tap)
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(nextNotification++, notification) }
    }

    private fun filesWord(n: Int) = resources.getQuantityString(R.plurals.files_count, n, n)

    /** "a.jpg", "a.jpg and b.pdf", "a.jpg, b.pdf and 3 more". */
    private fun namesText(names: List<String>): String = when {
        names.isEmpty() -> filesWord(0)
        names.size == 1 -> names[0]
        names.size == 2 -> getString(R.string.transfer_and, names[0], names[1])
        else -> getString(R.string.transfer_and_more, names.take(2).joinToString(", "), names.size - 2)
    }

    private fun transferLine(p: Progress) = getString(
        if (p.incoming) R.string.transfer_in_line else R.string.transfer_out_line, filesWord(p.names.size), namesText(p.names),
    )

    private fun transferDetail(p: Progress): String {
        val size = { b: Long -> android.text.format.Formatter.formatShortFileSize(this, b) }
        val base = getString(R.string.transfer_detail, (p.fraction * 100).toInt(), size(p.done), size(p.size))
        return when (p.via) {
            "wifi" -> "$base · ${getString(R.string.transfer_wifi)}"
            "server" -> "$base · ${getString(R.string.transfer_server)}"
            else -> base
        }
    }

    /**
     * Ask Butler: takes a screenshot of what you're looking at, then opens the typing (or talking)
     * sheet. `replyTo` is what the bubble said, when you're answering it.
     */
    private fun askButler(talk: Boolean, replyTo: String? = null) {
        if (busy) return
        busy = true
        pet.setState("listen")
        scope.launch {
            val shot = runCatching { snap() }.getOrNull()?.let { s ->
                File(cacheDir, "ask-${UUID.randomUUID()}.jpg").apply { writeBytes(s.jpeg) }
            }
            val link = HandsService.instance?.browserUrl()
            busy = false
            closeMenu()
            AskActivity.open(this@PetService, shot, link, talk, replyTo = replyTo)
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
    private fun operate(goal: String) = work(getString(R.string.pet_thinking), face = "work", stoppable = true) {
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
                progressNote(getString(R.string.pet_step, i, what.ifBlank { step.optString("do") }))
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

    /** Tell my laptop: the command sheet, set to the laptop. */
    private fun openLaptop() {
        closeMenu()
        AskActivity.open(this, null, null, talk = false, laptop = true)
    }

    /**
     * How a job you gave the laptop is going. While it works, the bubble shows the latest
     * line with a spinner and Stop; when it ends, the result with Copy and Share. The end
     * also goes in a quiet notification, in case you weren't looking at the screen.
     */
    private fun laptopStatus(state: String, title: String, text: String) {
        addLaptopNews("$title: $text")
        val running = state == "started" || state == "working"
        laptopUntil = if (running) SystemClock.elapsedRealtime() + LAPTOP_QUIET_MS else 0L
        if (running) {
            if (busy) return
            pet.setState("work")
            pet.effect(ButlerSpriteView.Effect.WORKING)
            bubbleTurn++
            val line = getString(R.string.bubble_laptop, text)
            if (bubble.working && bubble.visibility == View.VISIBLE) bubble.progress(line) else bubble.working(line, ::stopLaptop)
            bubble.heading(title) // "My laptop • Working", from Butler
            showBubble()
            return
        }
        quietly(title, text)
        if (!busy) {
            tell(text, ok = state == "done")
            bubble.heading(title)
        }
    }

    private fun stopLaptop() {
        bubble.progress(getString(R.string.laptop_stopping))
        scope.launch {
            runCatching { ButlerClient(Config(this@PetService)).laptopStop(off = false) }
                .onFailure { bubble.progress(getString(R.string.pet_failed, it.message ?: it.toString())) }
        }
    }

    /** A silent notification: no sound, no pop-down. */
    private fun quietly(title: String, text: String) {
        val tap = PendingIntent.getActivity(
            this, nextNotification, Intent(this, AskActivity::class.java).putExtra(AskActivity.EXTRA_LAPTOP, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, QUIET_CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setColor(Ui.ACCENT)
            .setGroup(QUIET_GROUP)
            .addAction(0, getString(R.string.notify_view), tap)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(nextNotification++, notification) }
    }

    /** Quiet mode and teasing are shared by every device; keep this phone's copy fresh. */
    private suspend fun refreshPrefs() {
        val config = Config(this)
        if (!config.isReady) return
        runCatching { ButlerClient(config).prefs() }.onSuccess {
            config.quiet = it.optBoolean("quiet", config.quiet)
            config.teasing = it.optString("teasing", config.teasing)
        }
        // How to reach the laptop directly, kept for when there's no internet.
        runCatching { Link.learn(this) }
    }

    // --- the inbox: reminders and things sent from your laptop -------------------------

    /** Takes what's waiting. With `wait`, the server holds on until something comes. False if offline. */
    private suspend fun checkInbox(wait: Boolean = false): Boolean {
        val config = Config(this)
        if (!config.isReady) return false
        val messages = runCatching { ButlerClient(config).inbox(wait) }.getOrNull() ?: return false // offline: next time
        for (i in 0 until messages.length()) runCatching { deliver(config, messages.getJSONObject(i)) }
        return true
    }

    private suspend fun deliver(config: Config, message: JSONObject) {
        val from = message.optString("from_device").takeIf { it != config.deviceName }
            ?.let { getString(R.string.inbox_from, it) }.orEmpty()
        val body = message.optString("body").takeIf { !message.isNull("body") }.orEmpty()
        when (message.optString("kind")) {
            "reminder" -> announce(getString(R.string.inbox_reminder), body, null, essential = true)
            "ring" -> ring(from)
            "status" -> { // how a job you gave the laptop is going
                val status = JSONObject(body)
                laptopStatus(status.optString("state"), status.optString("title"), status.optString("text"))
            }
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
            "transfer" -> receiveFiles(message.optString("from_device"), JSONObject(body))
            "file" -> {
                val (bytes, name) = ButlerClient(config).download(message.getString("item_id"))
                val open = saveDownload(bytes, name)
                announce(getString(R.string.inbox_file, from), name, open)
            }
            else -> announce(getString(R.string.inbox_note, from), body, null)
        }
    }

    // --- "where's my phone?" ------------------------------------------------------------

    private fun ring(from: String) {
        val stop = PendingIntent.getService(
            this, 0, Intent(this, PetService::class.java).setAction(STOP_RING), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, INBOX_CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setContentTitle(getString(R.string.ring_title))
            .setContentText(getString(R.string.ring_text, from))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(stop)
            .addAction(0, getString(R.string.ring_found), stop)
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(Ringer.NOTIFICATION, notification) }
        Ringer.start(this)
        if (!busy) {
            pet.setState("attention")
            bubbleTurn++
            bubble.info(getString(R.string.pet_ringing))
            showBubble()
        }
    }

    private fun stopRinging() {
        Ringer.stop(this)
        if (!::pet.isInitialized || busy) return
        bubbleTurn++
        hideBubble()
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

    /**
     * A notification you can tap (to open `open`), plus the pet saying it if it isn't busy.
     * B2 · 14: a clear title, one useful sentence and one relevant action. In quiet mode
     * only reminders interrupt; everything else arrives silently, grouped.
     */
    private fun announce(title: String, text: String, open: Intent?, essential: Boolean = false) {
        val quiet = Config(this).quiet && !essential
        val tap = open?.let {
            PendingIntent.getActivity(
                this, nextNotification, it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
        val notification = NotificationCompat.Builder(this, if (quiet) QUIET_CHANNEL else INBOX_CHANNEL)
            .setSmallIcon(R.drawable.ic_butler)
            .setColor(Ui.ACCENT)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(if (quiet) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .apply {
                if (quiet) setGroup(QUIET_GROUP)
                tap?.let {
                    setContentIntent(it)
                    addAction(0, getString(R.string.notify_open), it)
                }
            }
            .build()
        runCatching { getSystemService(NotificationManager::class.java).notify(nextNotification++, notification) }
        if (!busy && !quiet) {
            pet.setState("attention")
            bubbleTurn++
            bubble.result("$title: $text")
            showBubble()
            lingerThenHide(text)
        }
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
        manager.createNotificationChannel(
            NotificationChannel(QUIET_CHANNEL, getString(R.string.quiet_channel), NotificationManager.IMPORTANCE_LOW),
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
        private const val QUIET_CHANNEL = "updates"
        private const val QUIET_GROUP = "butler-updates"
        private const val PREFS_EVERY_MS = 10 * 60_000L
        private const val MENU_WIDTH_DP = 280
        private const val LAPTOP_QUIET_MS = 15 * 60_000L
        private const val INBOX_EVERY_MS = 20_000L
        private const val STOP_RING = "com.anas.butler.STOP_RING"
        private const val SEND_FILES = "com.anas.butler.SEND_FILES"
        private const val LOOK_EVERY_MS = 60_000L // how often to look for the laptop on this Wi-Fi

        /** Butler's own entry in an app's share menu. */
        private val SEND_TARGET = Regex("^send to laptop$", RegexOption.IGNORE_CASE)
        private const val MAX_STEPS = 15
        private const val SYNC_MAX = 20_000 // characters; bigger copies stay on the phone

        /** What the laptop said lately about the jobs you gave it, newest first. */
        val laptopNews = mutableListOf<String>()

        fun addLaptopNews(line: String) {
            synchronized(laptopNews) {
                laptopNews.add(0, line)
                while (laptopNews.size > 6) laptopNews.removeAt(laptopNews.size - 1)
            }
        }

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
            Regex("^https?://(www\\.|old\\.)?reddit\\.com/?([?#].*)?$"),
            Regex("^https?://([a-z]+\\.)?pinterest\\.[a-z.]+/?([?#].*)?$"),
            Regex("^https?://(www\\.)?snapchat\\.com/(spotlight/?)?([?#].*)?$"),
        )

        /** What the Share button looks like, for apps that don't label it. */
        private const val SHARE_LOOK = "the Share button of the main post in view. It looks different in each app: " +
            "a curved arrow (TikTok, YouTube, Facebook), a paper plane (Instagram, Threads), " +
            "an arrow out of a box (X, Pinterest), or the word Share. " +
            "Never the Save, Bookmark, Favourite, Like, Comment or Send-message button"

        fun isFeed(url: String) = FEEDS.any { it.matches(url) }

        fun start(context: Context) {
            context.startForegroundService(Intent(context, PetService::class.java))
        }

        /**
         * Hands files picked in another app to the pet, which sends them to the laptop. The
         * permission to read them comes along, and lasts while the pet runs.
         */
        fun sendFiles(context: Context, uris: List<Uri>) {
            val clip = ClipData.newRawUri("files", uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
            context.startForegroundService(Intent(context, PetService::class.java).setAction(SEND_FILES)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply { clipData = clip })
        }
    }
}
