package com.lteintercom.app.audio

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import java.util.concurrent.ArrayBlockingQueue

class AudioPlaybackEngine(
    context: Context,
    private val onError: (String) -> Unit,
) {
    private val sampleRate = 16_000
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val appContext = context.applicationContext
    private val queue = ArrayBlockingQueue<ByteArray>(24)
    private var track: AudioTrack? = null
    private var worker: Thread? = null
    @Volatile private var running = false
    @Volatile var playbackGain: Float = 2.4f

    fun playPcm16(frame: ByteArray) {
        start()
        if (!queue.offer(frame.copyOf())) {
            queue.poll()
            queue.offer(frame.copyOf())
        }
    }

    fun stop() {
        running = false
        worker?.interrupt()
        worker = null
        queue.clear()
        track?.let { audioTrack ->
            runCatching { audioTrack.stop() }
            audioTrack.release()
        }
        track = null
        releaseCommunicationRoute()
        audioManager.mode = AudioManager.MODE_NORMAL
    }

    private fun start() {
        if (running) return
        running = true
        configureCommunicationRoute()
        worker = Thread({
            while (running) {
                val frame = runCatching { queue.take() }.getOrNull() ?: continue
                val audioTrack = ensureTrack() ?: continue
                val written = audioTrack.write(applyPlaybackGain(frame), 0, frame.size)
                if (written < 0) {
                    onError("Speaker write failed")
                }
            }
        }, "LTEIntercomPlayback").apply {
            isDaemon = true
            start()
        }
    }

    private fun ensureTrack(): AudioTrack? {
        track?.let { return it }

        val minBuffer = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) {
            onError("Speaker unavailable")
            return null
        }

        val audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
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
            .setBufferSizeInBytes(minBuffer * 4)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        if (audioTrack.state != AudioTrack.STATE_INITIALIZED) {
            audioTrack.release()
            onError("Speaker init failed")
            return null
        }

        audioTrack.play()
        audioTrack.setVolume(1.0f)
        track = audioTrack
        return audioTrack
    }

    private fun configureCommunicationRoute() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (selectBluetoothRoute()) {
            audioManager.isSpeakerphoneOn = false
        } else {
            audioManager.isSpeakerphoneOn = true
        }
    }

    private fun releaseCommunicationRoute() {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice()
            } else {
                audioManager.isBluetoothScoOn = false
                audioManager.stopBluetoothSco()
            }
        }
        audioManager.isSpeakerphoneOn = false
    }

    private fun selectBluetoothRoute(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (appContext.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                return false
            }
            val device = audioManager.availableCommunicationDevices.firstOrNull { item ->
                item.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    item.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                    item.type == AudioDeviceInfo.TYPE_BLE_SPEAKER
            }
            return device != null && audioManager.setCommunicationDevice(device)
        }

        return if (audioManager.isBluetoothScoAvailableOffCall) {
            audioManager.startBluetoothSco()
            audioManager.isBluetoothScoOn = true
            true
        } else {
            false
        }
    }

    private fun applyPlaybackGain(input: ByteArray): ByteArray {
        val output = ByteArray(input.size)
        val gain = playbackGain.coerceIn(0.6f, 4.0f)
        var index = 0
        while (index + 1 < input.size) {
            val sample = (input[index].toInt() and 0xff) or (input[index + 1].toInt() shl 8)
            val amplified = (sample.toShort() * gain)
                .toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                .toShort()
                .toInt()
            output[index] = (amplified and 0xff).toByte()
            output[index + 1] = ((amplified shr 8) and 0xff).toByte()
            index += 2
        }
        return output
    }
}
