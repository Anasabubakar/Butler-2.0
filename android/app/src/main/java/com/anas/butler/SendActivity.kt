package com.anas.butler

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * "Send to laptop" in every app's Share menu: the real files you picked (a photo in Gallery,
 * a bunch of files in Files) go straight to your laptop, no questions. The pet shows them
 * going, with Stop. Shared text or a link goes to the laptop's clipboard or opens there.
 */
class SendActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = Config(this)
        if (!config.isReady) {
            Toast.makeText(this, R.string.setup_first, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
            return
        }
        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(streamExtra(intent))
            Intent.ACTION_SEND_MULTIPLE -> streamListExtra(intent)
            else -> emptyList()
        }
        if (uris.isNotEmpty()) {
            if (!Settings.canDrawOverlays(this)) {
                Toast.makeText(this, R.string.send_start_pet, Toast.LENGTH_LONG).show()
                startActivity(Intent(this, SettingsActivity::class.java))
            } else {
                PetService.sendFiles(this, uris)
            }
            finish()
            return
        }
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()
        if (text.isNullOrEmpty()) {
            Toast.makeText(this, R.string.send_nothing, Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        lifecycleScope.launch {
            val link = Regex("^https?://\\S+$").matches(text)
            val said = runCatching {
                if (link) ButlerClient(config).send("laptop", "link", url = text) else ButlerClient(config).send("laptop", "clip", text = text)
            }.fold(
                onSuccess = { getString(if (link) R.string.pet_sent_page else R.string.pet_sent_text) },
                onFailure = { getString(R.string.pet_failed, it.message ?: it.toString()) },
            )
            Toast.makeText(this@SendActivity, said, Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    @Suppress("DEPRECATION")
    private fun streamExtra(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun streamListExtra(intent: Intent): List<Uri> =
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()
}
