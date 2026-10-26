package com.anas.butler.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.anas.butler.library.LibraryStore
import com.anas.butler.library.Sync

private val KINDS = listOf("link", "image", "video", "text", "file")

/** Everything you saved, searchable and filterable, with or without internet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    start: LibraryStore.Filter,
    focusSearch: Boolean,
    onBack: () -> Unit,
    onItem: (String) -> Unit,
) {
    val context = LocalContext.current
    var search by rememberSaveable { mutableStateOf(start.search) }
    var kind by rememberSaveable { mutableStateOf(start.kind) }
    var category by rememberSaveable { mutableStateOf(start.category) }
    var tag by rememberSaveable { mutableStateOf(start.tag) }
    val filter = LibraryStore.Filter(search, category, kind, tag)
    val items = rememberStore(filter) { items(filter) }
    val syncing = Sync.running.collectAsStateValue()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (focusSearch) runCatching { focus.requestFocus() } }

    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 8.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            OutlinedTextField(
                value = search, onValueChange = { search = it },
                placeholder = { Text("Search your library") },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                trailingIcon = {
                    if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear") }
                },
                singleLine = true,
                shape = MaterialTheme.shapes.large,
                modifier = Modifier.weight(1f).focusRequester(focus),
            )
        }
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            category?.let { c -> item { InputChip(selected = true, onClick = { category = null }, label = { Text(c) }, trailingIcon = { Icon(Icons.Filled.Close, null) }) } }
            tag?.let { t -> item { InputChip(selected = true, onClick = { tag = null }, label = { Text("#$t") }, trailingIcon = { Icon(Icons.Filled.Close, null) }) } }
            item { FilterChip(selected = kind == null, onClick = { kind = null }, label = { Text("Everything") }) }
            items(KINDS) { k -> FilterChip(selected = kind == k, onClick = { kind = if (kind == k) null else k }, label = { Text(kindName(k)) }) }
        }
        PullToRefreshBox(isRefreshing = syncing, onRefresh = { Sync.now(context) }, modifier = Modifier.fillMaxSize()) {
            val list = items.value
            when {
                list == null -> {}
                list.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.TopCenter) {
                    Text(
                        if (search.isBlank()) "Nothing here yet." else "Nothing matches \"$search\" on this phone.",
                        color = LocalB2.current.muted,
                    )
                }
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(160.dp),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    items(list, key = { it.id }) { item -> ItemCard(item, onClick = { onItem(item.id) }) }
                }
            }
        }
    }
}
