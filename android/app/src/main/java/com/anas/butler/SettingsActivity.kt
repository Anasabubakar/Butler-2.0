package com.anas.butler

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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
            if (config.isReady) {
                if (isTaskRoot) startActivity(Intent(this, LibraryActivity::class.java)) // first setup
                finish()
            }
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
                    // Reminders arrive as notifications; Android 13+ asks once. Butler still works without.
                    if (Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    ) {
                        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                    }
                    PetService.start(this)
                    toast(R.string.pet_started)
                    finish()
                }
            }
        }
    }

    private fun toast(message: Int) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
