package com.anas.butler

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Your library, the same one the website shows, inside the app. Signs in with the
 * device token, so there's no password to type. Links to other sites open in their apps.
 */
class LibraryActivity : AppCompatActivity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = Config(this)
        if (!config.isReady) {
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
            return
        }
        val site = config.saveUrl.trimEnd('/').removeSuffix("/api/save")
        val host = Uri.parse(site).host

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == host) return false // the library itself, and your saved files
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (e: ActivityNotFoundException) {
                        Toast.makeText(this@LibraryActivity, R.string.library_cant_open, Toast.LENGTH_SHORT).show()
                    }
                    return true
                }
            }
        }
        val dp = resources.displayMetrics.density
        val settingsButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_manage)
            contentDescription = getString(R.string.library_settings)
            alpha = 0.8f
            setOnClickListener { startActivity(Intent(this@LibraryActivity, SettingsActivity::class.java)) }
        }
        setContentView(FrameLayout(this).apply {
            fitsSystemWindows = true
            addView(web)
            addView(settingsButton, FrameLayout.LayoutParams((48 * dp).toInt(), (48 * dp).toInt(), Gravity.BOTTOM or Gravity.END).apply {
                setMargins(0, 0, (12 * dp).toInt(), (12 * dp).toInt())
            })
        })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
            return
        }
        lifecycleScope.launch {
            // Sign the app's browser in with the device token, then open the library.
            runCatching {
                val session = JSONObject(ButlerClient(config).post("/api/device-session", emptyMap(), null))
                val maxAge = session.optInt("days", 30) * 86_400
                CookieManager.getInstance().apply {
                    setCookie(site, "${session.getString("cookie")}=${session.getString("value")}; Path=/; Secure; HttpOnly; Max-Age=$maxAge")
                    flush()
                }
            }.onFailure {
                Toast.makeText(this@LibraryActivity, getString(R.string.pet_failed, it.message ?: it.toString()), Toast.LENGTH_LONG).show()
            }
            web.loadUrl(site)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            web.visibility = View.GONE
            web.destroy()
        }
        super.onDestroy()
    }
}
