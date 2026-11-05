package com.anas.butler

import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone

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

    /** The next single step towards `goal` on the phone screen, given the steps taken so far. */
    suspend fun step(jpeg: ByteArray, goal: String, done: List<String>): JSONObject =
        post("/api/screen/step", mapOf("goal" to goal, "done" to JSONArray(done).toString(), "kind" to "phone"), jpeg)

    /**
     * Act on this: every view of the screen so far, oldest first. `more` says the phone can
     * still scroll. The answer's status is "more" (scroll that way and call again), "ask",
     * "ready" or "none", with what to say and maybe a `confirm` id for Do it.
     */
    suspend fun act(views: List<ByteArray>, more: Boolean, device: String, hasBox: Boolean = false): JSONObject = JSONObject(
        butler.post(
            "/api/screen/act",
            mapOf(
                "device" to device, "kind" to "phone", "tz" to TimeZone.getDefault().id, "more" to if (more) "1" else "0",
                "has_box" to if (hasBox) "1" else "0",
            ),
            views.mapIndexed { i, jpeg -> ButlerClient.Attachment("view-$i.jpg", jpeg, "image/jpeg") },
        ),
    )

    /**
     * Draft a reply: every view of the chat so far (oldest first), what its box holds, the words
     * on screen and what you asked ("help me respond", "shorter"). The answer's status is "more"
     * (scroll up and call again) or "ready" with `text` to type into the box and `say` for you.
     */
    suspend fun draft(
        views: List<ByteArray>, more: Boolean, device: String, instruction: String, box: String, app: String?, screenText: String?,
    ): JSONObject = JSONObject(
        butler.post(
            "/api/screen/draft",
            buildMap {
                put("device", device)
                put("kind", "phone")
                put("tz", TimeZone.getDefault().id)
                put("more", if (more) "1" else "0")
                put("instruction", instruction.take(1000))
                put("box", box.take(4000))
                app?.let { put("app", it) }
                screenText?.let { put("screen_text", it.take(4000)) }
            },
            views.mapIndexed { i, jpeg -> ButlerClient.Attachment("view-$i.jpg", jpeg, "image/jpeg") },
        ),
    )

    private suspend fun post(path: String, fields: Map<String, String>, jpeg: ByteArray): JSONObject =
        JSONObject(butler.post(path, fields, ButlerClient.Attachment("screenshot.jpg", jpeg, "image/jpeg")))
}
