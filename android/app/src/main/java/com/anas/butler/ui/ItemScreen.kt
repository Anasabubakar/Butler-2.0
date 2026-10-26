package com.anas.butler.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.anas.butler.library.Deletes
import com.anas.butler.library.Item
import com.anas.butler.library.Outbox

/** One save, in full: what Butler made of it, and what you can do with it here. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ItemScreen(id: String, online: Boolean, onBack: () -> Unit, onTag: (String) -> Unit, onCategory: (String) -> Unit) {
    val context = LocalContext.current
    val loaded = rememberStore(id) { item(id) to true }
    var asking by remember { mutableStateOf(false) }
    val item = loaded.value?.first

    // Deleted (here or on another device) while open.
    LaunchedEffect(loaded.value) {
        val (now, done) = loaded.value ?: return@LaunchedEffect
        if (done && (now == null || now.localState == Item.DELETING)) onBack()
    }
    if (item == null) return

    val b2 = LocalB2.current
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            Box(Modifier.weight(1f))
            IconButton(onClick = { asking = true }) { Icon(Icons.Filled.Delete, contentDescription = "Delete") }
        }
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (item.isPicture || item.thumbnail != null) {
                    ItemPicture(
                        item,
                        Modifier.fillMaxWidth().aspectRatio(if (item.isPicture) 4f / 3f else 16f / 9f)
                            .clip(RoundedCornerShape(22.dp)).border(1.dp, b2.line, RoundedCornerShape(22.dp)),
                    )
                }
                SelectionContainer {
                    Text(item.label, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item.category?.let { c -> AssistChip(onClick = { onCategory(c) }, label = { Text(c) }) }
                    waitingLabel(item)?.let { Pill(it, dot = if (item.localState == Item.FAILED) b2.failed else b2.accent) }
                    Pill(listOfNotNull(item.platform?.replaceFirstChar(Char::uppercase), ago(item.createdAt)).joinToString(" · "))
                }
                item.summary?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
                item.details?.let { d ->
                    Tile {
                        Text("Key points", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        SelectionContainer { Text(d, style = MaterialTheme.typography.bodyMedium) }
                    }
                }
                item.note?.let { n ->
                    Text("“$n”", style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic, color = b2.muted)
                }
                item.body?.takeIf { it != item.summary }?.let { body ->
                    SelectionContainer { Text(body, style = MaterialTheme.typography.bodyMedium) }
                }
                item.url?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = b2.muted) }
                if (item.tags.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        item.tags.forEach { t -> AssistChip(onClick = { onTag(t) }, label = { Text("#$t") }) }
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (item.url != null || item.localFile != null) Button(onClick = { Outbox.open(context, item) }) { Text("Open") }
                    OutlinedButton(onClick = { Outbox.share(context, item) }) { Text("Share") }
                    OutlinedButton(onClick = { Outbox.copyText(context, item) }) { Text(if (item.url != null) "Copy link" else "Copy") }
                    if (item.archiveUrl != null) {
                        OutlinedButton(onClick = { Outbox.openUrl(context, item.archiveUrl) }) {
                            Text(if (item.linkDead) "Saved copy (original is gone)" else "Saved copy")
                        }
                    }
                }
                if (!online && item.url != null) {
                    Text("Links open once you're online. What Butler wrote about it is kept here.", style = MaterialTheme.typography.bodySmall, color = b2.muted)
                }
            }
        }
    }

    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text("Delete this?") },
            text = { Text(if (online) "It goes from every device." else "It goes from every device once you're online.") },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    Deletes.delete(context, item) // the screen closes itself when the item leaves
                }) { Text("Delete", color = b2.failed) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text("Keep") } },
        )
    }
}
