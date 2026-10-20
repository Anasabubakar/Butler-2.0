package com.anas.butler

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.util.UUID

/** The small sheet that appears when you pick "Save to Butler" from any app's Share menu. */
class ShareActivity : AppCompatActivity() {

    private data class Shared(val text: String?, val uris: List<Uri>, val mime: String?)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = Config(this)
        if (!config.isReady) {
            Toast.makeText(this, R.string.setup_first, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
            return
        }

        val shared = readIntent(intent)
        if (shared == null) {
            Toast.makeText(this, R.string.nothing_to_save, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        setContentView(R.layout.activity_share)
        window.setGravity(Gravity.BOTTOM)
        findViewById<TextView>(R.id.preview).text = describe(shared)
        val note = findViewById<EditText>(R.id.note)
        findViewById<Button>(R.id.save).setOnClickListener {
            save(shared, note.text.toString().trim().ifEmpty { null })
        }
        findViewById<Button>(R.id.cancel).setOnClickListener { finish() }
    }

    private fun readIntent(intent: Intent): Shared? {
        val text = listOfNotNull(
            intent.getStringExtra(Intent.EXTRA_SUBJECT),
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
        ).distinct().joinToString("\n").ifBlank { null }

        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(streamExtra(intent))
            Intent.ACTION_SEND_MULTIPLE -> streamListExtra(intent)
            else -> emptyList()
        }
        if (text == null && uris.isEmpty()) return null
        return Shared(text, uris, intent.type)
    }

    @Suppress("DEPRECATION")
    private fun streamExtra(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun streamListExtra(intent: Intent): List<Uri> =
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)) ?: emptyList()

    private fun describe(shared: Shared): String = when {
        shared.uris.size > 1 -> getString(R.string.n_files, shared.uris.size)
        shared.uris.size == 1 -> displayName(shared.uris[0]) ?: getString(R.string.one_file)
        else -> shared.text!!.take(300)
    }

    private fun displayName(uri: Uri): String? = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    /**
     * Copies shared files into app storage right away: the permission to read
     * another app's content URI ends when this screen closes.
     */
    private fun copyToOutbox(uri: Uri): File? = runCatching {
        val dir = File(filesDir, "outbox/${UUID.randomUUID()}").apply { mkdirs() }
        val name = (displayName(uri) ?: "shared").replace(Regex("[^\\w.\\-]+"), "_")
        val out = File(dir, name)
        contentResolver.openInputStream(uri)!!.use { input -> out.outputStream().use { input.copyTo(it) } }
        out
    }.getOrNull()

    private fun save(shared: Shared, note: String?) {
        if (shared.uris.isEmpty()) {
            UploadWorker.enqueue(this, shared.text, note, null, null)
        } else {
            var failed = 0
            for (uri in shared.uris) {
                val file = copyToOutbox(uri)
                if (file == null) { failed++; continue }
                val mime = contentResolver.getType(uri) ?: shared.mime
                UploadWorker.enqueue(this, shared.text, note, file, mime)
            }
            if (failed > 0) Toast.makeText(this, getString(R.string.some_failed, failed), Toast.LENGTH_LONG).show()
        }
        Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
        finish()
    }
}
