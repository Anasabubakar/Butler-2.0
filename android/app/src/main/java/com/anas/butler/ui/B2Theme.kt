package com.anas.butler.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Butler 2.0 colours for the native screens (the same values as web/src/b2-tokens.css):
 * black and white lead, vermilion only as a small accent. Follows the phone's light or dark mode.
 */
object B2 {
    val Ink = Color(0xFF111111)
    val White = Color(0xFFFFFFFF)
    val Paper = Color(0xFFF8F7F4)
    val Vermilion = Color(0xFFE4462D)
    val ActionRed = Color(0xFFB83120)
    val Muted = Color(0xFF65625E)
    val Line = Color(0xFFD8D5CF)
    val DarkSurface = Color(0xFF191919)
    val DarkRaised = Color(0xFF222120)
    val DarkMuted = Color(0xFFA8A49E)
    val DarkLine = Color(0xFF2E2C29)
    val DarkFailed = Color(0xFFFF8A73)
}

/** Colours the Material scheme has no slot for. */
@Immutable
data class B2Extra(
    val tile: Color,        // bento tiles
    val tileStrong: Color,  // the one tile that leads: ink on light, raised charcoal on dark
    val onTileStrong: Color,
    val line: Color,
    val muted: Color,
    val accent: Color,
    val failed: Color,
)

val LocalB2 = staticCompositionLocalOf {
    B2Extra(B2.White, B2.Ink, B2.White, B2.Line, B2.Muted, B2.Vermilion, B2.ActionRed)
}

private val light = lightColorScheme(
    primary = B2.Ink, onPrimary = B2.White,
    secondary = B2.Ink, onSecondary = B2.White,
    secondaryContainer = Color(0xFFEDEBE6), onSecondaryContainer = B2.Ink,
    tertiary = B2.Vermilion,
    background = B2.Paper, onBackground = B2.Ink,
    surface = B2.Paper, onSurface = B2.Ink,
    surfaceVariant = Color(0xFFEDEBE6), onSurfaceVariant = B2.Muted,
    surfaceContainer = B2.White, surfaceContainerHigh = B2.White, surfaceContainerHighest = Color(0xFFEDEBE6),
    outline = B2.Line, outlineVariant = B2.Line,
    error = B2.ActionRed, onError = B2.White,
)

private val dark = darkColorScheme(
    primary = B2.White, onPrimary = B2.Ink,
    secondary = B2.White, onSecondary = B2.Ink,
    secondaryContainer = B2.DarkLine, onSecondaryContainer = B2.White,
    tertiary = B2.Vermilion,
    background = B2.Ink, onBackground = B2.White,
    surface = B2.Ink, onSurface = B2.White,
    surfaceVariant = B2.DarkRaised, onSurfaceVariant = B2.DarkMuted,
    surfaceContainer = B2.DarkSurface, surfaceContainerHigh = B2.DarkRaised, surfaceContainerHighest = B2.DarkLine,
    outline = B2.DarkLine, outlineVariant = B2.DarkLine,
    error = B2.DarkFailed, onError = B2.Ink,
)

private val shapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
)

@Composable
fun B2Theme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val extra = if (darkTheme) {
        B2Extra(B2.DarkSurface, Color(0xFF2A2826), B2.White, B2.DarkLine, B2.DarkMuted, B2.Vermilion, B2.DarkFailed)
    } else {
        B2Extra(B2.White, B2.Ink, B2.White, B2.Line, B2.Muted, B2.Vermilion, B2.ActionRed)
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalB2 provides extra) {
        val scheme = if (darkTheme) dark else light
        MaterialTheme(colorScheme = scheme, shapes = shapes) {
            // Text with no colour of its own takes the page's text colour, not black.
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalContentColor provides scheme.onBackground,
                content = content,
            )
        }
    }
}
