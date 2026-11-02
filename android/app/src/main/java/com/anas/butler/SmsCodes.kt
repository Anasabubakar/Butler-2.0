package com.anas.butler

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Telephony
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Login codes that arrive by SMS (bank OTPs, "your code is 4821"), passed to your laptop so you
 * can type them there. Only the code and who sent it leave the phone, never the message, and
 * the server shows it once and forgets it. Off unless you switch it on in Settings.
 */
object SmsCodes {
    private val words = Regex(
        "\\b(otp|one[- ]?time|verification|verify|security code|login code|sign[- ]?in code|confirmation code|" +
            "access code|auth(?:entication)? code|2fa|passcode|pin|code|token)\\b",
        RegexOption.IGNORE_CASE,
    )
    private val promo = Regex("promo|coupon|discount|voucher|% off|referral|redeem", RegexOption.IGNORE_CASE)
    private val candidate = Regex("(?<![\\w\\-/.@#₦$£€])(\\d{4,8}|\\d{3}[- ]\\d{3}|[A-Z0-9]{3,4}-[A-Z0-9]{3,4})(?![\\w\\-/@%]|\\.\\d)")
    private val notCode = Regex(
        "(\\d[\\d,]*\\.?|[₦$£€]\\s*|(no|number|#|ref|order|invoice|account|acct|card|ending in|ending|id|bal|balance|amt|amount)\\W{0,3})$",
        RegexOption.IGNORE_CASE,
    )

    /** The login code in a text, or null when it isn't a code text. The same rules as the server's email heads-ups. */
    fun find(text: String): String? {
        val head = text.take(400)
        if (!words.containsMatchIn(head) || promo.containsMatchIn(head)) return null
        var best: String? = null
        var bestScore = 30
        for (m in candidate.findAll(text.take(1000))) {
            val code = m.value
            val n = code.toIntOrNull()
            if (code.length == 4 && n != null && n in 1990..2100) continue // a year
            if (code.all { it == code[0] }) continue // 0000
            val before = text.substring(maxOf(0, m.range.first - 70), m.range.first)
            if (notCode.containsMatchIn(before.trimEnd())) continue
            var score = 0
            words.findAll(before).lastOrNull()?.let { score = 100 - (before.length - it.range.last - 1) }
            val after = text.substring(m.range.last + 1, minOf(text.length, m.range.last + 41))
            if (Regex("^\\s*(is|was)?\\s*(your|the)\\b[^\\n]{0,30}\\b(code|otp|pin|passcode)", RegexOption.IGNORE_CASE).containsMatchIn(after)) {
                score = maxOf(score, 120)
            }
            if (Regex("(code|otp|pin|passcode)\\s*(is|:)\\s*$", RegexOption.IGNORE_CASE).containsMatchIn(before)) score = maxOf(score, 150)
            if (score > bestScore) {
                best = code
                bestScore = score
            }
        }
        return best
    }

    /** How long it lasts, said the text's way: "valid for 5 mins". */
    fun expiry(text: String): String? {
        val m = Regex("\\b(valid|expires?|expiring|active)\\b\\s*(?:for|in|within)?\\s*(\\d{1,3})\\s*(minutes?|mins?|hours?|hrs?)\\b", RegexOption.IGNORE_CASE)
            .find(text) ?: return null
        val n = m.groupValues[2]
        val hours = m.groupValues[3].startsWith("h", ignoreCase = true)
        val unit = if (hours) (if (n == "1") "hour" else "hours") else (if (n == "1") "min" else "mins")
        val verb = if (m.groupValues[1].lowercase().let { it == "valid" || it == "active" }) "valid for" else "expires in"
        return "$verb $n $unit"
    }

    /** Who sent it, as a name: "STERLING" becomes "Sterling"; a phone number stays as it is. */
    fun sender(address: String): String =
        if (address.any { it.isLetter() }) address.lowercase().replaceFirstChar { it.uppercase() } else address

    /** What the laptop is told: "your Sterling code is 482913 (valid for 5 mins)". */
    fun note(address: String, text: String, code: String): String =
        "your ${sender(address)} code is $code${expiry(text)?.let { " ($it)" } ?: ""}"
}

/** Hears each incoming SMS and, when it holds a login code and you switched this on, sends the code to your laptop. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val config = Config(context)
        if (!config.smsCodes || !config.isReady) return
        if (context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val address = parts.firstOrNull()?.displayOriginatingAddress ?: return
        val text = parts.joinToString("") { it.displayMessageBody.orEmpty() }
        val code = SmsCodes.find(text) ?: return
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                ButlerClient(config).send("laptop", "note", text = SmsCodes.note(address, text, code), secret = true, copy = code)
            } catch (_: Exception) {
                // No laptop yet, or offline: the code is still on the phone where it arrived.
            } finally {
                done.finish()
            }
        }
    }
}
