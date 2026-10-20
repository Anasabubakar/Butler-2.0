package com.anas.butler

import android.content.ActivityNotFoundException
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

/**
 * Ask Butler: type or say what you want ("remind me at 3 to call Mum", "send this to my
 * laptop", "what does this mean?"). Little Butler takes a screenshot just before this
 * opens, so Butler knows what you were looking at.
 */
class AskActivity : AppCompatActivity() {

    private lateinit var input: EditText
    private lateinit var answer: TextView
    private lateinit var go: Button
    private var working = false

    private val listen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) {
            input.setText(heard)
            ask()
        }
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
        go.setOnClickListener { ask() }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEND) ask()
            action == EditorInfo.IME_ACTION_SEND
        }
        findViewById<Button>(R.id.ask_talk).setOnClickListener { talk() }
        if (intent.getBooleanExtra(EXTRA_TALK, false) && savedInstanceState == null) talk()
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

    private fun show(text: String) {
        answer.text = text
        answer.visibility = View.VISIBLE
    }

    private fun ask() {
        val text = input.text.toString().trim()
        if (text.isEmpty() || working) return
        working = true
        go.isEnabled = false
        show(getString(R.string.pet_thinking))
        val shot = intent.getStringExtra(EXTRA_SHOT)?.let(::File)?.takeIf { it.exists() }?.readBytes()
        lifecycleScope.launch {
            val message = runCatching { act(ButlerClient(Config(this@AskActivity)).command(text, shot), shot) }
                .getOrElse { getString(R.string.pet_failed, it.message ?: it.toString()) }
            show(message)
            input.text.clear()
            working = false
            go.isEnabled = true
        }
    }

    /** Does the part of Butler's plan that happens on the phone, and says what happened. */
    private suspend fun act(result: JSONObject, shot: ByteArray?): String {
        val say = result.optString("say")
        result.optString("open").takeIf { it.startsWith("https://") }?.let {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
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

    private fun clipboardText(): String? =
        getSystemService(ClipboardManager::class.java).primaryClip
            ?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()?.trim()?.ifEmpty { null }

    companion object {
        private const val EXTRA_SHOT = "shot"
        private const val EXTRA_LINK = "link"
        private const val EXTRA_TALK = "talk"

        /** Opens Ask Butler over the current app, with a screenshot file and the page's link if there is one. */
        fun open(context: Context, shot: File?, link: String?, talk: Boolean) {
            context.startActivity(
                Intent(context, AskActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
                    .putExtra(EXTRA_SHOT, shot?.absolutePath)
                    .putExtra(EXTRA_LINK, link)
                    .putExtra(EXTRA_TALK, talk),
            )
        }
    }
}
