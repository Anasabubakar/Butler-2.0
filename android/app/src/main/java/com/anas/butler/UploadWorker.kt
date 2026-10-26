package com.anas.butler

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.anas.butler.library.Deletes
import com.anas.butler.library.Item
import com.anas.butler.library.LibraryStore
import com.anas.butler.library.Sync
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Sends one saved item to the server. Queued by WorkManager, so saves made
 * offline go out when the phone is back online. The save shows in the phone's
 * library straight away, marked as waiting, and takes the server's id once it's up.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val config = Config(applicationContext)
        if (!config.isReady) return@withContext Result.retry()

        val text = inputData.getString(KEY_TEXT)
        val note = inputData.getString(KEY_NOTE)
        val file = inputData.getString(KEY_FILE)?.let(::File)?.takeIf { it.exists() }
        val mime = inputData.getString(KEY_MIME)
        val localId = inputData.getString(KEY_LOCAL_ID)
        val clientId = inputData.getString(KEY_CLIENT_ID)
        val store = LibraryStore.get(applicationContext)

        // Deleted before it went up: nothing to send.
        if (localId != null) {
            val local = store.item(localId)
            if (local == null || local.localState == Item.DELETING) {
                file?.parentFile?.deleteRecursively()
                if (local != null) store.remove(localId)
                return@withContext Result.success()
            }
        }

        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            addFormDataPart("device", config.deviceName)
            text?.let { addFormDataPart("text", it) }
            note?.let { addFormDataPart("note", it) }
            clientId?.let { addFormDataPart("client_id", it) }
            file?.let { addFormDataPart("file", it.name, it.asRequestBody(mime?.toMediaTypeOrNull())) }
        }.build()

        val request = Request.Builder()
            .url(config.saveUrl)
            .header("x-butler-token", config.token)
            .post(body)
            .build()

        try {
            client.newCall(request).execute().use { res ->
                when {
                    res.isSuccessful -> {
                        val serverId = runCatching { JSONObject(res.body!!.string()).getString("id") }.getOrNull()
                        if (localId != null && serverId != null) arrived(store, localId, serverId, file, mime)
                        else file?.parentFile?.deleteRecursively()
                        Sync.now(applicationContext)
                        Result.success()
                    }
                    // Bad token or bad request will not fix itself; anything else might.
                    res.code in 400..499 && res.code != 408 && res.code != 429 -> {
                        localId?.let { store.setState(it, Item.FAILED) }
                        Result.failure()
                    }
                    else -> Result.retry()
                }
            }
        } catch (e: IOException) {
            Result.retry()
        }
    }

    /** It's on the server: keep a copy of a picture for offline, and finish a delete made meanwhile. */
    private fun arrived(store: LibraryStore, localId: String, serverId: String, file: File?, mime: String?) {
        val deletedMeanwhile = store.item(localId)?.localState == Item.DELETING
        var kept: String? = null
        if (file != null) {
            if (!deletedMeanwhile && mime?.startsWith("image/") == true && file.length() < KEEP_BYTES) {
                val out = File(store.fileDir(serverId), file.name)
                out.parentFile?.mkdirs()
                if (file.renameTo(out) || runCatching { file.copyTo(out, overwrite = true) }.isSuccess) kept = out.absolutePath
            }
            file.parentFile?.deleteRecursively()
        }
        store.swapLocal(localId, serverId, kept)
        if (deletedMeanwhile) {
            store.setState(serverId, Item.DELETING)
            Deletes.tellServer(applicationContext, serverId)
        }
    }

    companion object {
        private const val KEY_TEXT = "text"
        private const val KEY_NOTE = "note"
        private const val KEY_FILE = "file"
        private const val KEY_MIME = "mime"
        private const val KEY_LOCAL_ID = "local_id"
        private const val KEY_CLIENT_ID = "client_id"
        private const val KEEP_BYTES = 20L * 1024 * 1024

        private val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.MINUTES)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        /** Saves something: it's in the phone's library now, and on the server once there's internet. */
        fun enqueue(context: Context, text: String?, note: String?, file: File?, mime: String?) {
            val clientId = UUID.randomUUID().toString()
            val localId = Item.LOCAL_PREFIX + clientId
            val url = Item.firstUrl(text)
            LibraryStore.get(context).addLocal(
                Item(
                    id = localId, clientId = clientId, createdAt = LibraryStore.iso(),
                    kind = Item.guessKind(text, mime, file != null), url = url,
                    body = text?.takeIf { it.trim() != url }, note = note, filePath = null, mime = mime,
                    thumbnail = null, platform = null, title = null, summary = null, details = null,
                    tags = emptyList(), category = null, status = "pending", archiveUrl = null, linkDead = false,
                    localFile = file?.absolutePath, localState = Item.SAVING,
                ),
            )
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(
                    workDataOf(
                        KEY_TEXT to text, KEY_NOTE to note, KEY_FILE to file?.absolutePath, KEY_MIME to mime,
                        KEY_LOCAL_ID to localId, KEY_CLIENT_ID to clientId,
                    )
                )
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag("upload")
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
