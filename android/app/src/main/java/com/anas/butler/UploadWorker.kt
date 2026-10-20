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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Sends one saved item to the server. Queued by WorkManager, so saves made
 * offline go out when the phone is back online.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val config = Config(applicationContext)
        if (!config.isReady) return@withContext Result.retry()

        val text = inputData.getString(KEY_TEXT)
        val note = inputData.getString(KEY_NOTE)
        val file = inputData.getString(KEY_FILE)?.let(::File)?.takeIf { it.exists() }
        val mime = inputData.getString(KEY_MIME)

        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            addFormDataPart("device", config.deviceName)
            text?.let { addFormDataPart("text", it) }
            note?.let { addFormDataPart("note", it) }
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
                        file?.parentFile?.deleteRecursively()
                        Result.success()
                    }
                    // Bad token or bad request will not fix itself; anything else might.
                    res.code in 400..499 && res.code != 408 && res.code != 429 -> Result.failure()
                    else -> Result.retry()
                }
            }
        } catch (e: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_TEXT = "text"
        private const val KEY_NOTE = "note"
        private const val KEY_FILE = "file"
        private const val KEY_MIME = "mime"

        private val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.MINUTES)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        fun enqueue(context: Context, text: String?, note: String?, file: File?, mime: String?) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(
                    workDataOf(KEY_TEXT to text, KEY_NOTE to note, KEY_FILE to file?.absolutePath, KEY_MIME to mime)
                )
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag("upload")
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
