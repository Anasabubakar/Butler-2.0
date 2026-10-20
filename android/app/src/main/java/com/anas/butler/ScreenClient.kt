package com.anas.butler

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Asks the Butler server about a screenshot. The server holds the Gemini key, not the phone. */
class ScreenClient(private val config: Config) {

    /** Where `target` is on the screenshot, on a 0 to 1000 grid, or null if it isn't there. */
    suspend fun locate(jpeg: ByteArray, target: String): Pair<Float, Float>? {
        val spot = post("/api/screen/locate", mapOf("target" to target), jpeg)
        if (!spot.optBoolean("found")) return null
        return spot.getDouble("x").toFloat() to spot.getDouble("y").toFloat()
    }

    /** An explanation (mode "analyze") or a solution (mode "solve") of the screenshot. */
    suspend fun look(jpeg: ByteArray, mode: String): String =
        post("/api/screen/look", mapOf("mode" to mode), jpeg).getString("answer")

    private suspend fun post(path: String, fields: Map<String, String>, jpeg: ByteArray): JSONObject =
        withContext(Dispatchers.IO) {
            val base = config.saveUrl.trimEnd('/').removeSuffix("/api/save")
            val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
                fields.forEach { (name, value) -> addFormDataPart(name, value) }
                addFormDataPart("file", "screenshot.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            }.build()
            val request = Request.Builder()
                .url(base + path)
                .header("x-butler-token", config.token)
                .post(body)
                .build()
            client.newCall(request).execute().use { res ->
                val json = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrElse { JSONObject() }
                when {
                    res.isSuccessful -> json
                    res.code == 401 -> throw IOException("Butler refused the token")
                    else -> throw IOException(json.optString("error").ifEmpty { "Butler answered ${res.code}" })
                }
            }
        }

    private companion object {
        val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
