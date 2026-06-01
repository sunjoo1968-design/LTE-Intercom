package com.lteintercom.app.model

data class IntercomPanelState(
    val roomName: String,
    val displayName: String,
    val connectionState: ConnectionState,
    val networkQuality: NetworkQuality,
    val headsetState: HeadsetState,
    val masterMuted: Boolean,
    val inputMeter: AudioMeter,
    val outputMeter: AudioMeter,
    val channels: List<ChannelState>,
) {
    companion object {
        fun sample(): IntercomPanelState =
            IntercomPanelState(
                roomName = "PROD-A",
                displayName = "CAM-1",
                connectionState = ConnectionState.Connected(rttMs = 42),
                networkQuality = NetworkQuality(rttMs = 42, packetLossPercent = 1.2f, jitterMs = 8),
                headsetState = HeadsetState.Wired,
                masterMuted = false,
                inputMeter = AudioMeter(peak = 0.74f, rms = 0.46f),
                outputMeter = AudioMeter(peak = 0.68f, rms = 0.41f),
                channels = listOf(
                    ChannelState(
                        id = "ch-program",
                        label = "PROGRAM",
                        shortLabel = "CH01",
                        talkState = TalkState.Idle,
                        listenState = ListenState.On(level = 0.72f),
                        callState = CallState.Idle,
                        meter = AudioMeter(peak = 0.82f, rms = 0.52f),
                        enabled = true,
                        latchAllowed = true,
                    ),
                    ChannelState(
                        id = "ch-director",
                        label = "DIRECTOR",
                        shortLabel = "CH02",
                        talkState = TalkState.Momentary,
                        listenState = ListenState.On(level = 0.78f),
                        callState = CallState.Incoming(fromDisplayName = "PD"),
                        meter = AudioMeter(peak = 0.62f, rms = 0.39f),
                        enabled = true,
                        latchAllowed = true,
                    ),
                    ChannelState(
                        id = "ch-camera",
                        label = "CAMERA",
                        shortLabel = "CH03",
                        talkState = TalkState.Idle,
                        listenState = ListenState.Off,
                        callState = CallState.Idle,
                        meter = AudioMeter.Silent,
                        enabled = true,
                        latchAllowed = false,
                    ),
                ),
            )
    }
}

data class ChannelState(
    val id: String,
    val label: String,
    val shortLabel: String,
    val talkState: TalkState,
    val listenState: ListenState,
    val callState: CallState,
    val meter: AudioMeter,
    val enabled: Boolean,
    val latchAllowed: Boolean,
)

sealed interface TalkState {
    data object Idle : TalkState
    data object Momentary : TalkState
    data object Latched : TalkState
    data object Disabled : TalkState
}

sealed interface ListenState {
    data object Off : ListenState
    data class On(val level: Float) : ListenState
}

sealed interface CallState {
    data object Idle : CallState
    data class Incoming(val fromDisplayName: String) : CallState
    data object Outgoing : CallState
    data object Acknowledged : CallState
}

sealed interface ConnectionState {
    data object Disconnected : ConnectionState
    data object Connecting : ConnectionState
    data class Connected(val rttMs: Int) : ConnectionState
    data class Reconnecting(val attempt: Int) : ConnectionState
    data class Failed(val reason: String) : ConnectionState
}

sealed interface HeadsetState {
    data object None : HeadsetState
    data object Wired : HeadsetState
    data object Usb : HeadsetState
    data object BluetoothSco : HeadsetState
}

data class NetworkQuality(
    val rttMs: Int?,
    val packetLossPercent: Float,
    val jitterMs: Int?,
)

data class AudioMeter(
    val peak: Float,
    val rms: Float,
) {
    companion object {
        val Silent = AudioMeter(peak = 0f, rms = 0f)
    }
}

