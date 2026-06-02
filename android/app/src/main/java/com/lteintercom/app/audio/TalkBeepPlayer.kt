package com.lteintercom.app.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.ToneGenerator
import android.os.Handler
import android.os.HandlerThread
import kotlin.math.PI
import kotlin.math.sin

class TalkBeepPlayer {
    private val worker = HandlerThread("LTEIntercomTalkBeep").apply { start() }
    private val handler = Handler(worker.looper)
    private val beepBuffer = buildBeepBuffer()
    private var audioTrack: AudioTrack? = null
    private var toneGenerator: ToneGenerator? = null
    @Volatile private var released = false
    @Volatile private var lastPlayAtMs = 0L

    init {
        handler.post {
            audioTrack = createCommunicationTrack()
            toneGenerator = runCatching { ToneGenerator(AudioManager.STREAM_VOICE_CALL, 72) }.getOrNull()
        }
    }

    fun play() {
        if (released) return
        val now = System.currentTimeMillis()
        if (now - lastPlayAtMs < 150L) return
        lastPlayAtMs = now
        handler.post {
            if (released) return@post
            val playedTrack = playCommunicationTrack()
            val playedTone = runCatching {
                toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, BEEP_MS) == true
            }.getOrDefault(false)
            if (!playedTrack && !playedTone) {
                audioTrack = createCommunicationTrack()
                runCatching { toneGenerator = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 72) }
                playCommunicationTrack()
                runCatching { toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, BEEP_MS) }
            }
        }
    }

    fun release() {
        released = true
        handler.post {
            runCatching { audioTrack?.release() }
            audioTrack = null
            runCatching { toneGenerator?.release() }
            toneGenerator = null
            worker.quitSafely()
        }
    }

    private fun playCommunicationTrack(): Boolean {
        val track = audioTrack ?: createCommunicationTrack()?.also { audioTrack = it } ?: return false
        return runCatching {
            if (track.state != AudioTrack.STATE_INITIALIZED) return@runCatching false
            runCatching { track.stop() }
            track.reloadStaticData()
            track.setPlaybackHeadPosition(0)
            track.play()
            true
        }.getOrElse {
            runCatching { track.release() }
            audioTrack = null
            false
        }
    }

    private fun createCommunicationTrack(): AudioTrack? {
        return runCatching {
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
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
            if (track.state != AudioTrack.STATE_INITIALIZED) {
                track.release()
                return@runCatching null
            }
            track.write(beepBuffer, 0, beepBuffer.size)
            track.setVolume(1.0f)
            track
        }.getOrNull()
    }

    private fun buildBeepBuffer(): ShortArray {
        val sampleCount = (SAMPLE_RATE * BEEP_MS) / 1000
        return ShortArray(sampleCount) { index ->
            val envelope = when {
                index < FADE_SAMPLES -> index.toFloat() / FADE_SAMPLES
                index > sampleCount - FADE_SAMPLES -> (sampleCount - index).toFloat() / FADE_SAMPLES
                else -> 1f
            }.coerceIn(0f, 1f)
            val value = sin(2.0 * PI * TONE_HZ * index / SAMPLE_RATE) * envelope * Short.MAX_VALUE * 0.62
            value.toInt().toShort()
        }
    }

    private companion object {
        const val SAMPLE_RATE = 44100
        const val BEEP_MS = 120
        const val TONE_HZ = 1350
        const val FADE_SAMPLES = 220
    }
}
