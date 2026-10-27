package com.anas.butler.transfer

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import com.anas.butler.ButlerClient
import com.anas.butler.Config
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * The laptop's direct link (link.py on the laptop), for sending files with no internet: on
 * the same Wi-Fi, or with the laptop on your phone's hotspot.
 *
 * Safe on any Wi-Fi: the laptop has its own certificate, and this phone only talks to the one
 * whose fingerprint your Butler server gave it (learned once, while online). So nobody else
 * on the network can pretend to be your laptop or read the files. The phone proves it's yours
 * with your Butler token, which only travels inside that encrypted connection.
 */
data class LinkInfo(val port: Int, val fingerprint: String, val addresses: List<String>)

object Link {
    const val BEACON_PORT = 53321
    private const val PREFS = "link"

    /** What this phone knows of the laptop's link, or null if it hasn't learned it yet. */
    fun known(context: Context): LinkInfo? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val fingerprint = prefs.getString("fingerprint", null) ?: return null
        val addresses = runCatching { JSONArray(prefs.getString("addresses", "[]")) }.getOrNull()
        return LinkInfo(prefs.getInt("port", 0), fingerprint, List(addresses?.length() ?: 0) { addresses!!.getString(it) })
    }

    private fun remember(context: Context, info: LinkInfo) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("port", info.port)
            .putString("fingerprint", info.fingerprint)
            .putString("addresses", JSONArray(info.addresses).toString())
            .apply()
    }

    /** The address that answered last time, tried first. */
    var lastGood: String? = null
        private set

    /** Asks Butler (online) how to reach your laptop directly. Keeps what it learns for when you're offline. */
    suspend fun learn(context: Context) {
        val config = Config(context)
        if (!config.isReady) return
        val peers = JSONArray(ButlerClient(config).get("/api/device/peers?device=${java.net.URLEncoder.encode(config.deviceName, "UTF-8")}"))
        for (i in 0 until peers.length()) {
            val peer = peers.getJSONObject(i)
            val local = peer.optJSONObject("local") ?: continue
            if (peer.optString("kind") != "laptop") continue
            val addresses = local.optJSONArray("addresses") ?: JSONArray()
            remember(context, LinkInfo(local.optInt("port"), local.optString("fingerprint"), List(addresses.length()) { addresses.getString(it) }))
            return
        }
    }

    /** The Wi-Fi network, so a Wi-Fi with no internet is still used for the laptop (Android would pick mobile data). */
    private fun wifi(context: Context): Network? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        return cm.allNetworks.firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
    }

    /**
     * An HTTPS client that trusts only the laptop's own certificate. `socket` picks the network
     * (the Wi-Fi, or the default one when this phone is the hotspot).
     */
    fun client(info: LinkInfo, socket: SocketFactory? = null, readSeconds: Long = 60): OkHttpClient {
        val pinned = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = throw CertificateException()
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                val leaf = chain.firstOrNull() ?: throw CertificateException("no certificate")
                val seen = MessageDigest.getInstance("SHA-256").digest(leaf.encoded).joinToString("") { "%02x".format(it) }
                if (!MessageDigest.isEqual(seen.toByteArray(), info.fingerprint.toByteArray())) {
                    throw CertificateException("that isn't your laptop")
                }
            }
            override fun getAcceptedIssuers() = arrayOf<X509Certificate>()
        }
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(pinned), SecureRandom()) }
        return OkHttpClient.Builder()
            .sslSocketFactory(tls.socketFactory, pinned)
            .hostnameVerifier { _, _ -> true } // the fingerprint is what proves it's your laptop
            .apply { socket?.let { socketFactory(it) } }
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(readSeconds, TimeUnit.SECONDS)
            .writeTimeout(2, TimeUnit.MINUTES)
            .build()
    }

    /**
     * Finds your laptop on this network: the address that worked last time, those Butler knows
     * of, and whoever is calling out "Butler's laptop is here". Null if it isn't reachable.
     */
    suspend fun find(context: Context, listenMs: Int = 3500): Laptop? = withContext(Dispatchers.IO) {
        val info = known(context) ?: return@withContext null
        val config = Config(context)
        if (config.token.isEmpty()) return@withContext null
        val socket = wifi(context)?.socketFactory
        val clients = listOfNotNull(socket?.let { client(info, it, 5) }, client(info, null, 5))
        suspend fun tryAll(addresses: List<String>): Laptop? = coroutineScope {
            addresses.distinct().flatMap { address -> clients.map { address to it } }
                .map { (address, http) -> async { if (hello(http, address, info, config)) address to http else null } }
                .awaitAll().firstOrNull { it != null }
                ?.let { (address, _) -> Laptop(context, info.copy(), address, socket) }
        }
        tryAll(listOfNotNull(lastGood) + info.addresses)?.let { return@withContext it.also { l -> lastGood = l.address } }
        val heard = listen(context, info, listenMs) ?: return@withContext null
        tryAll(listOf(heard))?.also { lastGood = it.address }
    }

    private fun hello(http: OkHttpClient, address: String, info: LinkInfo, config: Config): Boolean = runCatching {
        val request = Request.Builder().url("https://$address:${info.port}/link/hello")
            .header("x-butler-token", config.token).header("x-butler-device", config.deviceName).build()
        http.newCall(request).execute().use { it.isSuccessful }
    }.getOrDefault(false)

    /** Listens for the laptop's "I'm here" call for up to `ms`. Returns where it came from. */
    private fun listen(context: Context, info: LinkInfo, ms: Int): String? {
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
        // Android drops calls to everyone on the network unless an app asks to hear them.
        val lock = wifi?.createMulticastLock("butler-link")?.apply { setReferenceCounted(false); acquire() }
        try {
            DatagramSocket(null).use { s ->
                s.reuseAddress = true
                s.broadcast = true
                s.bind(InetSocketAddress(BEACON_PORT))
                s.soTimeout = 500
                val buffer = ByteArray(1024)
                val until = System.currentTimeMillis() + ms
                while (System.currentTimeMillis() < until) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        s.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    val call = runCatching { JSONObject(String(packet.data, 0, packet.length)) }.getOrNull() ?: continue
                    if (call.optInt("butler") == 1 && info.fingerprint.startsWith(call.optString("fp", "-"))) {
                        return packet.address.hostAddress
                    }
                }
            }
        } catch (_: Exception) {
            // no Wi-Fi, or the port is busy: try again next time
        } finally {
            lock?.release()
        }
        return null
    }
}

/** Your laptop, reachable directly at `address`. */
class Laptop(val context: Context, val info: LinkInfo, val address: String, private val socket: SocketFactory?) {
    val base get() = "https://$address:${info.port}"

    /** A client for this laptop; long reads for the inbox's held-open requests. */
    fun http(readSeconds: Long = 60) = Link.client(info, socket, readSeconds)

    fun request(path: String): Request.Builder {
        val config = Config(context)
        return Request.Builder().url(base + path)
            .header("x-butler-token", config.token)
            .header("x-butler-device", config.deviceName)
    }
}
