package com.anas.butler.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.anas.butler.library.LibraryStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

/**
 * Reads from the phone's library off the main thread, and reads again whenever it changes
 * (a save, a delete, a sync) or one of `keys` does. Null until the first read is done.
 */
@Composable
fun <T> rememberStore(vararg keys: Any?, read: LibraryStore.() -> T): State<T?> {
    val context = LocalContext.current
    val store = remember { LibraryStore.get(context) }
    val version by store.version.collectAsState()
    return produceState<T?>(null, version, *keys) {
        value = withContext(Dispatchers.IO) { store.read() }
    }
}

@Composable
fun <T> StateFlow<T>.collectAsStateValue(): T = collectAsState().value
