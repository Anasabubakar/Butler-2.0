package com.anas.butler.ui

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.anas.butler.UploadWorker
import com.anas.butler.library.LibraryStore
import com.anas.butler.library.Outbox
import com.anas.butler.library.Sync

/** Where a tap on the home screen leads. */
interface HomeNav {
    fun search()
    fun library(filter: LibraryStore.Filter)
    fun item(id: String)
    fun settings()
    fun website()
}

/**
 * The library's front page, as a bento grid: one leading tile to save something, then
 * numbers, categories, subjects and the latest saves. Everything here works offline.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(online: Boolean, nav: HomeNav) {
    val context = LocalContext.current
    val counts = rememberStore { counts() }
    val categories = rememberStore { categories() }
    val tags = rememberStore { topTags(14) }
    val recent = rememberStore { items(limit = 12) }
    val lastSync = rememberStore { meta(Sync.LAST_SYNC) }
    val syncing = Sync.running.collectAsStateValue()
    val problem = Sync.problem.collectAsStateValue()

    PullToRefreshBox(isRefreshing = syncing, onRefresh = { Sync.now(context) }, modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val cols = when {
                maxWidth < 600.dp -> 2
                maxWidth < 900.dp -> 4
                else -> 6
            }
            val half = if (cols >= 4) cols / 2 else cols
            LazyVerticalGrid(
                columns = GridCells.Fixed(cols),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                full { Header(online, syncing, problem, lastSync.value, nav) }
                full { SearchTile(nav) }
                item(span = { GridItemSpan(half) }) { QuickSave(online) }

                val c = counts.value
                if (c != null) {
                    item(span = { GridItemSpan(if (cols >= 4) half / 2 else 1) }) {
                        Tile(strong = true, onClick = { nav.library(LibraryStore.Filter()) }, modifier = Modifier.heightIn(min = 108.dp)) {
                            Stat("${c.total}", "saved", color = LocalB2.current.onTileStrong)
                        }
                    }
                    item(span = { GridItemSpan(if (cols >= 4) half / 2 else 1) }) {
                        Tile(Modifier.heightIn(min = 108.dp)) { Stat("${c.thisWeek}", "this week") }
                    }
                    item(span = { GridItemSpan(if (cols >= 4) half / 2 else 1) }) {
                        Tile(Modifier.heightIn(min = 108.dp)) {
                            Stat("${c.waiting}", "waiting to sync",
                                color = if (c.waiting > 0) LocalB2.current.accent else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                    item(span = { GridItemSpan(if (cols >= 4) half / 2 else 1) }) {
                        Tile(Modifier.heightIn(min = 108.dp), onClick = { nav.library(LibraryStore.Filter(kind = "image")) }) {
                            Stat("${c.pictures}", "pictures")
                        }
                    }
                    if (c.total == 0) {
                        full {
                            Tile {
                                Text(
                                    if (lastSync.value == null) "Catching up with your library…" else "Nothing saved yet.",
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Text(
                                    if (lastSync.value == null && !online) "Connect to the internet once and your library comes to this phone."
                                    else "Share anything to Butler from any app, or save it above.",
                                    style = MaterialTheme.typography.bodyMedium, color = LocalB2.current.muted,
                                )
                            }
                        }
                    }
                }

                val cats = categories.value.orEmpty()
                if (cats.isNotEmpty()) {
                    full { SectionTitle("Categories", if (cats.size > 8) "See all" else null) { nav.library(LibraryStore.Filter()) } }
                    items(cats.take(if (cols >= 4) 12 else 8), key = { "cat:" + it.first }) { (name, n) ->
                        Tile(Modifier.heightIn(min = 88.dp), onClick = { nav.library(LibraryStore.Filter(category = name)) }) {
                            Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.height(8.dp))
                            Text("$n", style = MaterialTheme.typography.bodySmall, color = LocalB2.current.muted)
                        }
                    }
                }

                val t = tags.value.orEmpty()
                if (t.isNotEmpty()) {
                    full { SectionTitle("Subjects") }
                    full { Subjects(t) { nav.library(LibraryStore.Filter(tag = it)) } }
                }

                val r = recent.value.orEmpty()
                if (r.isNotEmpty()) {
                    full { SectionTitle("Recent", "See all") { nav.library(LibraryStore.Filter()) } }
                    items(r.take(if (cols >= 4) 12 else 8), key = { "item:" + it.id }) { item ->
                        ItemCard(item, onClick = { nav.item(item.id) })
                    }
                }

                full {
                    Tile(onClick = nav::website) {
                        Text("The board, recipes and connections", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text(
                            if (online) "Open the full website inside the app." else "These need the internet.",
                            style = MaterialTheme.typography.bodySmall, color = LocalB2.current.muted,
                        )
                    }
                }
            }
        }
    }
}

private fun LazyGridScope.full(content: @Composable () -> Unit) =
    item(span = { GridItemSpan(maxLineSpan) }) { content() }

@Composable
private fun Header(online: Boolean, syncing: Boolean, problem: String?, lastSync: String?, nav: HomeNav) {
    val b2 = LocalB2.current
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
        AppTile(40)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Library", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            val status = when {
                !online -> "Offline. Saves wait here and go up later."
                syncing -> "Syncing…"
                problem != null -> "Couldn't sync: $problem"
                else -> "Synced ${ago(lastSync)}"
            }
            Pill(status, dot = if (online && problem == null) b2.muted else b2.accent, modifier = Modifier.padding(top = 4.dp))
        }
        IconButton(onClick = nav::settings) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
    }
}

@Composable
private fun SearchTile(nav: HomeNav) {
    Tile(onClick = nav::search) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Search, contentDescription = null, tint = LocalB2.current.muted)
            Spacer(Modifier.width(10.dp))
            Text("Search everything you saved", color = LocalB2.current.muted)
        }
    }
}

/** Type or paste a link or a note, or pick pictures. Saved here at once, sent when online. */
@Composable
private fun QuickSave(online: Boolean) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var text by rememberSaveable { mutableStateOf("") }
    fun saved(n: Int = 1) = Toast.makeText(
        context,
        if (online) "Saved, sir." else if (n == 1) "Saved on this phone. It goes up when you're online." else "$n saved on this phone. They go up when you're online.",
        Toast.LENGTH_SHORT,
    ).show()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { uris ->
        var n = 0
        for (uri in uris) {
            val file = Outbox.copy(context, uri) ?: continue
            UploadWorker.enqueue(context, null, null, file, context.contentResolver.getType(uri))
            n++
        }
        if (n > 0) saved(n)
    }
    Tile(Modifier.fillMaxWidth()) {
        Text("Save something", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = text, onValueChange = { text = it },
            placeholder = { Text("A link, or a note to yourself") },
            modifier = Modifier.fillMaxWidth(), minLines = 1, maxLines = 4,
        )
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(enabled = text.isNotBlank(), onClick = {
                UploadWorker.enqueue(context, text.trim(), null, null, null)
                text = ""
                saved()
            }) { Text("Save") }
            OutlinedButton(onClick = { clipboard.getText()?.text?.let { text = it } }) { Text("Paste") }
            OutlinedButton(onClick = {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            }) {
                Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Pictures")
            }
        }
    }
}

@Composable
fun SectionTitle(title: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Subjects(tags: List<Pair<String, Int>>, onTag: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        tags.forEach { (tag, n) ->
            AssistChip(onClick = { onTag(tag) }, label = { Text("$tag  $n") })
        }
    }
}
