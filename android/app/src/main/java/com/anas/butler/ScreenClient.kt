package com.anas.butler

import org.json.JSONObject

/** Asks the Butler server about a screenshot. The server holds the Gemini key, not the phone. */
class ScreenClient(config: Config) {

    private val butler = ButlerClient(config)

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
        JSONObject(butler.post(path, fields, ButlerClient.Attachment("screenshot.jpg", jpeg, "image/jpeg")))
}
