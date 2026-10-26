package com.anas.butler.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.anas.butler.R
import com.anas.butler.library.Item
import com.anas.butler.library.LibraryStore
import java.io.File

/** One bento tile: rounded, a hairline border, and whatever goes inside. */
@Composable
fun Tile(
    modifier: Modifier = Modifier,
    strong: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val b2 = LocalB2.current
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier
            .clip(shape)
            .background(if (strong) b2.tileStrong else b2.tile)
            .border(1.dp, if (strong) Color.Transparent else b2.line, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(16.dp),
    ) {
        CompositionLocalProvider(LocalContentColor provides if (strong) b2.onTileStrong else MaterialTheme.colorScheme.onSurface) {
            content()
        }
    }
}

/** The Butler 2.0 app tile, used as the logo (never the wordmark set in a font). */
@Composable
fun AppTile(size: Int = 36) {
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.28f).dp)).background(B2.Ink),
        contentAlignment = Alignment.Center,
    ) {
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, Modifier.fillMaxSize())
    }
}

/** A small round label, like "Waiting to sync". */
@Composable
fun Pill(text: String, dot: Color? = null, modifier: Modifier = Modifier) {
    val b2 = LocalB2.current
    Row(
        modifier.clip(CircleShape).border(1.dp, b2.line, CircleShape).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot != null) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

/** What a save looks like at a glance: its picture, its link preview, or a mark for its kind. */
@Composable
fun ItemPicture(item: Item, modifier: Modifier = Modifier) {
    val b2 = LocalB2.current
    val local = item.localFile?.takeIf { item.isPicture }?.let(::File)?.takeIf { it.exists() }
    val model: Any? = local ?: item.thumbnail
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (model != null) {
            AsyncImage(model = model, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(painterResource(kindIcon(item.kind)), contentDescription = null, tint = b2.muted, modifier = Modifier.size(26.dp))
                item.platform?.let {
                    Spacer(Modifier.size(4.dp))
                    Text(it.replaceFirstChar(Char::uppercase), style = MaterialTheme.typography.labelSmall, color = b2.muted)
                }
            }
        }
    }
}

fun kindIcon(kind: String) = when (kind) {
    "link" -> R.drawable.ic_bookmark
    "image" -> R.drawable.ic_library
    "video" -> R.drawable.ic_library
    "file" -> R.drawable.ic_copy
    else -> R.drawable.ic_lightbulb
}

fun kindName(kind: String) = when (kind) {
    "link" -> "Links"
    "image" -> "Pictures"
    "video" -> "Videos"
    "file" -> "Files"
    else -> "Notes"
}

/** "Waiting to sync", "Didn't save" or nothing, for an item's state on this phone. */
fun waitingLabel(item: Item): String? = when (item.localState) {
    Item.SAVING -> "Waiting to sync"
    Item.FAILED -> "Server refused it"
    else -> if (item.status == "pending" && !item.isLocal) "Organizing" else null
}

/** A card in a grid of saves. */
@Composable
fun ItemCard(item: Item, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val b2 = LocalB2.current
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier.clip(shape).background(b2.tile).border(1.dp, b2.line, shape).clickable(onClick = onClick),
    ) {
        ItemPicture(item, Modifier.fillMaxWidth().aspectRatio(16f / 10f))
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                item.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            val meta = listOfNotNull(item.category, item.platform?.replaceFirstChar(Char::uppercase)).joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text(meta, style = MaterialTheme.typography.labelSmall, color = b2.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            waitingLabel(item)?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = if (item.localState == Item.FAILED) b2.failed else b2.accent)
            }
        }
    }
}

/** "just now", "5 min ago", "yesterday", or the date. */
fun ago(iso: String?): String {
    val date = iso?.let(LibraryStore::parseIso) ?: return "never"
    val minutes = (System.currentTimeMillis() - date.time) / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 24 * 60 -> "${minutes / 60} h ago"
        minutes < 48 * 60 -> "yesterday"
        else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(date)
    }
}

/** A big number with a word under it, for the stat tiles. */
@Composable
fun Stat(number: String, label: String, color: Color = LocalContentColor.current) {
    Text(number, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = color)
    Text(label, style = MaterialTheme.typography.bodySmall, color = LocalContentColor.current.copy(alpha = 0.7f))
}
