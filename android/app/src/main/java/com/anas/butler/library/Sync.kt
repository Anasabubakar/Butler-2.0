package com.anas.butler.library

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import coil.imageLoader
import coil.request.ImageRequest
import com.anas.butler.ButlerClient
import com.anas.butler.Config
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Keeps the phone's copy of the library in step with the server: asks what changed since
 * it last looked, takes it in, and keeps copies of recent pictures for offline.
 */
object Sync {
    private const val CURSOR = "cursor"
    const val LAST_SYNC = "last_sync"
    private const val NOW = "sync-now"
    private const val EVERY = "sync-every"
    private const val KEEP_PICTURES = 40

    private val lock = Mutex()
    private val _running = MutableStateFlow(false)
    private val _problem = MutableStateFlow<String?>(null)

    /** True while a catch-up is under way in this app. */
    val running: StateFlow<Boolean> get() = _running

    /** Why the last catch-up didn't finish, or null if it did. */
    val problem: StateFlow<String?> get() = _problem

    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Catches up as soon as there's internet (now, if there is). */
    fun now(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Catches up every 15 minutes or so while there's internet, even with the app closed. */
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(EVERY, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** One catch-up. Throws IOException when the internet or the server isn't there. */
    suspend fun pull(context: Context) {
        val config = Config(context)
        if (!config.isReady) return
        lock.withLock { pullLocked(context, config) }
    }

    private suspend fun pullLocked(context: Context, config: Config) {
        val store = LibraryStore.get(context)
        val client = ButlerClient(config)
        _running.value = true
        try {
            var query = store.meta(CURSOR)?.let { "since=$it" } ?: ""
            val fresh = mutableListOf<Item>()
            while (true) {
                val page = JSONObject(client.get("/api/device/changes?limit=300&$query"))
                val list = page.getJSONArray("items")
                val items = List(list.length()) { Item.fromServer(list.getJSONObject(it)) }
                store.upsertFromServer(items)
                fresh += items
                val deleted = page.optJSONArray("deleted")
                if (deleted != null) store.forget(List(deleted.length()) { deleted.getString(it) })
                val next = page.getString("next")
                if (!page.optBoolean("more")) {
                    store.setMeta(CURSOR, next)
                    break
                }
                query = "after=$next"
            }
            store.setMeta(LAST_SYNC, LibraryStore.iso())
            _problem.value = null
            keepPictures(context, store, client)
            warmThumbnails(context, fresh)
        } catch (e: IOException) {
            _problem.value = e.message
            throw e
        } finally {
            _running.value = false
        }
    }

    /** Copies of recent saved pictures, so they open with no internet. */
    private suspend fun keepPictures(context: Context, store: LibraryStore, client: ButlerClient) {
        for (item in store.picturesToKeep(KEEP_PICTURES)) {
            val name = item.filePath!!.substringAfterLast('/').ifEmpty { "file" }
            val out = java.io.File(store.fileDir(item.id), name)
            try {
                client.downloadTo("/api/device/files/${item.id}", out)
                store.setLocalFile(item.id, out.absolutePath)
            } catch (e: ButlerClient.Refused) {
                if (e.code != 404) throw e
            }
        }
    }

    /** Fetches link previews into the picture cache, so the library looks the same offline. */
    private fun warmThumbnails(context: Context, items: List<Item>) {
        val loader = context.imageLoader
        items.mapNotNull { it.thumbnail }.distinct().take(80).forEach {
            loader.enqueue(ImageRequest.Builder(context).data(it).build())
        }
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        Sync.pull(applicationContext)
        Result.success()
    } catch (e: ButlerClient.Refused) {
        // A wrong token won't fix itself; a server hiccup might.
        if (e.code in 400..499 && e.code != 408 && e.code != 429) Result.failure() else Result.retry()
    } catch (e: IOException) {
        Result.retry()
    }
}
