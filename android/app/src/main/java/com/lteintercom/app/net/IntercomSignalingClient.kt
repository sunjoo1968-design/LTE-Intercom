package com.lteintercom.app.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import android.util.Base64
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class IntercomSignalingClient(
    private val listener: Listener,
) {
    interface Listener {
        fun onConnecting()
        fun onConnected(message: String)
        fun onDisconnected(message: String)
        fun onEvent(type: String, message: JSONObject)
        fun onAudioFrame(fromParticipantId: String, pcm16: ByteArray)
        fun onWebRtcSignal(fromParticipantId: String, toParticipantId: String?, payload: JSONObject)
        fun onError(message: String)
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null

    fun connect(serverBaseUrl: String, roomCode: String, roomPassword: String, displayName: String) {
        disconnect()
        listener.onConnecting()

        val url = buildUrl(serverBaseUrl, roomCode, roomPassword, displayName)
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    listener.onConnected("CONNECTED")
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val json = runCatching { JSONObject(text) }.getOrNull()
                    if (json == null) {
                        listener.onError("Invalid server message")
                        return
                    }
                    if (json.optString("type") == "audio.frame") {
                        val payload = json.optJSONObject("payload")
                        val encoded = payload?.optString("pcm16").orEmpty()
                        val frame = runCatching { Base64.decode(encoded, Base64.NO_WRAP) }.getOrNull()
                        if (frame != null) {
                            listener.onAudioFrame(json.optString("fromParticipantId"), frame)
                        }
                        return
                    }
                    if (json.optString("type") == "webrtc.signal") {
                        listener.onWebRtcSignal(
                            fromParticipantId = json.optString("fromParticipantId"),
                            toParticipantId = json.optString("toParticipantId").takeIf { it.isNotBlank() && it != "null" },
                            payload = json.optJSONObject("payload") ?: JSONObject(),
                        )
                        return
                    }
                    listener.onEvent(json.optString("type", "unknown"), json)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                    listener.onDisconnected("CLOSING $code")
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    listener.onDisconnected("DISCONNECTED")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    listener.onError(t.message ?: "Connection failed")
                }
            },
        )
    }

    fun disconnect() {
        socket?.close(1000, "client disconnect")
        socket = null
    }

    fun sendTalk(active: Boolean) {
        sendJson(
            JSONObject()
                .put("type", "state.update")
                .put(
                    "payload",
                    JSONObject()
                        .put("talking", active)
                        .put("muted", false),
                ),
        )
    }

    fun sendListen(active: Boolean) {
        sendJson(
            JSONObject()
                .put("type", "state.update")
                .put("payload", JSONObject().put("listening", active)),
        )
    }

    fun sendCall(channelId: String) {
        sendJson(
            JSONObject()
                .put("type", "call.signal")
                .put("payload", JSONObject().put("channelId", channelId)),
        )
    }

    fun requestSnapshot() {
        sendJson(JSONObject().put("type", "room.snapshot"))
    }

    fun sendAudioFrame(pcm16: ByteArray) {
        sendJson(
            JSONObject()
                .put("type", "audio.frame")
                .put(
                    "payload",
                    JSONObject()
                        .put("codec", "pcm16")
                        .put("sampleRate", 16000)
                        .put("channels", 1)
                        .put("pcm16", Base64.encodeToString(pcm16, Base64.NO_WRAP)),
                ),
        )
    }

    fun sendWebRtcSignal(toParticipantId: String?, payload: JSONObject) {
        val message = JSONObject()
            .put("type", "webrtc.signal")
            .put("payload", payload)
        if (!toParticipantId.isNullOrBlank()) {
            message.put("toParticipantId", toParticipantId)
        }
        sendJson(message)
    }

    private fun sendJson(json: JSONObject) {
        socket?.send(json.toString())
    }

    private fun buildUrl(serverBaseUrl: String, roomCode: String, roomPassword: String, displayName: String): String {
        val base = serverBaseUrl.trim()
            .ifBlank { "ws://192.168.0.10:8443/signal" }
            .removeSuffix("/")
        val separator = if (base.contains("?")) "&" else "?"
        return "$base${separator}room=${roomCode.urlEncode()}&password=${roomPassword.urlEncode()}&name=${displayName.urlEncode()}"
    }

    private fun String.urlEncode(): String = URLEncoder.encode(this, "UTF-8")
}
