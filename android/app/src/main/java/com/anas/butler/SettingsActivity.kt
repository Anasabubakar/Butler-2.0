package com.anas.butler

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.materialswitch.MaterialSwitch
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Setup and settings (Figma B2 · 10, B2 · 16): where your server is and the token that proves
 * it's you, the permissions Little Butler needs in plain English, and the personality
 * switches. Each switch says whether it applies to this phone or to all your devices.
 */
class SettingsActivity : AppCompatActivity() {
    private lateinit var config: Config

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        config = Config(this)
        if (!config.isReady) findViewById<TextView>(R.id.settings_heading).setText(R.string.settings_welcome)

        val url = findViewById<EditText>(R.id.save_url).apply { setText(config.saveUrl) }
        val token = findViewById<EditText>(R.id.token).apply { setText(config.token) }
        val device = findViewById<EditText>(R.id.device).apply { setText(config.deviceName) }

        findViewById<Button>(R.id.save_settings).setOnClickListener {
            val first = !config.isReady
            config.saveUrl = url.text.toString()
            config.token = token.text.toString()
            config.deviceName = device.text.toString().ifBlank { config.deviceName }
            val msg = if (config.isReady) R.string.settings_saved else R.string.settings_incomplete
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            if (config.isReady) {
                loadSharedPrefs()
                if (first && isTaskRoot) {
                    startActivity(Intent(this, HomeActivity::class.java))
                    finish()
                }
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
                    if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) {
                        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                    }
                    PetService.start(this)
                    toast(R.string.pet_started)
                    finish()
                }
            }
        }

        buildPrefs()
        if (config.isReady) loadSharedPrefs()
    }

    override fun onResume() {
        super.onResume()
        showPermissions() // you may be back from Android's settings
    }

    /** Each permission with its state, so you can see what's still missing. */
    private fun showPermissions() {
        fun line(id: Int, label: Int, allowed: Boolean) = findViewById<TextView>(id).apply {
            text = getString(R.string.perm_state, getString(label), getString(if (allowed) R.string.perm_allowed else R.string.perm_needed))
            setCompoundDrawablesRelativeWithIntrinsicBounds(if (allowed) R.drawable.ic_check else R.drawable.ic_alert, 0, 0, 0)
            compoundDrawableTintList = android.content.res.ColorStateList.valueOf(
                if (allowed) currentTextColor else getColor(R.color.b2_vermilion),
            )
        }
        line(R.id.permission_overlay, R.string.perm_overlay, Settings.canDrawOverlays(this))
        line(R.id.permission_hands, R.string.perm_hands, HandsService.instance != null)
        line(R.id.permission_notifications, R.string.perm_notifications, notificationsAllowed())
    }

    private fun notificationsAllowed() = Build.VERSION.SDK_INT < 33 ||
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private lateinit var teasing: MaterialSwitch
    private lateinit var quiet: MaterialSwitch

    /** B2 · 16 "Appearance & personality": five switches, each with its scope. */
    private fun buildPrefs() {
        val box = findViewById<LinearLayout>(R.id.settings_prefs)
        toggle(box, R.string.pref_voice, R.string.pref_voice_help, R.string.scope_phone, config.voiceReplies) {
            config.voiceReplies = it
        }
        toggle(box, R.string.pref_mic, R.string.pref_mic_help, R.string.scope_phone, config.microphone) {
            config.microphone = it
        }
        teasing = toggle(box, R.string.pref_teasing, R.string.pref_teasing_help, R.string.scope_all, config.teasing != "off") {
            shared(JSONObject().put("teasing", if (it) "on" else "off"))
        }
        toggle(box, R.string.pref_motion, R.string.pref_motion_help, R.string.scope_phone, config.reducedMotion) {
            config.reducedMotion = it
        }
        quiet = toggle(box, R.string.pref_quiet, R.string.pref_quiet_help, R.string.scope_all, config.quiet) {
            shared(JSONObject().put("quiet", it))
        }
    }

    private fun toggle(box: LinearLayout, title: Int, help: Int, scope: Int, on: Boolean, change: (Boolean) -> Unit): MaterialSwitch {
        val dp = resources.displayMetrics.density
        val muted = getColor(R.color.b2_muted).let { if (isNight()) getColor(R.color.b2_dark_muted) else it }
        val switch = MaterialSwitch(this).apply {
            isChecked = on
            contentDescription = getString(title)
            setOnCheckedChangeListener { view, checked -> if (view.isPressed) change(checked) }
        }
        box.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = (64 * dp).toInt()
            setPadding(0, (12 * dp).toInt(), 0, (12 * dp).toInt())
            addView(LinearLayout(this@SettingsActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(context).apply {
                    setText(title)
                    textSize = 17f
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                })
                addView(TextView(context).apply {
                    setText(help)
                    textSize = 14f
                    setTextColor(muted)
                })
                addView(TextView(context).apply {
                    setText(scope)
                    textSize = 12f
                    setTextColor(muted)
                    setPadding(0, (2 * dp).toInt(), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(switch)
            setOnClickListener { switch.isChecked = !switch.isChecked; change(switch.isChecked) }
        })
        return switch
    }

    private fun isNight() = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
        android.content.res.Configuration.UI_MODE_NIGHT_YES

    /** Reads teasing and quiet mode from Butler, so the switches show what every device uses. */
    private fun loadSharedPrefs() {
        lifecycleScope.launch {
            runCatching { ButlerClient(config).prefs() }.onSuccess(::remember)
        }
    }

    /** Changes a shared preference; if Butler can't be reached, the switch goes back. */
    private fun shared(patch: JSONObject) {
        lifecycleScope.launch {
            runCatching { ButlerClient(config).savePrefs(patch) }
                .onSuccess(::remember)
                .onFailure {
                    teasing.isChecked = config.teasing != "off"
                    quiet.isChecked = config.quiet
                    toast(R.string.pref_offline)
                }
        }
    }

    private fun remember(prefs: JSONObject) {
        config.teasing = prefs.optString("teasing", config.teasing)
        config.quiet = prefs.optBoolean("quiet", config.quiet)
        teasing.isChecked = config.teasing != "off"
        quiet.isChecked = config.quiet
    }

    private fun toast(message: Int) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
