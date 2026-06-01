package com.lteintercom.app.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.HandlerThread
import kotlin.math.PI
import kotlin.math.sin

class TalkBeepPlayer {
    private val worker = HandlerThread("LTEIntercomTalkBeep").apply { start() }
    private val handler = Handler(worker.looper)
    private val beepBuffer = buildBeepBuffer()
    @Volatile private var released = false
    @Volatile private var lastPlayAtMs = 0L

    fun play() {
        if (released) return
        val now = System.currentTimeMillis()
        if (now - lastPlayAtMs < 160L) return
        lastPlayAtMs = now
        handler.post {
            if (released) return@post
            runCatching {
                val track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build(),
                    )
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(beepBuffer.size * Short.SIZE_BYTES)
                    .build()
                track.write(beepBuffer, 0, beepBuffer.size)
                track.setNotificationMarkerPosition(beepBuffer.size)
                track.setPlaybackPositionUpdateListener(object : AudioTrack.OnPlaybackPositionUpdateListener {
                    override fun onMarkerReached(audioTrack: AudioTrack) {
                        audioTrack.release()
                    }

                    override fun onPeriodicNotification(audioTrack: AudioTrack) = Unit
                }, handler)
                track.play()
            }
        }
    }

    fun release() {
        released = true
        handler.post {
            worker.quitSafely()
        }
    }

    private fun buildBeepBuffer(): ShortArray {
        val sampleCount = (SAMPLE_RATE * BEEP_MS) / 1000
        return ShortArray(sampleCount) { index ->
            val envelope = when {
                index < FADE_SAMPLES -> index.toFloat() / FADE_SAMPLES
                index > sampleCount - FADE_SAMPLES -> (sampleCount - index).toFloat() / FADE_SAMPLES
                else -> 1f
            }.coerceIn(0f, 1f)
            val value = sin(2.0 * PI * TONE_HZ * index / SAMPLE_RATE) * envelope * Short.MAX_VALUE * 0.55
            value.toInt().toShort()
        }
    }

    private companion object {
        const val SAMPLE_RATE = 44100
        const val BEEP_MS = 95
        const val TONE_HZ = 1200
        const val FADE_SAMPLES = 220
    }
}
