package com.lteintercom.app.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioAttributes
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import kotlin.math.max
import kotlin.math.sqrt

class AudioLevelMonitor(
    private val onLevel: (Float) -> Unit,
    private val onAudioFrame: (ByteArray) -> Unit,
    private val onError: (String) -> Unit,
) {
    enum class EchoControlMode {
        Off,
        EchoCancel,
        Meeting,
    }

    private val sampleRate = 16_000
    private var recorder: AudioRecord? = null
    private var sidetoneTrack: AudioTrack? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private var worker: Thread? = null
    @Volatile private var running = false
    @Volatile var sidetoneEnabled: Boolean = false
    @Volatile var echoControlMode: EchoControlMode = EchoControlMode.Meeting
    @Volatile var microphoneGain: Float = 1.0f

    @SuppressLint("MissingPermission")
    fun start() {
        if (running) return

        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) {
            onError("Audio input unavailable")
            return
        }

        val frameSamples = sampleRate / 50
        val bufferSize = max(minBuffer * 2, frameSamples * 2)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            onError("Audio input init failed")
            return
        }

        recorder = audioRecord
        applyInputEffects(audioRecord.audioSessionId)
        sidetoneTrack = if (sidetoneEnabled) createSidetoneTrack(bufferSize) else null
        running = true
        audioRecord.startRecording()
        sidetoneTrack?.play()

        worker = Thread({
            val buffer = ShortArray(frameSamples)
            val micBuffer = ShortArray(frameSamples)
            val sidetoneBuffer = ShortArray(frameSamples)
            while (running) {
                val read = audioRecord.read(buffer, 0, buffer.size)
                if (read > 0) {
                    applyMicrophoneGain(buffer, micBuffer, read)
                    onLevel(calculateLevel(micBuffer, read))
                    sidetoneTrack?.let { track -> writeSidetone(track, micBuffer, sidetoneBuffer, read) }
                    onAudioFrame(toPcm16LittleEndian(micBuffer, read))
                }
            }
        }, "LTEIntercomAudioLevel").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        worker = null
        recorder?.let { audioRecord ->
            runCatching { audioRecord.stop() }
            audioRecord.release()
        }
        recorder = null
        echoCanceler?.release()
        echoCanceler = null
        noiseSuppressor?.release()
        noiseSuppressor = null
        sidetoneTrack?.let { track ->
            runCatching { track.stop() }
            track.release()
        }
        sidetoneTrack = null
        onLevel(0f)
    }

    private fun createSidetoneTrack(bufferSize: Int): AudioTrack? {
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        if (track.state != AudioTrack.STATE_INITIALIZED) {
            track.release()
            onError("Sidetone output init failed")
            return null
        }
        track.setVolume(1.0f)
        return track
    }

    private fun writeSidetone(track: AudioTrack, input: ShortArray, output: ShortArray, read: Int) {
        val gain = 1.8f
        for (index in 0 until read) {
            output[index] = (input[index] * gain)
                .toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                .toShort()
        }
        track.write(output, 0, read)
    }

    private fun applyMicrophoneGain(input: ShortArray, output: ShortArray, read: Int) {
        val gain = microphoneGain.coerceIn(0.6f, 3.0f)
        for (index in 0 until read) {
            output[index] = (input[index] * gain)
                .toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                .toShort()
        }
    }

    private fun toPcm16LittleEndian(input: ShortArray, read: Int): ByteArray {
        val output = ByteArray(read * 2)
        for (index in 0 until read) {
            val sample = input[index].toInt()
            val byteIndex = index * 2
            output[byteIndex] = (sample and 0xff).toByte()
            output[byteIndex + 1] = ((sample shr 8) and 0xff).toByte()
        }
        return output
    }

    private fun applyInputEffects(audioSessionId: Int) {
        if (echoControlMode == EchoControlMode.Off) return

        if (AcousticEchoCanceler.isAvailable()) {
            val effect = AcousticEchoCanceler.create(audioSessionId)
            if (effect != null && runCatching { effect.enabled = true }.isSuccess && effect.enabled) {
                echoCanceler = effect
            } else {
                effect?.release()
                onError("Echo cancel unavailable")
            }
        } else {
            onError("Echo cancel not supported")
        }

        if (echoControlMode == EchoControlMode.Meeting) {
            if (NoiseSuppressor.isAvailable()) {
                val effect = NoiseSuppressor.create(audioSessionId)
                if (effect != null && runCatching { effect.enabled = true }.isSuccess && effect.enabled) {
                    noiseSuppressor = effect
                } else {
                    effect?.release()
                    onError("Noise suppression unavailable")
                }
            } else {
                onError("Noise suppression not supported")
            }
        }
    }

    private fun calculateLevel(buffer: ShortArray, read: Int): Float {
        var sum = 0.0
        for (index in 0 until read) {
            val normalized = buffer[index] / Short.MAX_VALUE.toDouble()
            sum += normalized * normalized
        }
        return sqrt(sum / read).toFloat().coerceIn(0f, 1f)
    }
}
