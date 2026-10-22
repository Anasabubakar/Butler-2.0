package com.anas.butler

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.speech.RecognizerIntent
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButtonToggleGroup
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Tell Butler what to do: type or say it ("remind me at 3 to call Mum", "send this to my
 * laptop", "what does this mean?"). Little Butler takes a screenshot just before this
 * opens, so Butler knows what you were looking at.
 *
 * Switched to My laptop, it's a command for the laptop instead, with your secret word
 * somewhere in it. The laptop checks the word and takes it out, so it never reaches the AI.
 * The pet's bubble then shows what the laptop is doing.
 */
class AskActivity : AppCompatActivity() {

    private lateinit var input: EditText
    private lateinit var answer: TextView
    private lateinit var go: Button
    private lateinit var working: View
    private lateinit var workingText: TextView
    private lateinit var examples: LinearLayout
    private lateinit var news: TextView
    private var busy = false
    private var laptop = false

    private val listen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) {
            input.setText(heard)
            input.setSelection(heard.length)
            if (!laptop) ask() // for the laptop you check it first (and add your word), then press Send
        }
    }

    private var contactsAnswer: ((Boolean) -> Unit)? = null
    private val askContacts = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        contactsAnswer?.invoke(granted)
        contactsAnswer = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Config(this).isReady) {
            Toast.makeText(this, R.string.setup_first, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        setContentView(R.layout.activity_ask)
        window.setGravity(Gravity.BOTTOM)
        input = findViewById(R.id.ask_text)
        answer = findViewById(R.id.ask_answer)
        go = findViewById(R.id.ask_go)
        working = findViewById(R.id.ask_working)
        workingText = findViewById(R.id.ask_working_text)
        examples = findViewById(R.id.ask_examples)
        news = findViewById(R.id.ask_news)
        go.setOnClickListener { ask() }
        val where = findViewById<MaterialButtonToggleGroup>(R.id.ask_where)
        where.addOnButtonCheckedListener { _, id, checked -> if (checked) setLaptop(id == R.id.ask_laptop) }
        if (intent.getBooleanExtra(EXTRA_LAPTOP, false)) where.check(R.id.ask_laptop) else setLaptop(false)
        findViewById<Button>(R.id.ask_stop).setOnClickListener { stopLaptop(off = false) }
        findViewById<Button>(R.id.ask_off).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(R.string.laptop_off_confirm)
                .setPositiveButton(R.string.laptop_off) { _, _ -> stopLaptop(off = true) }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEND) ask()
            action == EditorInfo.IME_ACTION_SEND
        }
        findViewById<Button>(R.id.ask_talk).setOnClickListener { talk() }
        if (intent.getBooleanExtra(EXTRA_TALK, false) && savedInstanceState == null) {
            talk()
        } else {
            // Ready to type straight away: box focused, keyboard up.
            input.requestFocus()
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        }
    }

    override fun onDestroy() {
        if (isFinishing) intent.getStringExtra(EXTRA_SHOT)?.let { File(it).delete() }
        super.onDestroy()
    }

    /** Push to talk: Android's own speech recognizer, so Butler needs no microphone permission. */
    private fun talk() {
        val speech = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.ask_title))
        try {
            listen.launch(speech)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.ask_no_voice, Toast.LENGTH_LONG).show()
        }
    }

    /** This phone or the laptop: changes the hint, the examples, and where the command goes. */
    private fun setLaptop(on: Boolean) {
        laptop = on
        input.setHint(if (on) R.string.laptop_hint else R.string.ask_hint)
        go.setText(if (on) R.string.laptop_go else R.string.ask_go)
        // The secret word shouldn't end up in the keyboard's suggestions.
        input.imeOptions = EditorInfo.IME_ACTION_SEND or (if (on) EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING else 0)
        input.inputType = EditorInfo.TYPE_CLASS_TEXT or EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES or
            (if (on) EditorInfo.TYPE_TEXT_FLAG_NO_SUGGESTIONS else 0)
        getSystemService(InputMethodManager::class.java)?.restartInput(input)
        for (id in listOf(R.id.ask_explain, R.id.ask_laptop_controls)) {
            findViewById<View>(id).visibility = if (on) View.VISIBLE else View.GONE
        }
        showNews()
        answer.visibility = View.GONE
        val dp = resources.displayMetrics.density
        examples.removeAllViews()
        for (example in resources.getStringArray(if (on) R.array.laptop_examples else R.array.ask_examples)) {
            examples.addView(TextView(this).apply {
                text = example
                textSize = 13f
                background = getDrawable(R.drawable.ask_chip)
                setPadding((12 * dp).toInt(), (7 * dp).toInt(), (12 * dp).toInt(), (7 * dp).toInt())
                setOnClickListener {
                    input.setText(example.removeSuffix("…"))
                    input.setSelection(input.text.length)
                    input.requestFocus()
                }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = (8 * dp).toInt()
            })
        }
    }

    private fun showNews() {
        val lines = synchronized(PetService.laptopNews) { PetService.laptopNews.take(3) }
        news.text = lines.joinToString("\n\n")
        news.visibility = if (laptop && lines.isNotEmpty()) View.VISIBLE else View.GONE
    }

    private fun show(text: String) {
        working.visibility = View.GONE
        answer.text = text
        answer.visibility = View.VISIBLE
    }

    private fun setBusy(on: Boolean, label: Int = R.string.pet_thinking) {
        busy = on
        go.isEnabled = !on
        workingText.setText(label)
        working.visibility = if (on) View.VISIBLE else View.GONE
        if (on) answer.visibility = View.GONE
    }

    private fun ask() {
        val text = input.text.toString().trim()
        if (text.isEmpty() || busy) return
        if (laptop) return sendToLaptop(text)
        setBusy(true)
        val shot = intent.getStringExtra(EXTRA_SHOT)?.let(::File)?.takeIf { it.exists() }?.readBytes()
        lifecycleScope.launch {
            val message = runCatching { act(ButlerClient(Config(this@AskActivity)).command(text, shot), shot) }
                .getOrElse { getString(R.string.pet_failed, it.message ?: it.toString()) }
            setBusy(false)
            show(message)
            input.text.clear()
        }
    }

    /** Off to the laptop; then out of the way, so you can watch the pet's bubble. */
    private fun sendToLaptop(text: String) {
        setBusy(true, R.string.pet_sending)
        lifecycleScope.launch {
            val sent = runCatching { ButlerClient(Config(this@AskActivity)).laptopTask(text) }
            setBusy(false)
            sent.onSuccess {
                input.text.clear()
                show(getString(R.string.laptop_sent, it.joinToString(", ")))
                delay(1500)
                if (PetService.instance != null) finish()
            }.onFailure { show(getString(R.string.pet_failed, it.message ?: it.toString())) }
        }
    }

    private fun stopLaptop(off: Boolean) {
        lifecycleScope.launch {
            val said = runCatching { ButlerClient(Config(this@AskActivity)).laptopStop(off) }
                .fold({ getString(if (off) R.string.laptop_switched_off else R.string.laptop_stopping) }, { getString(R.string.pet_failed, it.message ?: it.toString()) })
            PetService.addLaptopNews(said)
            show(said)
            showNews()
        }
    }

    /** Does the part of Butler's plan that happens on the phone, and says what happened. */
    private suspend fun act(result: JSONObject, shot: ByteArray?): String {
        val say = result.optString("say")
        result.optJSONObject("message")?.let { return handoff(it, shot, say) }
        if (result.optString("action") == "screen") {
            val pet = PetService.instance ?: throw IllegalStateException(getString(R.string.ask_start_pet))
            pet.operateSoon(result.optString("goal"))
            finish() // out of the way, so the pet can see and tap the app underneath
            return say
        }
        result.optString("open").takeIf { it.startsWith("https://") }?.let {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
        }
        result.optString("confirm").takeIf { it.isNotEmpty() }?.let { id ->
            show(say)
            if (!confirm(say)) return getString(R.string.ask_not_sent)
            show(getString(R.string.pet_sending))
            return JSONObject(ButlerClient(Config(this)).post("/api/command/confirm", mapOf("confirm" to id), null))
                .optString("say")
        }
        val send = result.optJSONObject("send") ?: return say
        val target = send.optString("target", "laptop")
        val butler = ButlerClient(Config(this))
        val to = when (send.optString("content")) {
            "clipboard" -> {
                val copied = clipboardText() ?: throw IllegalStateException(getString(R.string.ask_copy_first))
                butler.send(target, "clip", text = copied)
            }
            "link" -> {
                val link = intent.getStringExtra(EXTRA_LINK) ?: throw IllegalStateException(getString(R.string.ask_no_link))
                butler.send(target, "link", url = link)
            }
            "screen" -> {
                val jpeg = shot ?: throw IllegalStateException(getString(R.string.pet_no_screenshot))
                butler.send(target, "file", file = ButlerClient.Attachment("screenshot.jpg", jpeg, "image/jpeg"))
            }
            else -> butler.send(target, "note", text = send.optString("text").ifBlank { null }
                ?: throw IllegalStateException(getString(R.string.ask_nothing_to_send)))
        }
        return say.ifBlank { getString(R.string.ask_sent, to.joinToString()) }
    }

    /** Asks Send or Cancel, for things that need your yes first, like an email. */
    private suspend fun confirm(text: String): Boolean = suspendCancellableCoroutine { cont ->
        val dialog = AlertDialog.Builder(this)
            .setMessage(text)
            .setPositiveButton(R.string.ask_send) { _, _ -> if (cont.isActive) cont.resume(true) }
            .setNegativeButton(R.string.cancel) { _, _ -> if (cont.isActive) cont.resume(false) }
            .setOnCancelListener { if (cont.isActive) cont.resume(false) }
            .show()
        cont.invokeOnCancellation { dialog.dismiss() }
    }

    /**
     * WhatsApp or Telegram: opens the app with the message (and the screenshot, if wanted)
     * ready for the person. You press Send; Butler never sends from your account itself.
     */
    private suspend fun handoff(message: JSONObject, shot: ByteArray?, say: String): String {
        val app = message.optString("app", "whatsapp")
        val name = message.optString("name").ifBlank { message.optString("person") }
        val text = message.optString("text")
        val number = message.optString("phone").takeIf { it.isNotBlank() && !message.isNull("phone") }
            ?: phoneFromContacts(message.optString("person"))
        val digits = number?.let(::international)?.filter { it.isDigit() }
        val image = shot?.takeIf { message.optBoolean("attach_screen") }?.let { bytes ->
            val file = File(cacheDir, "shared/screenshot.jpg").apply { parentFile?.mkdirs(); writeBytes(bytes) }
            FileProvider.getUriForFile(this, "$packageName.files", file)
        }
        val intent = when {
            app == "telegram" || image != null -> Intent(Intent.ACTION_SEND).apply {
                type = if (image != null) "image/jpeg" else "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                image?.let { putExtra(Intent.EXTRA_STREAM, it); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                setPackage(if (app == "telegram") "org.telegram.messenger" else "com.whatsapp")
                if (app != "telegram" && digits != null) putExtra("jid", "$digits@s.whatsapp.net")
            }
            else -> Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/${digits.orEmpty()}?text=${Uri.encode(text)}"))
        }
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent.createChooser(intent.setPackage(null), null)) // the app isn't installed: let them pick
        }
        val where = if (app == "telegram") "Telegram" else "WhatsApp"
        val how = if (digits != null && app != "telegram") getString(R.string.handoff_press_send)
        else getString(R.string.handoff_pick, name)
        return listOf(say, getString(R.string.handoff_opened, where, how)).filter { it.isNotBlank() }.joinToString("\n\n")
    }

    /** The first phone number saved for `name` in this phone's contacts (asks to read them once). */
    private suspend fun phoneFromContacts(name: String): String? {
        if (name.isBlank()) return null
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            val granted = suspendCancellableCoroutine { cont ->
                contactsAnswer = { if (cont.isActive) cont.resume(it) }
                askContacts.launch(Manifest.permission.READ_CONTACTS)
            }
            if (!granted) return null
        }
        val uri = Uri.withAppendedPath(ContactsContract.CommonDataKinds.Phone.CONTENT_FILTER_URI, Uri.encode(name))
        return contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }
    }

    /** A number in international form (+234…), using the SIM's country for local numbers. */
    private fun international(number: String): String {
        if (number.trim().startsWith("+")) return number
        val country = (getSystemService(TelephonyManager::class.java)?.simCountryIso?.takeIf { it.isNotBlank() }
            ?: Locale.getDefault().country).uppercase()
        return PhoneNumberUtils.formatNumberToE164(number, country) ?: number
    }

    private fun clipboardText(): String? =
        getSystemService(ClipboardManager::class.java).primaryClip
            ?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()?.trim()?.ifEmpty { null }

    companion object {
        private const val EXTRA_SHOT = "shot"
        private const val EXTRA_LINK = "link"
        private const val EXTRA_TALK = "talk"
        const val EXTRA_LAPTOP = "laptop"

        /**
         * Opens the sheet over the current app, with a screenshot file and the page's link if
         * there is one. `laptop` starts it switched to My laptop.
         */
        fun open(context: Context, shot: File?, link: String?, talk: Boolean, laptop: Boolean = false) {
            context.startActivity(
                Intent(context, AskActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
                    .putExtra(EXTRA_SHOT, shot?.absolutePath)
                    .putExtra(EXTRA_LINK, link)
                    .putExtra(EXTRA_TALK, talk)
                    .putExtra(EXTRA_LAPTOP, laptop),
            )
        }
    }
}
