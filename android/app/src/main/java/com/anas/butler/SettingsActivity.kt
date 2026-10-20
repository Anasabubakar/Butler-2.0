package com.anas.butler

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/** One-time setup: where your server is and the secret token that proves it's you. */
class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        val config = Config(this)

        val url = findViewById<EditText>(R.id.save_url).apply { setText(config.saveUrl) }
        val token = findViewById<EditText>(R.id.token).apply { setText(config.token) }
        val device = findViewById<EditText>(R.id.device).apply { setText(config.deviceName) }

        findViewById<Button>(R.id.save_settings).setOnClickListener {
            config.saveUrl = url.text.toString()
            config.token = token.text.toString()
            config.deviceName = device.text.toString().ifBlank { config.deviceName }
            val msg = if (config.isReady) R.string.settings_saved else R.string.settings_incomplete
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            if (config.isReady) finish()
        }

        // Little Butler needs two switches, asked for one at a time.
        findViewById<Button>(R.id.start_pet).setOnClickListener {
            when {
                !config.isReady -> toast(R.string.settings_incomplete)
                !Settings.canDrawOverlays(this) -> {
                    startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                    toast(R.string.allow_overlay)
                }
                HandsService.instance == null -> {
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    toast(R.string.allow_hands)
                }
                else -> {
                    PetService.start(this)
                    toast(R.string.pet_started)
                    finish()
                }
            }
        }
    }

    private fun toast(message: Int) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
