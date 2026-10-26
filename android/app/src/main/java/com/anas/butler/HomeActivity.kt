package com.anas.butler

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.anas.butler.library.LibraryStore
import com.anas.butler.library.Online
import com.anas.butler.library.Sync
import com.anas.butler.ui.B2Theme
import com.anas.butler.ui.HomeNav
import com.anas.butler.ui.HomeScreen
import com.anas.butler.ui.ItemScreen
import com.anas.butler.ui.LibraryScreen

/**
 * Opening Butler: your library, native, from the phone's own copy, so it works with no
 * internet. Setup comes first if it isn't done.
 */
class HomeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Config(this).isReady) {
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
            return
        }
        enableEdgeToEdge()
        Sync.schedule(this)
        setContent { B2Theme { ButlerApp() } }
    }

    override fun onStart() {
        super.onStart()
        if (Config(this).isReady) Sync.now(this)
    }
}

/**
 * The screens, as a small back stack of strings so it survives rotation:
 * "home", "lib|<search>|<category>|<kind>|<tag>|<focus>", "item|<id>".
 */
@Composable
private fun ButlerApp() {
    val context = LocalContext.current
    val stack = rememberSaveable(
        saver = listSaver<SnapshotStateList<String>, String>(save = { it.toList() }, restore = { it.toMutableStateList() }),
    ) { mutableStateListOf("home") }
    val onlineFlow = remember { Online.watch(context) }
    val online by onlineFlow.collectAsState(initial = Online.now(context))
    LaunchedEffect(online) { if (online) Sync.now(context) }

    fun go(screen: String) { stack.add(screen) }
    fun back() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun lib(f: LibraryStore.Filter, focus: Boolean = false) =
        go(listOf("lib", f.search.replace("|", " "), f.category.orEmpty(), f.kind.orEmpty(), f.tag.orEmpty(), if (focus) "1" else "").joinToString("|"))

    BackHandler(enabled = stack.size > 1) { back() }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
        val top = stack.last()
        val parts = top.split("|")
        when (parts[0]) {
            "lib" -> LibraryScreen(
                start = LibraryStore.Filter(
                    search = parts.getOrElse(1) { "" },
                    category = parts.getOrNull(2)?.ifEmpty { null },
                    kind = parts.getOrNull(3)?.ifEmpty { null },
                    tag = parts.getOrNull(4)?.ifEmpty { null },
                ),
                focusSearch = parts.getOrNull(5) == "1",
                onBack = ::back,
                onItem = { go("item|$it") },
            )
            "item" -> ItemScreen(
                id = parts[1],
                online = online,
                onBack = { if (stack.lastOrNull() == top) back() },
                onTag = { lib(LibraryStore.Filter(tag = it)) },
                onCategory = { lib(LibraryStore.Filter(category = it)) },
            )
            else -> HomeScreen(online, object : HomeNav {
                override fun search() = lib(LibraryStore.Filter(), focus = true)
                override fun library(filter: LibraryStore.Filter) = lib(filter)
                override fun item(id: String) = go("item|$id")
                override fun settings() = context.startActivity(Intent(context, SettingsActivity::class.java))
                override fun website() = context.startActivity(Intent(context, LibraryActivity::class.java))
            })
        }
    }
}
