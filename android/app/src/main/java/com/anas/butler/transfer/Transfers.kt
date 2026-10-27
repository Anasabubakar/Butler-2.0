package com.anas.butler.transfer

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.anas.butler.ButlerClient
import com.anas.butler.Config
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/** How far along files are, for the bubble: "Receiving 3 files: a.jpg… 45%". */
data class Progress(
    val incoming: Boolean,
    val names: List<String>,
    val done: Long,
    val size: Long,
    val via: String, // "wifi" or "server"
    val peer: String,
) {
    val fraction get() = if (size > 0) (done.toDouble() / size).coerceIn(0.0, 1.0) else 1.0
}

/** Files that arrived: where they are, and how to open them. */
class Saved(val names: List<String>, val uris: List<Uri>, val via: String, val peer: String)

/** A file to send: picked in another app (a content:// link), or one of Butler's own. */
class Outgoing(val uri: Uri, val name: String, val size: Long, val mime: String)

/**
 * Sends and receives real files. Directly to the laptop when it's on the same network (no
 * internet needed), else through your Butler server in pieces, so a dropped connection
 * carries on where it stopped. Received files go to Downloads/Butler.
 */
class Transfers(private val context: Context) {
    private val config = Config(context)
    private val resolver = context.contentResolver

    // --- what to send ----------------------------------------------------------------

    /** Names, sizes and types of the files you picked. Throws if one can't be read. */
    fun describe(uris: List<Uri>): List<Outgoing> = uris.map { uri ->
        var name: String? = null
        var size = -1L
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    name = c.getString(0)
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        }
        if (uri.scheme == "file") {
            val file = File(uri.path!!)
            name = name ?: file.name
            size = file.length()
        }
        if (size < 0) size = runCatching { resolver.openFileDescriptor(uri, "r")?.use { it.statSize } }.getOrNull() ?: -1
        if (size < 0) throw IOException("couldn't read ${name ?: "a file"}")
        val mime = resolver.getType(uri) ?: MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(name.orEmpty().substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
        Outgoing(uri, safeName(name ?: "file"), size, mime)
    }

    /** Reads a file from `offset`, jumping straight there when the app allows it. */
    private fun open(file: Outgoing, offset: Long): InputStream {
        val fd = runCatching { resolver.openFileDescriptor(file.uri, "r") }.getOrNull()
        if (fd != null) {
            val stream = FileInputStream(fd.fileDescriptor)
            if (runCatching { stream.channel.position(offset) }.isSuccess) {
                return object : java.io.FilterInputStream(stream) {
                    override fun close() {
                        super.close()
                        fd.close()
                    }
                }
            }
            stream.close()
            fd.close()
        }
        val stream = resolver.openInputStream(file.uri) ?: throw IOException("couldn't open ${file.name}")
        var left = offset
        while (left > 0) {
            val skipped = stream.skip(left)
            if (skipped <= 0) throw IOException("couldn't read ${file.name}")
            left -= skipped
        }
        return stream
    }

    // --- sending ---------------------------------------------------------------------

    /** Sends files to `target` ("laptop"), the quickest way that works. Returns how it went ("wifi" or "server"). */
    suspend fun send(target: String, files: List<Outgoing>, onProgress: (Progress) -> Unit): Progress {
        val size = files.sumOf { it.size }
        val names = files.map { it.name }
        if (target == "laptop") {
            val laptop = Link.find(context)
            if (laptop != null) {
                var p = Progress(false, names, 0, size, "wifi", "your laptop")
                onProgress(p)
                pushToLaptop(laptop, files) { done -> p = p.copy(done = done); onProgress(p) }
                return p.copy(done = size)
            }
        }
        if (!config.isReady) throw IOException("set up Butler first")
        var p = Progress(false, names, 0, size, "server", target)
        onProgress(p)
        p = sendByServer(target, files) { done -> p = p.copy(done = done); onProgress(p) }.let { peer -> p.copy(peer = peer) }
        return p.copy(done = size)
    }

    private suspend fun pushToLaptop(laptop: Laptop, files: List<Outgoing>, onDone: (Long) -> Unit) = withContext(Dispatchers.IO) {
        val http = laptop.http(readSeconds = 120)
        val list = JSONArray(files.map { JSONObject().put("name", it.name).put("size", it.size).put("mime", it.mime) })
        val started = JSONObject(call(http, laptop.request("/link/push")
            .post(JSONObject().put("from", config.deviceName).put("files", list).toString().toRequestBody(JSON)).build()))
        val ids = started.getJSONArray("files")
        var before = 0L
        for ((i, file) in files.withIndex()) {
            val id = ids.getJSONObject(i).getString("id")
            uploadPieces(file, { at -> onDone(before + at) }) { at, body ->
                laptop.request("/link/push/${started.getString("id")}/$id?offset=$at").put(body).build() to http
            }
            before += file.size
        }
        call(http, laptop.request("/link/push/${started.getString("id")}/done").post("{}".toRequestBody(JSON)).build())
    }

    /** Sends through Butler. Returns which device it went to. */
    private suspend fun sendByServer(target: String, files: List<Outgoing>, onDone: (Long) -> Unit): String = withContext(Dispatchers.IO) {
        val butler = ButlerClient(config)
        val list = JSONArray(files.map { JSONObject().put("name", it.name).put("size", it.size).put("mime", it.mime) })
        val started = JSONObject(butler.post("/api/transfer", mapOf(
            "device" to config.deviceName, "target" to target, "files" to list.toString()), null))
        val id = started.getString("id")
        val ids = started.getJSONArray("files")
        val base = config.saveUrl.trimEnd('/').removeSuffix("/api/save")
        try {
            var before = 0L
            for ((i, file) in files.withIndex()) {
                val fileId = ids.getJSONObject(i).getString("id")
                uploadPieces(file, { at -> onDone(before + at) }) { at, body ->
                    Request.Builder().url("$base/api/transfer/$id/$fileId?offset=$at")
                        .header("x-butler-token", config.token).put(body).build() to server
                }
                before += file.size
            }
        } catch (e: CancellationException) {
            withContext(NonCancellable) {
                runCatching { server.newCall(Request.Builder().url("$base/api/transfer/$id").header("x-butler-token", config.token).delete().build()).execute().close() }
            }
            throw e
        }
        val sent = started.optJSONArray("sent_to") ?: JSONArray()
        List(sent.length()) { sent.getString(it) }.joinToString(", ").ifEmpty { target }
    }

    /**
     * Uploads one file in pieces. A 409 says where the other end got to (after a drop), and a
     * dropped connection is tried again, waiting longer each time, for about ten minutes.
     */
    private suspend fun uploadPieces(
        file: Outgoing,
        onAt: (Long) -> Unit,
        piece: (Long, RequestBody) -> Pair<Request, OkHttpClient>,
    ) {
        var at = 0L
        var wait = 2_000L
        var failures = 0
        val job = coroutineContext[kotlinx.coroutines.Job]
        while (at < file.size) {
            coroutineContext.ensureActive()
            val length = minOf(PIECE, file.size - at)
            val (request, http) = piece(at, streamBody(file, at, length, { job?.isActive != false }) { sent -> onAt(at + sent) })
            try {
                http.newCall(request).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    val received = runCatching { JSONObject(text).optLong("received", -1) }.getOrDefault(-1)
                    when {
                        res.isSuccessful || (res.code == 409 && received >= 0) -> at = received.takeIf { it >= 0 } ?: (at + length)
                        res.code == 401 -> throw IOException("Butler refused the token")
                        else -> throw Refused(runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty().ifEmpty { "answered ${res.code}" })
                    }
                }
                wait = 2_000L
                failures = 0
                onAt(at)
            } catch (e: Refused) {
                throw IOException(e.message)
            } catch (e: IOException) {
                coroutineContext.ensureActive() // Stop pressed: that's why it broke off
                if (++failures > 10) throw IOException("lost the connection: ${e.message}")
                delay(wait)
                wait = minOf(wait * 2, 60_000L)
            }
        }
    }

    private class Refused(message: String) : IOException(message)

    private fun streamBody(file: Outgoing, at: Long, length: Long, going: () -> Boolean, onSent: (Long) -> Unit) = object : RequestBody() {
        override fun contentType() = OCTET
        override fun contentLength() = length
        override fun isOneShot() = true
        override fun writeTo(sink: BufferedSink) {
            open(file, at).use { input ->
                val buffer = ByteArray(64 * 1024)
                var sent = 0L
                while (sent < length) {
                    if (!going()) throw IOException("stopped")
                    val n = input.read(buffer, 0, minOf(buffer.size.toLong(), length - sent).toInt())
                    if (n < 0) throw IOException("${file.name} got shorter while sending")
                    sink.write(buffer, 0, n)
                    sent += n
                    onSent(sent)
                }
            }
        }
    }

    // --- receiving -------------------------------------------------------------------

    /** Files coming through Butler (an inbox "transfer"): downloads them while they're still arriving. */
    suspend fun receiveFromServer(transfer: JSONObject, from: String, onProgress: (Progress) -> Unit): Saved = withContext(Dispatchers.IO) {
        val id = transfer.getString("id")
        val files = transfer.getJSONArray("files")
        val names = List(files.length()) { files.getJSONObject(it).optString("name", "file") }
        val base = config.saveUrl.trimEnd('/').removeSuffix("/api/save")
        var p = Progress(true, names, 0, transfer.optLong("size"), "server", from)
        onProgress(p)
        val saved = receive(files, { fileId, at -> Request.Builder().url("$base/api/transfer/$id/$fileId?from=$at").header("x-butler-token", config.token).build() to server }) { done ->
            p = p.copy(done = done)
            onProgress(p)
        }
        runCatching { ButlerClient(config).post("/api/transfer/$id/done", mapOf("device" to config.deviceName), null) }
        Saved(names, saved, "server", from)
    }

    /** Files the laptop offered on the same Wi-Fi. */
    suspend fun receiveFromLaptop(laptop: Laptop, offer: JSONObject, onProgress: (Progress) -> Unit): Saved = withContext(Dispatchers.IO) {
        val files = offer.getJSONArray("files")
        val names = List(files.length()) { files.getJSONObject(it).optString("name", "file") }
        val http = laptop.http(readSeconds = 60)
        var p = Progress(true, names, 0, offer.optLong("size"), "wifi", "your laptop")
        onProgress(p)
        val saved = receive(files, { fileId, at -> laptop.request("/link/offer/${offer.getString("id")}/$fileId?from=$at").build() to http }) { done ->
            p = p.copy(done = done)
            onProgress(p)
        }
        runCatching { call(http, laptop.request("/link/offer/${offer.getString("id")}/done").post("{}".toRequestBody(JSON)).build()) }
        Saved(names, saved, "wifi", "your laptop")
    }

    /**
     * Downloads each file, carrying on from where it got to after a drop, and waiting while
     * the sender hasn't got further yet. A file only shows up in Downloads once it's whole.
     */
    private suspend fun receive(
        files: JSONArray,
        get: (String, Long) -> Pair<Request, OkHttpClient>,
        onDone: (Long) -> Unit,
    ): List<Uri> {
        val saved = mutableListOf<Uri>()
        var before = 0L
        try {
            for (i in 0 until files.length()) {
                val f = files.getJSONObject(i)
                val size = f.optLong("size")
                val sink = DownloadSink.create(context, safeName(f.optString("name", "file")), f.optString("mime").ifEmpty { null })
                saved += sink.uri
                var have = 0L
                var quietSince = System.currentTimeMillis()
                var wait = 1_000L
                var failures = 0
                sink.output().use { out ->
                    while (have < size) {
                        coroutineContext.ensureActive()
                        val (request, http) = get(f.getString("id"), have)
                        try {
                            val got = http.newCall(request).execute().use { res ->
                                if (res.code == 404) throw IOException("the other device stopped sending")
                                if (!res.isSuccessful) throw IOException("answered ${res.code}")
                                val input = res.body!!.byteStream()
                                val buffer = ByteArray(64 * 1024)
                                var got = 0L
                                while (true) {
                                    coroutineContext.ensureActive()
                                    val n = input.read(buffer)
                                    if (n < 0) break
                                    out.write(buffer, 0, n)
                                    got += n
                                    have += n
                                    onDone(before + have)
                                }
                                got
                            }
                            failures = 0
                            wait = 1_000L
                            if (got > 0) {
                                quietSince = System.currentTimeMillis()
                            } else if (System.currentTimeMillis() - quietSince > 10 * 60_000L) {
                                throw IOException("nothing new arrived for 10 minutes")
                            } else {
                                delay(1_000) // the sender hasn't got further yet
                            }
                        } catch (e: IOException) {
                            coroutineContext.ensureActive()
                            if (e.message == "the other device stopped sending" || ++failures > 10) throw e
                            delay(wait)
                            wait = minOf(wait * 2, 60_000L)
                        }
                    }
                }
                sink.finish()
                before += size
            }
        } catch (e: Throwable) {
            withContext(NonCancellable) { saved.forEach { DownloadSink.discard(context, it) } }
            throw e
        }
        return saved
    }

    private fun call(http: OkHttpClient, request: Request): String = http.newCall(request).execute().use { res ->
        val text = res.body?.string().orEmpty()
        if (!res.isSuccessful) {
            throw IOException(runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty().ifEmpty { "your laptop answered ${res.code}" })
        }
        text
    }

    companion object {
        const val PIECE = 8L * 1024 * 1024
        private val JSON = "application/json".toMediaType()
        private val OCTET = "application/octet-stream".toMediaType()
        private val server: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.MINUTES)
            .writeTimeout(5, TimeUnit.MINUTES)
            .build()

        /** One path part: no folders, no hidden files, nothing other systems refuse. */
        fun safeName(name: String): String {
            val base = name.replace('\\', '/').substringAfterLast('/')
            val clean = base.map { if (it.code < 32 || it in "<>:\"|?*") '_' else it }.joinToString("").trimStart('.', ' ').trim()
            if (clean.isEmpty()) return "file"
            if (clean.length <= 120) return clean
            val ext = clean.substringAfterLast('.', "").let { if (it.isNotEmpty() && it.length <= 11) ".$it" else "" }
            return clean.take(120 - ext.length) + ext
        }

        /** Opens what arrived: the file itself if there's one, else your Downloads. */
        fun openIntent(saved: Saved): Intent =
            if (saved.uris.size == 1) {
                val uri = saved.uris[0]
                Intent(Intent.ACTION_VIEW).setDataAndType(uri, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS)
            }
    }
}

/**
 * A file arriving in Downloads/Butler. On Android 10+ it's hidden from other apps (pending)
 * until it's whole; older phones keep it in Butler's own Downloads folder.
 */
class DownloadSink private constructor(private val context: Context, val uri: Uri, private val file: File?) {

    fun output(): OutputStream = file?.outputStream()
        ?: context.contentResolver.openOutputStream(uri, "w") ?: throw IOException("couldn't write to Downloads")

    fun finish() {
        if (file != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
    }

    companion object {
        const val FOLDER = "Butler"

        fun create(context: Context, name: String, mime: String?): DownloadSink {
            val type = mime ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
                ?: "application/octet-stream"
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir, FOLDER).apply { mkdirs() }
                var file = File(dir, name)
                var n = 1
                while (file.exists()) file = File(dir, "${name.substringBeforeLast('.')} (${n++})${name.substringAfterLast('.', "").let { if (it.isEmpty() || it == name) "" else ".$it" }}")
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                return DownloadSink(context, uri, file)
            }
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name) // Android adds " (1)" if the name is taken
                put(MediaStore.Downloads.MIME_TYPE, type)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("couldn't save to Downloads")
            return DownloadSink(context, uri, null)
        }

        /** Takes away a file that didn't arrive whole. */
        fun discard(context: Context, uri: Uri) {
            runCatching {
                if (uri.authority == "${context.packageName}.files") File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "$FOLDER/${uri.lastPathSegment}").delete()
                else context.contentResolver.delete(uri, null, null)
            }
        }
    }
}
