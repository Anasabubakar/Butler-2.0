package com.anas.butler.library

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The phone's own copy of your library, in a small database, so it opens, searches and
 * saves with no internet. The sync worker keeps it in step with the server.
 */
class LibraryStore private constructor(private val context: Context) :
    SQLiteOpenHelper(context, "library.db", null, 1) {

    private val _version = MutableStateFlow(0)

    /** Goes up every time something changes, so screens know to look again. */
    val version: StateFlow<Int> get() = _version

    private fun changed() { _version.value++ }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """create table items (
                id text primary key,
                client_id text,
                created_at text not null,
                kind text not null,
                url text, body text, note text, file_path text, mime text, thumbnail text,
                platform text, title text, summary text, details text,
                tags text not null default '[]',
                category text,
                status text not null default 'pending',
                archive_url text,
                link_dead integer not null default 0,
                local_file text,
                local_state text
            )""",
        )
        db.execSQL("create index items_created on items (created_at desc)")
        db.execSQL("create index items_client on items (client_id)")
        db.execSQL("create table meta (key text primary key, value text)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    // --- reading -----------------------------------------------------------------------------

    data class Filter(val search: String = "", val category: String? = null, val kind: String? = null, val tag: String? = null)

    /** What you see in the library: newest first, without what's on its way to the bin. */
    fun items(filter: Filter = Filter(), limit: Int = 500): List<Item> {
        val where = mutableListOf("(local_state is null or local_state != ?)")
        val args = mutableListOf(Item.DELETING)
        filter.search.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.forEach { word ->
            where += "(" + SEARCHED.joinToString(" or ") { "$it like ? escape '\\'" } + ")"
            val like = "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            repeat(SEARCHED.size) { args += like }
        }
        when (filter.category) {
            null -> {}
            UNSORTED -> where += "category is null"
            else -> { where += "category = ?"; args += filter.category }
        }
        filter.kind?.let { where += "kind = ?"; args += it }
        filter.tag?.let { where += "tags like ?"; args += "%" + JSONArray(listOf(it)).toString().removeSurrounding("[", "]") + "%" }
        return readableDatabase.rawQuery(
            "select * from items where ${where.joinToString(" and ")} order by created_at desc limit $limit",
            args.toTypedArray(),
        ).use { c -> buildList { while (c.moveToNext()) add(c.toItem()) } }
    }

    fun item(id: String): Item? =
        readableDatabase.rawQuery("select * from items where id = ?", arrayOf(id)).use { c ->
            if (c.moveToFirst()) c.toItem() else null
        }

    /** Each category with how many things are in it, biggest first. Unsorted last. */
    fun categories(): List<Pair<String, Int>> =
        readableDatabase.rawQuery(
            """select coalesce(category, ?) as name, count(*) from items
               where local_state is null or local_state != ?
               group by name order by (category is null), count(*) desc, name""",
            arrayOf(UNSORTED, Item.DELETING),
        ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0) to c.getInt(1)) } }

    /** The broad subjects across everything (from tags), most used first. */
    fun topTags(limit: Int): List<Pair<String, Int>> {
        val counts = HashMap<String, Int>()
        readableDatabase.rawQuery(
            "select tags from items where local_state is null or local_state != ?", arrayOf(Item.DELETING),
        ).use { c ->
            while (c.moveToNext()) {
                val tags = runCatching { JSONArray(c.getString(0)) }.getOrNull() ?: continue
                for (i in 0 until tags.length()) counts.merge(tags.getString(i), 1, Int::plus)
            }
        }
        return counts.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .take(limit).map { it.key to it.value }
    }

    data class Counts(val total: Int, val thisWeek: Int, val waiting: Int, val pictures: Int, val links: Int, val notes: Int)

    fun counts(): Counts {
        val weekAgo = iso(Date(System.currentTimeMillis() - 7 * 86_400_000L))
        return readableDatabase.rawQuery(
            """select
                 sum(case when local_state is null or local_state != ? then 1 else 0 end),
                 sum(case when (local_state is null or local_state != ?) and created_at >= ? then 1 else 0 end),
                 sum(case when local_state is not null then 1 else 0 end),
                 sum(case when kind = 'image' and (local_state is null or local_state != ?) then 1 else 0 end),
                 sum(case when kind = 'link' and (local_state is null or local_state != ?) then 1 else 0 end),
                 sum(case when kind = 'text' and (local_state is null or local_state != ?) then 1 else 0 end)
               from items""",
            arrayOf(Item.DELETING, Item.DELETING, weekAgo, Item.DELETING, Item.DELETING, Item.DELETING),
        ).use { c ->
            c.moveToFirst()
            Counts(c.getInt(0), c.getInt(1), c.getInt(2), c.getInt(3), c.getInt(4), c.getInt(5))
        }
    }

    // --- saves and deletes made on this phone ------------------------------------------------

    /** A save made here, shown straight away while it waits to go up. */
    fun addLocal(item: Item) {
        writableDatabase.insertWithOnConflict("items", null, item.toValues(), SQLiteDatabase.CONFLICT_REPLACE)
        changed()
    }

    /** A save went up: the server's id takes over, and the copy of its file moves along. */
    fun swapLocal(localId: String, serverId: String, localFile: String?) {
        writableDatabase.transaction {
            val exists = rawQuery("select 1 from items where id = ?", arrayOf(serverId)).use { it.moveToFirst() }
            if (exists) {
                // The sync got here first; keep its copy and add the file.
                delete("items", "id = ?", arrayOf(localId))
                if (localFile != null) update("items", ContentValues().apply { put("local_file", localFile) }, "id = ?", arrayOf(serverId))
            } else {
                update("items", ContentValues().apply {
                    put("id", serverId)
                    putNull("local_state")
                    put("local_file", localFile)
                }, "id = ?", arrayOf(localId))
            }
        }
        changed()
    }

    fun setState(id: String, state: String?) {
        writableDatabase.update("items", ContentValues().apply { put("local_state", state) }, "id = ?", arrayOf(id))
        changed()
    }

    /** Gone for good, with the phone's copy of its file. */
    fun remove(id: String) {
        item(id)?.localFile?.let { File(it).parentFile?.deleteRecursively() }
        writableDatabase.delete("items", "id = ?", arrayOf(id))
        changed()
    }

    // --- what the sync brings ----------------------------------------------------------------

    /** Takes in items from the server, keeping this phone's file copies and pending deletes. */
    fun upsertFromServer(items: List<Item>) {
        if (items.isEmpty()) return
        writableDatabase.transaction {
            for (item in items) {
                var localFile: String? = null
                var state: String? = null
                // One of this phone's own saves, synced before the upload heard back.
                item.clientId?.let { cid ->
                    rawQuery("select id, local_file from items where client_id = ? and id != ?", arrayOf(cid, item.id)).use { c ->
                        while (c.moveToNext()) {
                            localFile = localFile ?: c.getString(1)
                            delete("items", "id = ?", arrayOf(c.getString(0)))
                        }
                    }
                }
                rawQuery("select local_file, local_state from items where id = ?", arrayOf(item.id)).use { c ->
                    if (c.moveToFirst()) {
                        localFile = c.getString(0) ?: localFile
                        state = c.getString(1)?.takeIf { it == Item.DELETING }
                    }
                }
                insertWithOnConflict(
                    "items", null, item.copy(localFile = localFile, localState = state).toValues(),
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
        }
        changed()
    }

    /** Deleted on another device or the website. Saves still waiting here are left alone. */
    fun forget(ids: List<String>) {
        if (ids.isEmpty()) return
        ids.forEach { id ->
            item(id)?.localFile?.let { File(it).parentFile?.deleteRecursively() }
            writableDatabase.delete("items", "id = ?", arrayOf(id))
        }
        changed()
    }

    /** Pictures on the server this phone has no copy of yet, newest first. */
    fun picturesToKeep(limit: Int): List<Item> =
        readableDatabase.rawQuery(
            """select * from items where file_path is not null and local_file is null and local_state is null
               and (kind = 'image' or mime like 'image/%') order by created_at desc limit $limit""",
            null,
        ).use { c -> buildList { while (c.moveToNext()) add(c.toItem()) } }

    fun setLocalFile(id: String, path: String) {
        writableDatabase.update("items", ContentValues().apply { put("local_file", path) }, "id = ?", arrayOf(id))
        changed()
    }

    fun meta(key: String): String? =
        readableDatabase.rawQuery("select value from meta where key = ?", arrayOf(key)).use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    fun setMeta(key: String, value: String?) {
        writableDatabase.insertWithOnConflict("meta", null, ContentValues().apply {
            put("key", key)
            put("value", value)
        }, SQLiteDatabase.CONFLICT_REPLACE)
        changed()
    }

    /** Where the phone keeps copies of saved pictures and files. */
    fun fileDir(id: String): File = File(context.filesDir, "library/${id.replace(Regex("[^\\w-]"), "_")}")

    // --- rows ----------------------------------------------------------------------------------

    private fun Item.toValues() = ContentValues().apply {
        put("id", id)
        put("client_id", clientId)
        put("created_at", createdAt)
        put("kind", kind)
        put("url", url)
        put("body", body)
        put("note", note)
        put("file_path", filePath)
        put("mime", mime)
        put("thumbnail", thumbnail)
        put("platform", platform)
        put("title", title)
        put("summary", summary)
        put("details", details)
        put("tags", JSONArray(tags).toString())
        put("category", category)
        put("status", status)
        put("archive_url", archiveUrl)
        put("link_dead", if (linkDead) 1 else 0)
        put("local_file", localFile)
        put("local_state", localState)
    }

    private fun Cursor.toItem(): Item {
        fun s(name: String): String? = getColumnIndexOrThrow(name).let { if (isNull(it)) null else getString(it) }
        val tags = runCatching { JSONArray(s("tags") ?: "[]") }.getOrDefault(JSONArray())
        return Item(
            id = s("id")!!,
            clientId = s("client_id"),
            createdAt = s("created_at").orEmpty(),
            kind = s("kind") ?: "text",
            url = s("url"),
            body = s("body"),
            note = s("note"),
            filePath = s("file_path"),
            mime = s("mime"),
            thumbnail = s("thumbnail"),
            platform = s("platform"),
            title = s("title"),
            summary = s("summary"),
            details = s("details"),
            tags = List(tags.length()) { tags.getString(it) },
            category = s("category"),
            status = s("status") ?: "pending",
            archiveUrl = s("archive_url"),
            linkDead = getInt(getColumnIndexOrThrow("link_dead")) != 0,
            localFile = s("local_file"),
            localState = s("local_state"),
        )
    }

    private inline fun SQLiteDatabase.transaction(block: SQLiteDatabase.() -> Unit) {
        beginTransaction()
        try {
            block()
            setTransactionSuccessful()
        } finally {
            endTransaction()
        }
    }

    companion object {
        const val UNSORTED = "Unsorted"
        private val SEARCHED = listOf("title", "note", "summary", "body", "url", "tags", "category", "platform", "details")

        @Volatile private var instance: LibraryStore? = null

        fun get(context: Context): LibraryStore =
            instance ?: synchronized(this) {
                instance ?: LibraryStore(context.applicationContext).also { instance = it }
            }

        private fun format() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        /** The same time format the server sends, so local saves sort among the rest. */
        fun iso(date: Date = Date()): String = format().format(date)

        fun parseIso(text: String): Date? = runCatching { format().parse(text.replace(Regex("\\.(\\d{3})\\d*Z$"), ".$1Z")) }.getOrNull()
    }
}
