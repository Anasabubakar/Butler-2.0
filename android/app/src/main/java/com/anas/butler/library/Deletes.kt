package com.anas.butler.library

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.anas.butler.ButlerClient
import com.anas.butler.Config
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Deleting works offline: the item leaves the library at once, and the server hears when it can. */
object Deletes {
    private const val KEY_ID = "id"

    fun delete(context: Context, item: Item) {
        val store = LibraryStore.get(context)
        when {
            // Still waiting to go up: the upload sees this and drops it instead.
            item.isLocal && item.localState == Item.SAVING -> store.setState(item.id, Item.DELETING)
            item.isLocal -> store.remove(item.id)
            else -> {
                store.setState(item.id, Item.DELETING)
                tellServer(context, item.id)
            }
        }
    }

    /** Sends the delete for a server item when there's internet. */
    fun tellServer(context: Context, id: String) {
        val request = OneTimeWorkRequestBuilder<DeleteWorker>()
            .setInputData(workDataOf(KEY_ID to id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("delete-$id", ExistingWorkPolicy.KEEP, request)
    }

    class DeleteWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            val id = inputData.getString(KEY_ID) ?: return Result.failure()
            val config = Config(applicationContext)
            if (!config.isReady) return Result.retry()
            val store = LibraryStore.get(applicationContext)
            return try {
                ButlerClient(config).delete("/api/device/items/$id")
                store.remove(id)
                Result.success()
            } catch (e: ButlerClient.Refused) {
                when {
                    e.code == 404 -> { store.remove(id); Result.success() }
                    e.code in 400..499 && e.code != 408 && e.code != 429 -> {
                        // The server won't take it: put it back rather than hide it forever.
                        store.setState(id, null)
                        Result.failure()
                    }
                    else -> Result.retry()
                }
            } catch (e: IOException) {
                Result.retry()
            }
        }
    }
}
