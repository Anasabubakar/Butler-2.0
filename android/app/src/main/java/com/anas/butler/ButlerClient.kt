package com.anas.butler

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** Talks to the Butler server with the device token: Ask Butler, sending to other devices, the inbox. */
class ButlerClient(private val config: Config) {

    /** A file to send along: a screenshot, usually. */
    class Attachment(val name: String, val bytes: ByteArray, val mime: String)

    private val base get() = config.saveUrl.trimEnd('/').removeSuffix("/api/save")

    /** What Butler decided to do with what you typed or said. */
    suspend fun command(text: String, screenshot: ByteArray?): JSONObject = JSONObject(
        post(
            "/api/command",
            mapOf("device" to config.deviceName, "kind" to "phone", "text" to text, "tz" to TimeZone.getDefault().id),
            screenshot?.let { Attachment("screenshot.jpg", it, "image/jpeg") },
        ),
    )

    /** Sends copied text ("clip"), a link, a note or a file to another device. Returns who got it. */
    suspend fun send(target: String, kind: String, text: String? = null, url: String? = null, file: Attachment? = null): List<String> {
        val fields = buildMap {
            put("device", config.deviceName)
            put("target", target)
            put("kind", kind)
            text?.let { put("text", it) }
            url?.let { put("url", it) }
        }
        val sent = JSONObject(post("/api/send", fields, file)).getJSONArray("sent_to")
        return List(sent.length()) { sent.getString(it) }
    }

    /** Checks in and takes whatever is waiting for this phone. */
    suspend fun inbox(): JSONArray =
        JSONArray(post("/api/inbox", mapOf("device" to config.deviceName, "kind" to "phone"), null))

    /** A file another device sent here: its bytes and its name. */
    suspend fun download(itemId: String): Pair<ByteArray, String> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$base/api/inbox/file/$itemId").header("x-butler-token", config.token).build()
        client.newCall(request).execute().use { res ->
            if (!res.isSuccessful) throw IOException("Butler answered ${res.code}")
            val name = Regex("filename=\"([^\"]+)\"").find(res.header("content-disposition").orEmpty())
                ?.groupValues?.get(1)?.replace(Regex("[/\\\\]"), "_") ?: "file"
            res.body!!.bytes() to name
        }
    }

    /** Posts a form and returns the answer's body, or throws with Butler's error message. */
    suspend fun post(path: String, fields: Map<String, String>, file: Attachment?): String = withContext(Dispatchers.IO) {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (name, value) -> addFormDataPart(name, value) }
            file?.let { addFormDataPart("file", it.name, it.bytes.toRequestBody(it.mime.toMediaType())) }
        }.build()
        val request = Request.Builder().url(base + path).header("x-butler-token", config.token).post(body).build()
        client.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            when {
                res.isSuccessful -> text
                res.code == 401 -> throw IOException("Butler refused the token")
                else -> throw IOException(
                    runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty().ifEmpty { "Butler answered ${res.code}" },
                )
            }
        }
    }

    private companion object {
        val client: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(2, TimeUnit.MINUTES)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
