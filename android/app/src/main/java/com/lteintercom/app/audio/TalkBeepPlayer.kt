package com.lteintercom.app.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.SoundPool
import android.os.Handler
import android.os.HandlerThread
import java.io.File
import java.io.FileOutputStream
import kotlin.math.PI
import kotlin.math.sin

class TalkBeepPlayer(context: Context) {
    private val appContext = context.applicationContext
    private val worker = HandlerThread("LTEIntercomTalkBeep").apply { start() }
    private val handler = Handler(worker.looper)
    private val beepBuffer = buildBeepBuffer()
    private var soundPool: SoundPool? = null
    private var soundId = 0
    @Volatile private var soundReady = false
    @Volatile private var released = false
    @Volatile private var lastPlayAtMs = 0L

    init {
        handler.post { prepareSoundPool() }
    }

    fun play() {
        if (released) return
        val now = System.currentTimeMillis()
        if (now - lastPlayAtMs < 150L) return
        lastPlayAtMs = now

        val pool = soundPool
        if (pool != null && soundReady && soundId != 0) {
            val streamId = runCatching { pool.play(soundId, 1f, 1f, 1, 0, 1f) }.getOrDefault(0)
            if (streamId != 0) return
        }

        handler.post {
            if (!released) playAudioTrackFallback()
        }
    }

    fun release() {
        released = true
        handler.post {
            soundPool?.release()
            soundPool = null
            soundReady = false
            worker.quitSafely()
        }
    }

    private fun prepareSoundPool() {
        if (released || soundPool != null) return
        val pool = SoundPool.Builder()
            .setMaxStreams(2)
            .setAudioAttributes(beepAudioAttributes())
            .build()
        pool.setOnLoadCompleteListener { _, loadedSoundId, status ->
            if (loadedSoundId == soundId && status == 0) {
                soundReady = true
            }
        }
        soundPool = pool
        val file = ensureBeepFile() ?: return
        soundId = pool.load(file.absolutePath, 1)
    }

    private fun playAudioTrackFallback() {
        runCatching {
            val track = AudioTrack.Builder()
                .setAudioAttributes(beepAudioAttributes())
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
                return@runCatching
            }
            track.write(beepBuffer, 0, beepBuffer.size)
            track.setNotificationMarkerPosition(beepBuffer.size)
            track.setPlaybackPositionUpdateListener(object : AudioTrack.OnPlaybackPositionUpdateListener {
                override fun onMarkerReached(audioTrack: AudioTrack) {
                    runCatching { audioTrack.release() }
                }

                override fun onPeriodicNotification(audioTrack: AudioTrack) = Unit
            }, handler)
            track.play()
            handler.postDelayed({ runCatching { track.release() } }, BEEP_MS + 250L)
        }
    }

    private fun ensureBeepFile(): File? {
        val file = File(appContext.cacheDir, "lte_intercom_talk_beep_v2.wav")
        if (file.exists() && file.length() > WAV_HEADER_BYTES) return file
        return runCatching {
            FileOutputStream(file, false).use { output ->
                writeWavHeader(output, beepBuffer.size)
                for (sample in beepBuffer) {
                    val value = sample.toInt()
                    output.write(value and 0xff)
                    output.write((value shr 8) and 0xff)
                }
            }
            file
        }.getOrNull()
    }

    private fun writeWavHeader(output: FileOutputStream, sampleCount: Int) {
        val dataBytes = sampleCount * Short.SIZE_BYTES
        output.writeAscii("RIFF")
        output.writeLittleEndianInt(36 + dataBytes)
        output.writeAscii("WAVE")
        output.writeAscii("fmt ")
        output.writeLittleEndianInt(16)
        output.writeLittleEndianShort(1)
        output.writeLittleEndianShort(1)
        output.writeLittleEndianInt(SAMPLE_RATE)
        output.writeLittleEndianInt(SAMPLE_RATE * Short.SIZE_BYTES)
        output.writeLittleEndianShort(Short.SIZE_BYTES)
        output.writeLittleEndianShort(16)
        output.writeAscii("data")
        output.writeLittleEndianInt(dataBytes)
    }

    private fun beepAudioAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    private fun buildBeepBuffer(): ShortArray {
        val sampleCount = (SAMPLE_RATE * BEEP_MS) / 1000
        return ShortArray(sampleCount) { index ->
            val envelope = when {
                index < FADE_SAMPLES -> index.toFloat() / FADE_SAMPLES
                index > sampleCount - FADE_SAMPLES -> (sampleCount - index).toFloat() / FADE_SAMPLES
                else -> 1f
            }.coerceIn(0f, 1f)
            val value = sin(2.0 * PI * TONE_HZ * index / SAMPLE_RATE) * envelope * Short.MAX_VALUE * 0.7
            value.toInt().toShort()
        }
    }

    private fun FileOutputStream.writeAscii(value: String) {
        write(value.toByteArray(Charsets.US_ASCII))
    }

    private fun FileOutputStream.writeLittleEndianShort(value: Int) {
        write(value and 0xff)
        write((value shr 8) and 0xff)
    }

    private fun FileOutputStream.writeLittleEndianInt(value: Int) {
        write(value and 0xff)
        write((value shr 8) and 0xff)
        write((value shr 16) and 0xff)
        write((value shr 24) and 0xff)
    }

    private companion object {
        const val SAMPLE_RATE = 44100
        const val BEEP_MS = 110
        const val TONE_HZ = 1200
        const val FADE_SAMPLES = 220
        const val WAV_HEADER_BYTES = 44L
    }
}
