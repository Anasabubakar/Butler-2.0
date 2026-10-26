package com.anas.butler

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.anas.butler.library.LibraryStore
import com.anas.butler.library.Online
import com.anas.butler.library.Sync
import com.anas.butler.ui.AppTile
import com.anas.butler.ui.B2Theme
import com.anas.butler.ui.HomeNav
import com.anas.butler.ui.HomeScreen
import com.anas.butler.ui.ItemScreen
import com.anas.butler.ui.LibraryScreen
import com.anas.butler.ui.SaveScreen

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

/** The tabs along the bottom (or down the side on wide screens). Settings opens its own screen. */
private enum class Tab(val root: String, val label: String) {
    HOME("home", "Home"), LIBRARY("lib|||||", "Library"), SAVE("save", "Save")
}

private class NavTab(val label: String, val icon: @Composable () -> Painter, val onClick: () -> Unit)

/**
 * The screens, as a small back stack of strings so it survives rotation. The first entry is
 * the tab: "home", "lib|<search>|<category>|<kind>|<tag>|<focus>" or "save"; then "item|<id>"
 * and further library views on top. Each entry keeps its own scroll and search while you're away.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ButlerApp() {
    val context = LocalContext.current
    val stack = rememberSaveable(
        saver = listSaver<SnapshotStateList<String>, String>(save = { it.toList() }, restore = { it.toMutableStateList() }),
    ) { mutableStateListOf(Tab.HOME.root) }
    val saved = rememberSaveableStateHolder()
    val onlineFlow = remember { Online.watch(context) }
    val online by onlineFlow.collectAsState(initial = Online.now(context))
    LaunchedEffect(online) { if (online) Sync.now(context) }

    fun keyAt(i: Int) = "$i:${stack[i]}"
    fun go(screen: String) { stack.add(screen) }
    fun back() {
        if (stack.size > 1) {
            saved.removeState(keyAt(stack.lastIndex))
            stack.removeAt(stack.lastIndex)
        } else if (stack[0] != Tab.HOME.root) {
            open(stack, saved, Tab.HOME)
        }
    }
    fun lib(f: LibraryStore.Filter, focus: Boolean = false) =
        go(listOf("lib", f.search.replace("|", " "), f.category.orEmpty(), f.kind.orEmpty(), f.tag.orEmpty(), if (focus) "1" else "").joinToString("|"))
    fun openSettings() = context.startActivity(Intent(context, SettingsActivity::class.java))

    BackHandler(enabled = stack.size > 1 || stack[0] != Tab.HOME.root) { back() }

    val tab = Tab.entries.firstOrNull { stack[0] == it.root } ?: Tab.HOME
    val tabs = listOf(
        NavTab(Tab.HOME.label, { rememberVectorPainter(Icons.Filled.Home) }) { open(stack, saved, Tab.HOME) },
        NavTab(Tab.LIBRARY.label, { painterResource(R.drawable.ic_library) }) { open(stack, saved, Tab.LIBRARY) },
        NavTab(Tab.SAVE.label, { rememberVectorPainter(Icons.Filled.Add) }) { open(stack, saved, Tab.SAVE) },
        NavTab("Settings", { rememberVectorPainter(Icons.Filled.Settings) }) { openSettings() },
    )
    fun selected(label: String) = label == tab.label

    val screen: @Composable () -> Unit = {
        val index = stack.lastIndex
        val top = stack[index]
        saved.SaveableStateProvider(keyAt(index)) {
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
                    showBack = index > 0,
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
                "save" -> SaveScreen(online, onItem = { go("item|$it") })
                else -> HomeScreen(online, object : HomeNav {
                    override fun search() = lib(LibraryStore.Filter(), focus = true)
                    override fun library(filter: LibraryStore.Filter) = lib(filter)
                    override fun item(id: String) = go("item|$id")
                    override fun settings() = openSettings()
                    override fun website() = context.startActivity(Intent(context, LibraryActivity::class.java))
                })
            }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        if (maxWidth >= 600.dp) {
            // Tablets, unfolded phones, landscape: the tabs go down the side.
            Row(Modifier.fillMaxSize()) {
                NavigationRail(
                    header = { Spacer(Modifier.height(8.dp)); AppTile(36) },
                    windowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start),
                ) {
                    Spacer(Modifier.height(12.dp))
                    tabs.forEach { t ->
                        NavigationRailItem(
                            selected = selected(t.label), onClick = t.onClick,
                            icon = { Icon(t.icon(), contentDescription = null) }, label = { Text(t.label) },
                        )
                    }
                }
                Box(
                    Modifier.weight(1f).fillMaxHeight()
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.End)),
                ) { screen() }
            }
        } else {
            Column(Modifier.fillMaxSize().imePadding()) {
                Box(
                    Modifier.weight(1f).fillMaxSize()
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)),
                ) { screen() }
                // Out of the way while you type.
                if (!WindowInsets.isImeVisible) {
                    NavigationBar {
                        tabs.forEach { t ->
                            NavigationBarItem(
                                selected = selected(t.label), onClick = t.onClick,
                                icon = { Icon(t.icon(), contentDescription = null) }, label = { Text(t.label) },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Switches tab. Tapping the tab you're on goes back to its start. */
private fun open(stack: SnapshotStateList<String>, saved: androidx.compose.runtime.saveable.SaveableStateHolder, tab: Tab) {
    stack.indices.reversed().forEach { saved.removeState("$it:${stack[it]}") }
    stack.clear()
    stack.add(tab.root)
}
