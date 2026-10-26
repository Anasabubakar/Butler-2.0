package com.anas.butler.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.anas.butler.library.Item

/** Saving, on its own tab: the Save something tile, and what's still waiting to go up. */
@Composable
fun SaveScreen(online: Boolean, onItem: (String) -> Unit) {
    val waiting = rememberStore { items(limit = 200).filter { it.localState == Item.SAVING || it.localState == Item.FAILED } }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(160.dp),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text("Save", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        item(span = { GridItemSpan(maxLineSpan) }) { QuickSave(online) }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text(
                "From other apps, use Share → Save to Butler. Saves work offline and go up by themselves when you're online.",
                style = MaterialTheme.typography.bodySmall, color = LocalB2.current.muted,
            )
        }
        val list = waiting.value.orEmpty()
        if (list.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                SectionTitle(if (online) "Going up now" else "Waiting for internet")
            }
            items(list, key = { it.id }) { item -> ItemCard(item, onClick = { onItem(item.id) }) }
        }
    }
}
