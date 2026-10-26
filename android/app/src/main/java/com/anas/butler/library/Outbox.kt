package com.anas.butler.library

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/** Getting things in and out of the library on this phone: picking files, opening, sharing, copying. */
object Outbox {

    /** Copies a picked file into app storage, where the upload can read it later. */
    fun copy(context: Context, uri: Uri): File? = runCatching {
        val dir = File(context.filesDir, "outbox/${UUID.randomUUID()}").apply { mkdirs() }
        val name = (displayName(context, uri) ?: "picked").replace(Regex("[^\\w.\\-]+"), "_")
        val out = File(dir, name)
        context.contentResolver.openInputStream(uri)!!.use { input -> out.outputStream().use { input.copyTo(it) } }
        out
    }.getOrNull()

    private fun displayName(context: Context, uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    /** Opens the link in its app (YouTube, the browser…), or the kept copy of a picture. */
    fun open(context: Context, item: Item): Boolean {
        val intent = item.url?.let { Intent(Intent.ACTION_VIEW, Uri.parse(it)) }
            ?: sharedCopy(context, item)?.let { Intent(Intent.ACTION_VIEW).setDataAndType(it, item.mime ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            ?: return false
        return start(context, intent)
    }

    fun openUrl(context: Context, url: String) = start(context, Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    /** The phone's Share menu, with the picture itself when there's a copy, else the link or text. */
    fun share(context: Context, item: Item) {
        val text = listOfNotNull(item.title, item.url ?: item.body).joinToString("\n")
        val picture = sharedCopy(context, item)
        val send = Intent(Intent.ACTION_SEND).apply {
            if (picture != null) {
                type = item.mime ?: "image/*"
                putExtra(Intent.EXTRA_STREAM, picture)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                type = "text/plain"
            }
            if (text.isNotBlank()) putExtra(Intent.EXTRA_TEXT, text)
        }
        start(context, Intent.createChooser(send, null))
    }

    fun copyText(context: Context, item: Item) {
        val text = item.url ?: item.body ?: item.label
        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Butler", text))
        Toast.makeText(context, "Copied.", Toast.LENGTH_SHORT).show()
    }

    /** A copy in the one folder Butler shares with other apps. */
    private fun sharedCopy(context: Context, item: Item): Uri? {
        val file = item.localFile?.let(::File)?.takeIf { it.exists() } ?: return null
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, file.name)
        file.copyTo(out, overwrite = true)
        return FileProvider.getUriForFile(context, "${context.packageName}.files", out)
    }

    private fun start(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(context, "No app here can open that.", Toast.LENGTH_SHORT).show()
        false
    }
}
