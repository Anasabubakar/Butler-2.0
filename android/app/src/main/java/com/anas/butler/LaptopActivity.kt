package com.anas.butler

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Tell my laptop: a command for the laptop, sent as you typed it. Your secret word goes in it
 * somewhere; the laptop checks it and takes it out, so it never reaches the AI. What the laptop
 * reports back shows here and as notifications. Stop and Switch off are always allowed.
 */
class LaptopActivity : AppCompatActivity() {

    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var go: Button

    private val listen = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) input.setText(heard) // you check it, then press Send
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Config(this).isReady) {
            Toast.makeText(this, R.string.setup_first, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        setContentView(R.layout.activity_laptop)
        window.setGravity(Gravity.BOTTOM)
        input = findViewById(R.id.laptop_text)
        status = findViewById(R.id.laptop_status)
        go = findViewById(R.id.laptop_go)
        go.setOnClickListener { send() }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEND) send()
            action == EditorInfo.IME_ACTION_SEND
        }
        findViewById<Button>(R.id.laptop_stop).setOnClickListener { stop(off = false) }
        findViewById<Button>(R.id.laptop_off).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(R.string.laptop_off_confirm)
                .setPositiveButton(R.string.laptop_off) { _, _ -> stop(off = true) }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
        findViewById<Button>(R.id.laptop_talk).setOnClickListener { talk() }
        input.requestFocus()
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        // The laptop's news, as the pet hears it.
        lifecycleScope.launch {
            while (true) {
                showNews()
                delay(2_000)
            }
        }
    }

    private fun showNews() {
        val news = PetService.laptopNews
        status.text = if (news.isEmpty()) getString(R.string.laptop_nothing) else news.joinToString("\n\n")
    }

    private fun talk() {
        val speech = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.laptop_title))
        try {
            listen.launch(speech)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.ask_no_voice, Toast.LENGTH_LONG).show()
        }
    }

    private fun send() {
        val text = input.text.toString().trim()
        if (text.isEmpty() || !go.isEnabled) return
        go.isEnabled = false
        lifecycleScope.launch {
            val said = runCatching { ButlerClient(Config(this@LaptopActivity)).laptopTask(text) }
                .fold({ getString(R.string.laptop_sent, it.joinToString(", ")) }, { getString(R.string.pet_failed, it.message ?: it.toString()) })
            PetService.addLaptopNews(said)
            showNews()
            input.text.clear()
            go.isEnabled = true
        }
    }

    private fun stop(off: Boolean) {
        lifecycleScope.launch {
            val said = runCatching { ButlerClient(Config(this@LaptopActivity)).laptopStop(off) }
                .fold({ getString(if (off) R.string.laptop_switched_off else R.string.laptop_stopping) }, { getString(R.string.pet_failed, it.message ?: it.toString()) })
            PetService.addLaptopNews(said)
            showNews()
        }
    }
}
