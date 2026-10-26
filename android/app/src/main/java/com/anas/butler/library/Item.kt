package com.anas.butler.library

import org.json.JSONObject

/**
 * One thing in your library, as the phone keeps it. Saves made here start with a local id
 * ("local:…") and get the server's id once they've gone up.
 */
data class Item(
    val id: String,
    val clientId: String?,
    val createdAt: String,
    val kind: String,          // link, image, video, text, file
    val url: String?,
    val body: String?,
    val note: String?,
    val filePath: String?,     // on the server
    val mime: String?,
    val thumbnail: String?,
    val platform: String?,
    val title: String?,
    val summary: String?,
    val details: String?,
    val tags: List<String>,
    val category: String?,
    val status: String,        // pending, organized, failed (on the server)
    val archiveUrl: String?,
    val linkDead: Boolean,
    val localFile: String?,    // a copy of the picture or file on this phone
    val localState: String?,   // SAVING until it's on the server, DELETING until the server forgets it
) {
    val isLocal get() = id.startsWith(LOCAL_PREFIX)
    val waiting get() = localState != null

    /** What to call it: its title, or the start of what was saved. */
    val label: String
        get() = title?.takeIf { it.isNotBlank() }
            ?: note?.takeIf { it.isNotBlank() }
            ?: body?.lineSequence()?.firstOrNull { it.isNotBlank() }?.take(120)
            ?: url?.removePrefix("https://")?.removePrefix("http://")?.removePrefix("www.")
            ?: localFile?.substringAfterLast('/')
            ?: "Untitled"

    val isPicture get() = kind == "image" || mime?.startsWith("image/") == true

    companion object {
        const val LOCAL_PREFIX = "local:"
        const val SAVING = "saving"
        const val DELETING = "deleting"

        /** An item as the server sends it. */
        fun fromServer(o: JSONObject): Item {
            fun str(k: String) = if (o.isNull(k)) null else o.optString(k).ifEmpty { null }
            val tags = o.optJSONArray("tags")
            return Item(
                id = o.getString("id"),
                clientId = str("client_id"),
                createdAt = o.optString("created_at"),
                kind = o.optString("kind", "text"),
                url = str("url"),
                body = str("body"),
                note = str("note"),
                filePath = str("file_path"),
                mime = str("mime"),
                thumbnail = str("thumbnail"),
                platform = str("platform"),
                title = str("title"),
                summary = str("summary"),
                details = str("details"),
                tags = if (tags == null) emptyList() else List(tags.length()) { tags.getString(it) },
                category = str("category"),
                status = o.optString("status", "pending"),
                archiveUrl = str("archive_url"),
                linkDead = o.optBoolean("link_dead", false),
                localFile = null,
                localState = null,
            )
        }

        private val URL_RE = Regex("""https?://\S+""")

        /** The first link in some text, the way the server finds it. */
        fun firstUrl(text: String?): String? = text?.let { URL_RE.find(it)?.value?.trimEnd('.', ',', ')', '>', '"', '\'') }

        /** Guesses the kind the server will give a save, so it shows right while offline. */
        fun guessKind(text: String?, mime: String?, hasFile: Boolean): String = when {
            mime?.startsWith("image/") == true -> "image"
            mime?.startsWith("video/") == true -> "video"
            hasFile -> "file"
            firstUrl(text) != null -> "link"
            else -> "text"
        }
    }
}
