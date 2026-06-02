package com.lteintercom.app

import android.Manifest
import android.app.AlertDialog
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.ArrayAdapter
import android.widget.AdapterView
import com.lteintercom.app.audio.AudioLevelMonitor
import com.lteintercom.app.audio.AudioPlaybackEngine
import com.lteintercom.app.audio.TalkBeepPlayer
import com.lteintercom.app.net.IntercomSignalingClient
import com.lteintercom.app.ui.IntercomPanelView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : Activity(), IntercomSignalingClient.Listener {
    private val micPermissionRequest = 1001
    private val bluetoothPermissionRequest = 1002
    private val notificationPermissionRequest = 1003
    private val prefsName = "lte_intercom_setup"

    private lateinit var panelView: IntercomPanelView
    private lateinit var statusView: TextView
    private lateinit var signalingClient: IntercomSignalingClient
    private lateinit var audioLevelMonitor: AudioLevelMonitor
    private lateinit var audioPlaybackEngine: AudioPlaybackEngine
    private lateinit var talkBeepPlayer: TalkBeepPlayer

    private lateinit var ip1Input: EditText
    private lateinit var ip2Input: EditText
    private lateinit var ip3Input: EditText
    private lateinit var ip4Input: EditText
    private lateinit var roomPasswordInput: EditText
    private lateinit var roomSpinner: Spinner
    private lateinit var nameInput: EditText
    private lateinit var setupHintView: TextView

    private var connected = false
    private var sidetoneEnabled = true
    private var echoControlMode = AudioLevelMonitor.EchoControlMode.Meeting
    private var receiveGain = 2.4f
    private var microphoneGain = 1.0f
    private var setupMode = true
    private var localParticipantId: String? = null
    private var exitConfirmed = false
    private var localTalkActive = false
    private var backgroundServiceStarted = false
    @Volatile private var roomLoadInProgress = false
    private var lastIpSegments = listOf("192", "168", "0", "241")
    private val serverPort = "8443"
    private var lastRoomCode = "LIVE"
    private var lastRoomPassword = ""
    private var lastDisplayName = "Your Name"
    private val availableRooms = mutableListOf<RoomOption>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching { initializeApp() }.onFailure { error ->
            setContentView(buildSafeErrorPage(error.message ?: "Startup failed"))
        }
    }

    private fun initializeApp() {
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        window.setFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON, WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        signalingClient = IntercomSignalingClient(this)
        talkBeepPlayer = TalkBeepPlayer()
        panelView = createPanelView()
        audioPlaybackEngine = AudioPlaybackEngine(
            context = applicationContext,
            onError = { message -> runOnUiThread { updateStatus("AUDIO: $message") } },
        )
        audioLevelMonitor = AudioLevelMonitor(
            onLevel = { level -> runOnUiThread { if (::panelView.isInitialized) panelView.setInputLevel(level) } },
            onAudioFrame = { frame -> if (::signalingClient.isInitialized) signalingClient.sendAudioFrame(frame) },
            onError = { message -> runOnUiThread { updateStatus("MIC: $message") } },
        )
        audioLevelMonitor.sidetoneEnabled = sidetoneEnabled

        loadSavedSession()
        audioLevelMonitor.sidetoneEnabled = sidetoneEnabled
        audioLevelMonitor.echoControlMode = echoControlMode
        audioLevelMonitor.microphoneGain = microphoneGain
        audioPlaybackEngine.playbackGain = receiveGain

        if (shouldResumeSavedSession()) {
            reconnectSavedSession()
        } else {
            setContentView(buildConnectPage())
        }
    }

    override fun onDestroy() {
        if (exitConfirmed || !connected) {
            shutdownIntercom()
        }
        if (::talkBeepPlayer.isInitialized) runCatching { talkBeepPlayer.release() }
        super.onDestroy()
    }

    override fun onStop() {
        super.onStop()
        if (connected && !exitConfirmed) {
            saveSession(active = true)
        }
    }

    override fun onBackPressed() {
        showExitDialog()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == micPermissionRequest) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            updateStatus(if (granted) "MIC READY" else "MIC PERMISSION DENIED")
        }
        if (requestCode == bluetoothPermissionRequest) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            updateStatus(if (granted) "BT AUDIO READY" else "BT AUDIO PERMISSION DENIED")
        }
        if (requestCode == notificationPermissionRequest) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            updateStatus(if (granted) "BACKGROUND READY" else "BACKGROUND NOTICE DISABLED")
        }
    }

    override fun onConnecting() {
        runOnUiThread {
            panelView.setConnectionLabel("CONNECTING")
            updateStatus("CONNECTING")
        }
    }

    override fun onConnected(message: String) {
        runOnUiThread {
            if (setupMode) return@runOnUiThread
            connected = true
            startBackgroundService()
            panelView.setConnectionLabel(message)
            updateStatus(message)
            signalingClient.requestSnapshot()
        }
    }

    override fun onDisconnected(message: String) {
        runOnUiThread {
            if (setupMode) return@runOnUiThread
            connected = false
            localParticipantId = null
            audioPlaybackEngine.stop()
            stopBackgroundService()
            panelView.setConnectionLabel(message)
            updateStatus(message)
        }
    }

    override fun onEvent(type: String, message: JSONObject) {
        runOnUiThread {
            if (setupMode) return@runOnUiThread
            when (type) {
                "welcome", "room.snapshot", "participant.joined", "participant.left", "participant.state" -> {
                    if (type == "welcome") {
                        localParticipantId = message.optJSONObject("participant")?.optString("id")
                    }
                    val room = message.optJSONObject("room")
                    if (room != null) {
                        val participantCount = room.optInt("participantCount", 0)
                        panelView.setConnectionLabel("CONNECTED / $participantCount USER")
                        panelView.setParticipants(parseParticipants(room))
                    } else {
                        signalingClient.requestSnapshot()
                    }
                    updateStatus(type.uppercase())
                }

                "call.signal" -> {
                    val fromParticipantId = message.optString("fromParticipantId")
                    if (fromParticipantId.isNotBlank() && fromParticipantId != localParticipantId) {
                        panelView.setIncomingCall(fromParticipantId)
                        playTalkBeep()
                    }
                    updateStatus("CALL SIGNAL")
                }
                else -> updateStatus(type.uppercase())
            }
        }
    }

    override fun onAudioFrame(fromParticipantId: String, pcm16: ByteArray) {
        audioPlaybackEngine.playPcm16(pcm16)
    }

    override fun onWebRtcSignal(fromParticipantId: String, toParticipantId: String?, payload: JSONObject) {
        runOnUiThread {
            updateStatus("WEBRTC ${payload.optString("kind", "SIGNAL").uppercase()}")
        }
    }

    override fun onError(message: String) {
        runOnUiThread {
            if (setupMode) return@runOnUiThread
            connected = false
            localParticipantId = null
            audioPlaybackEngine.stop()
            stopBackgroundService()
            panelView.setConnectionLabel("ERROR")
            setContentView(buildConnectPage("ERROR: $message"))
        }
    }

    private fun buildConnectPage(message: String = "Enter server and room information"): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(10, 13, 16))
            gravity = Gravity.CENTER
            setPadding(34, 34, 34, 34)
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(30, 30, 30, 30)
            setBackgroundColor(Color.rgb(18, 23, 28))
        }

        val title = TextView(this).apply {
            text = "LTE INTERCOM"
            setTextColor(Color.WHITE)
            textSize = 32f
            gravity = Gravity.CENTER
        }
        val subtitle = TextView(this).apply {
            text = "Production Intercom Setup"
            setTextColor(Color.rgb(150, 161, 171))
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, 4, 0, 28)
        }

        val ipRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        ip1Input = ipInput(lastIpSegments.getOrElse(0) { "192" })
        ip2Input = ipInput(lastIpSegments.getOrElse(1) { "168" })
        ip3Input = ipInput(lastIpSegments.getOrElse(2) { "0" })
        ip4Input = ipInput(lastIpSegments.getOrElse(3) { "241" })
        ipRow.addView(ip1Input)
        ipRow.addView(dotText())
        ipRow.addView(ip2Input)
        ipRow.addView(dotText())
        ipRow.addView(ip3Input)
        ipRow.addView(dotText())
        ipRow.addView(ip4Input)

        roomPasswordInput = passwordInput("Room Password", lastRoomPassword)
        nameInput = textInput("Display Name", lastDisplayName)
        val passwordRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val showRoomPasswordButton = Button(this).apply {
            text = "SHOW"
            textSize = 12f
            setSetupButtonStyle(this, true, Color.rgb(68, 75, 86))
            setOnClickListener {
                togglePasswordVisible(roomPasswordInput)
                text = if (roomPasswordInput.inputType and InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD != 0) "HIDE" else "SHOW"
            }
        }
        passwordRow.addView(roomPasswordInput, LinearLayout.LayoutParams(0, 62, 1f).apply {
            setMargins(0, 0, 8, 14)
        })
        passwordRow.addView(showRoomPasswordButton, LinearLayout.LayoutParams(92, 62).apply {
            setMargins(0, 0, 0, 14)
        })

        roomSpinner = Spinner(this).apply {
            setBackgroundColor(Color.rgb(30, 36, 42))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 62).apply {
                setMargins(0, 0, 0, 14)
            }
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                    val room = availableRooms.getOrNull(position) ?: return
                    lastRoomCode = room.code
                    if (::setupHintView.isInitialized) {
                        setupHintView.text = if (room.passwordProtected) {
                            "Room ${room.code} requires the room password."
                        } else {
                            "Room ${room.code} selected."
                        }
                    }
                }

                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            }
        }
        availableRooms.clear()
        applyRoomSpinnerItems(listOf("Load rooms from server"))
        val loadRoomsButton = Button(this).apply {
            text = "LOAD ROOMS"
            textSize = 14f
            setSetupButtonStyle(this, true, Color.rgb(68, 75, 86))
            setOnClickListener { loadRoomsFromServer() }
        }

        val connectButton = Button(this).apply {
            text = "CONNECT"
            textSize = 18f
            setPadding(0, 8, 0, 8)
            setOnClickListener { connectFromInputs() }
        }
        val sidetoneButton = Button(this).apply {
            text = sidetoneLabel()
            textSize = 14f
            setSetupButtonStyle(this, sidetoneEnabled, Color.rgb(19, 115, 69))
            setOnClickListener {
                sidetoneEnabled = !sidetoneEnabled
                audioLevelMonitor.sidetoneEnabled = sidetoneEnabled
                text = sidetoneLabel()
                setSetupButtonStyle(this, sidetoneEnabled, Color.rgb(19, 115, 69))
            }
        }
        val echoButton = Button(this).apply {
            text = echoLabel()
            textSize = 14f
            setSetupButtonStyle(this, echoControlMode != AudioLevelMonitor.EchoControlMode.Off, Color.rgb(28, 86, 158))
            setOnClickListener {
                echoControlMode = when (echoControlMode) {
                    AudioLevelMonitor.EchoControlMode.Off -> AudioLevelMonitor.EchoControlMode.EchoCancel
                    AudioLevelMonitor.EchoControlMode.EchoCancel -> AudioLevelMonitor.EchoControlMode.Meeting
                    AudioLevelMonitor.EchoControlMode.Meeting -> AudioLevelMonitor.EchoControlMode.Off
                }
                audioLevelMonitor.echoControlMode = echoControlMode
                text = echoLabel()
                setSetupButtonStyle(this, echoControlMode != AudioLevelMonitor.EchoControlMode.Off, Color.rgb(28, 86, 158))
            }
        }
        val receiveGainBar = GainBarView(
            context = this,
            label = "RECEIVE GAIN",
            values = listOf(1.0f, 1.6f, 2.4f, 3.2f),
            initialValue = receiveGain,
            activeColor = Color.rgb(35, 193, 107),
        ) { value ->
            receiveGain = value
            audioPlaybackEngine.playbackGain = receiveGain
            saveSession(active = false)
        }
        val microphoneGainBar = GainBarView(
            context = this,
            label = "MIC SENS",
            values = listOf(0.8f, 1.0f, 1.5f, 2.0f, 2.6f),
            initialValue = microphoneGain,
            activeColor = Color.rgb(68, 154, 255),
        ) { value ->
            microphoneGain = value
            audioLevelMonitor.microphoneGain = microphoneGain
            saveSession(active = false)
        }
        setupHintView = TextView(this).apply {
            text = message
            setTextColor(if (message.startsWith("ERROR")) Color.rgb(246, 184, 48) else Color.rgb(150, 161, 171))
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(0, 18, 0, 0)
        }

        card.addView(title)
        card.addView(subtitle)
        card.addView(fieldLabel("SERVER IP"))
        card.addView(ipRow)
        card.addView(fieldLabel("ROOM"))
        card.addView(loadRoomsButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, 0, 0, 10)
        })
        card.addView(roomSpinner)
        card.addView(fieldLabel("ROOM PASSWORD"))
        card.addView(passwordRow)
        card.addView(fieldLabel("NAME"))
        card.addView(nameInput)
        card.addView(nameGuideText())
        card.addView(connectButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, 18, 0, 0)
        })
        card.addView(sidetoneButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, 10, 0, 0)
        })
        card.addView(echoButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, 10, 0, 0)
        })
        card.addView(receiveGainBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 78).apply {
            setMargins(0, 10, 0, 0)
        })
        card.addView(microphoneGainBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 78).apply {
            setMargins(0, 10, 0, 0)
        })
        card.addView(setupHintView)
        val scroll = ScrollView(this).apply {
            isFillViewport = false
            addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))
        return root
    }

    private fun buildSafeErrorPage(message: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(34, 34, 34, 34)
            setBackgroundColor(Color.rgb(10, 13, 16))
            addView(TextView(this@MainActivity).apply {
                text = "LTE INTERCOM"
                textSize = 28f
                gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
            })
            addView(TextView(this@MainActivity).apply {
                text = "Startup recovery mode"
                textSize = 16f
                gravity = Gravity.CENTER
                setTextColor(Color.rgb(246, 184, 48))
                setPadding(0, 12, 0, 8)
            })
            addView(TextView(this@MainActivity).apply {
                text = message
                textSize = 13f
                gravity = Gravity.CENTER
                setTextColor(Color.rgb(150, 161, 171))
            })
            addView(Button(this@MainActivity).apply {
                text = "RETRY"
                setOnClickListener {
                    runCatching { initializeApp() }.onFailure { error ->
                        setContentView(buildSafeErrorPage(error.message ?: "Startup failed"))
                    }
                }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, 24, 0, 0)
            })
        }

    private fun buildPanelPage(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(10, 13, 16))
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(18, 10, 18, 10)
            setBackgroundColor(Color.rgb(15, 19, 23))
        }
        statusView = TextView(this).apply {
            text = "CONNECTING"
            setTextColor(Color.rgb(150, 161, 171))
            textSize = 13f
            gravity = Gravity.CENTER_VERTICAL
        }
        val setupButton = Button(this).apply {
            text = "SETUP"
            setOnClickListener {
                setupMode = true
                connected = false
                localParticipantId = null
                saveSession(active = false)
                shutdownIntercom()
                setContentView(buildConnectPage())
            }
        }

        toolbar.addView(statusView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(setupButton)
        root.addView(toolbar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(panelView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    private fun connectFromInputs() {
        val ip = serverIpFromInputs()
        val selectedRoom = availableRooms.getOrNull(roomSpinner.selectedItemPosition)
        if (selectedRoom == null) {
            setContentView(buildConnectPage("Load and select a room created on the server before connecting."))
            return
        }
        lastRoomCode = selectedRoom.code
        lastRoomPassword = roomPasswordInput.text.toString()
        lastDisplayName = nameInput.text.toString().trim()
        if (!isValidDisplayName(lastDisplayName)) {
            lastDisplayName = "Your Name"
            setContentView(buildConnectPage("Please enter your own name before connecting."))
            return
        }

        saveSession(active = true)
        connectWithSavedSettings(ip)
    }

    private fun connectWithSavedSettings(ip: String = lastIpSegments.joinToString(".")) {
        setupMode = false
        connected = false
        ensureBluetoothAudioPermission()
        ensureNotificationPermission()
        audioLevelMonitor.sidetoneEnabled = sidetoneEnabled
        audioLevelMonitor.echoControlMode = echoControlMode
        audioLevelMonitor.microphoneGain = microphoneGain
        audioPlaybackEngine.playbackGain = receiveGain
        panelView = createPanelView()
        panelView.setPanelIdentity(lastRoomCode, lastDisplayName)
        setContentView(buildPanelPage())
        signalingClient.connect(
            serverBaseUrl = "ws://$ip:$serverPort/signal",
            roomCode = lastRoomCode,
            roomPassword = lastRoomPassword,
            displayName = lastDisplayName,
        )
    }

    private fun reconnectSavedSession() {
        availableRooms.clear()
        availableRooms += RoomOption(lastRoomCode, lastRoomCode, lastRoomPassword.isNotBlank())
        connectWithSavedSettings()
    }

    private fun shouldResumeSavedSession(): Boolean {
        val prefs = getSharedPreferences(prefsName, MODE_PRIVATE)
        return prefs.getBoolean("active", false) &&
            lastRoomCode.isNotBlank() &&
            lastIpSegments.size == 4 &&
            isValidDisplayName(lastDisplayName)
    }

    private fun loadRoomsFromServer() {
        if (roomLoadInProgress) return
        roomLoadInProgress = true
        val ip = serverIpFromInputs()
        val port = serverPort
        if (::setupHintView.isInitialized) setupHintView.text = "Loading rooms from $ip:$port..."
        thread(name = "room-list-loader") {
            try {
                val connection = (URL("http://$ip:$port/public/rooms").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 3500
                    readTimeout = 3500
                    requestMethod = "GET"
                }
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val rooms = JSONObject(body).optJSONArray("rooms")
                val loaded = buildList {
                    if (rooms != null) {
                        for (index in 0 until rooms.length()) {
                            val item = rooms.optJSONObject(index) ?: continue
                            add(
                                RoomOption(
                                    code = item.optString("code", "LIVE"),
                                    description = item.optString("description", item.optString("name", "Live Room")),
                                    passwordProtected = item.optBoolean("passwordProtected", false),
                                ),
                            )
                        }
                    }
                }
                runOnUiThread {
                    roomLoadInProgress = false
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    availableRooms.clear()
                    availableRooms.addAll(loaded)
                    if (loaded.isEmpty()) {
                        applyRoomSpinnerItems(listOf("No admin rooms found"))
                        setupHintView.text = "No rooms were found. Create a room in Admin first."
                    } else {
                        applyRoomSpinnerItems(loaded.map { room ->
                            room.code + " - " + room.description + if (room.passwordProtected) " [PASSWORD]" else ""
                        })
                        val selected = loaded.indexOfFirst { it.code.equals(lastRoomCode, ignoreCase = true) }.coerceAtLeast(0)
                        roomSpinner.setSelection(selected)
                        setupHintView.text = "${loaded.size} room(s) loaded."
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    roomLoadInProgress = false
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    setupHintView.text = "Room load failed: ${error.message ?: "server not reachable"}"
                }
            }
        }
    }

    private fun applyRoomSpinnerItems(items: List<String>) {
        roomSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, items).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
    }

    private fun loadSavedSession() {
        val prefs = getSharedPreferences(prefsName, MODE_PRIVATE)
        lastIpSegments = listOf(
            prefs.getString("ip1", lastIpSegments.getOrElse(0) { "192" }) ?: "192",
            prefs.getString("ip2", lastIpSegments.getOrElse(1) { "168" }) ?: "168",
            prefs.getString("ip3", lastIpSegments.getOrElse(2) { "0" }) ?: "0",
            prefs.getString("ip4", lastIpSegments.getOrElse(3) { "241" }) ?: "241",
        )
        lastRoomCode = prefs.getString("roomCode", lastRoomCode) ?: lastRoomCode
        lastRoomPassword = prefs.getString("roomPassword", lastRoomPassword) ?: lastRoomPassword
        lastDisplayName = prefs.getString("displayName", lastDisplayName) ?: lastDisplayName
        sidetoneEnabled = prefs.getBoolean("sidetone", sidetoneEnabled)
        receiveGain = prefs.getFloat("receiveGain", receiveGain)
        microphoneGain = prefs.getFloat("microphoneGain", microphoneGain)
        echoControlMode = when (prefs.getString("echoControlMode", echoControlMode.name)) {
            AudioLevelMonitor.EchoControlMode.Off.name -> AudioLevelMonitor.EchoControlMode.Off
            AudioLevelMonitor.EchoControlMode.EchoCancel.name -> AudioLevelMonitor.EchoControlMode.EchoCancel
            else -> AudioLevelMonitor.EchoControlMode.Meeting
        }
    }

    private fun saveSession(active: Boolean) {
        getSharedPreferences(prefsName, MODE_PRIVATE).edit()
            .putBoolean("active", active)
            .putString("ip1", lastIpSegments.getOrElse(0) { "192" })
            .putString("ip2", lastIpSegments.getOrElse(1) { "168" })
            .putString("ip3", lastIpSegments.getOrElse(2) { "0" })
            .putString("ip4", lastIpSegments.getOrElse(3) { "241" })
            .putString("roomCode", lastRoomCode)
            .putString("roomPassword", lastRoomPassword)
            .putString("displayName", lastDisplayName)
            .putBoolean("sidetone", sidetoneEnabled)
            .putFloat("receiveGain", receiveGain)
            .putFloat("microphoneGain", microphoneGain)
            .putString("echoControlMode", echoControlMode.name)
            .apply()
    }

    private fun serverIpFromInputs(): String {
        lastIpSegments = listOf(ip1Input, ip2Input, ip3Input, ip4Input).map { input ->
            input.text.toString().ifBlank { "0" }.toIntOrNull()?.coerceIn(0, 255)?.toString() ?: "0"
        }
        return lastIpSegments.joinToString(".")
    }

    private fun createPanelView(): IntercomPanelView =
        IntercomPanelView(this).apply {
            listener = object : IntercomPanelView.Listener {
                override fun onTalk(channelId: String, active: Boolean) {
                    handleTalk(active)
                }

                override fun onListen(channelId: String, active: Boolean) {
                    signalingClient.sendListen(active)
                }

                override fun onCall(channelId: String) {
                    signalingClient.sendCall(channelId)
                }
            }
        }

    private fun textInput(hint: String, value: String): EditText =
        EditText(this).apply {
            setText(value)
            this.hint = hint
            setSelectAllOnFocus(true)
            setSingleLine(true)
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(120, 130, 140))
            setBackgroundColor(Color.rgb(30, 36, 42))
            setPadding(18, 0, 18, 0)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 62).apply {
                setMargins(0, 0, 0, 14)
            }
        }

    private fun passwordInput(hint: String, value: String): EditText =
        textInput(hint, value).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSelectAllOnFocus(false)
        }

    private fun togglePasswordVisible(input: EditText) {
        val cursor = input.selectionStart.coerceAtLeast(0)
        val visible = input.inputType and InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD != 0
        input.inputType = InputType.TYPE_CLASS_TEXT or if (visible) {
            InputType.TYPE_TEXT_VARIATION_PASSWORD
        } else {
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        }
        input.setSelection(cursor.coerceAtMost(input.text.length))
    }

    private fun numericInput(value: String, maxLength: Int): EditText =
        EditText(this).apply {
            setText(value)
            selectAll()
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(maxLength))
            setSingleLine(true)
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(120, 130, 140))
            setBackgroundColor(Color.rgb(30, 36, 42))
            setPadding(18, 0, 18, 0)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 62).apply {
                setMargins(0, 0, 0, 14)
            }
        }

    private fun ipInput(value: String): EditText =
        numericInput(value, 3).apply {
            gravity = Gravity.CENTER
            textSize = 18f
            layoutParams = LinearLayout.LayoutParams(0, 62, 1f).apply {
                setMargins(0, 0, 0, 14)
            }
        }

    private fun dotText(): TextView =
        TextView(this).apply {
            text = "."
            textSize = 24f
            setTextColor(Color.rgb(150, 161, 171))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(20, 62).apply {
                setMargins(2, 0, 2, 14)
            }
        }

    private fun fieldLabel(value: String): TextView =
        TextView(this).apply {
            text = value
            textSize = 12f
            setTextColor(Color.rgb(150, 161, 171))
            setPadding(2, 0, 0, 6)
        }

    private fun nameGuideText(): TextView =
        TextView(this).apply {
            text = "Change 'Your Name' to your own name to enter the room."
            textSize = 12f
            setTextColor(Color.rgb(246, 184, 48))
            setPadding(2, 0, 0, 8)
        }

    private fun handleTalk(active: Boolean) {
        if (active) {
            if (!hasMicPermission()) {
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), micPermissionRequest)
                signalingClient.sendTalk(false)
                updateStatus("MIC PERMISSION REQUIRED")
                return
            }
            if (!localTalkActive) {
                localTalkActive = true
                playTalkBeep()
            }
            audioLevelMonitor.start()
            updateStatus(if (sidetoneEnabled) "TALKING / SIDETONE ON" else "TALKING / MIC ACTIVE")
        } else {
            localTalkActive = false
            audioLevelMonitor.stop()
            updateStatus("LISTENING")
        }
        signalingClient.sendTalk(active)
    }

    private fun hasMicPermission(): Boolean =
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun playTalkBeep() {
        runCatching {
            panelView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            talkBeepPlayer.play()
        }
    }

    private fun ensureBluetoothAudioPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), bluetoothPermissionRequest)
        }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), notificationPermissionRequest)
        }
    }

    private fun startBackgroundService() {
        if (backgroundServiceStarted) return
        val intent = Intent(this, IntercomForegroundService::class.java)
            .putExtra(IntercomForegroundService.EXTRA_ROOM, lastRoomCode)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            backgroundServiceStarted = true
        }.onFailure {
            updateStatus("BACKGROUND SERVICE LIMITED")
        }
    }

    private fun stopBackgroundService() {
        runCatching { stopService(Intent(this, IntercomForegroundService::class.java)) }
        backgroundServiceStarted = false
    }

    private fun showExitDialog() {
        AlertDialog.Builder(this)
            .setTitle("Exit LTE Intercom")
            .setMessage("Disconnect from the current intercom room and close the app?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Exit") { _, _ ->
                exitConfirmed = true
                saveSession(active = false)
                shutdownIntercom()
                finishAndRemoveTask()
            }
            .show()
    }

    private fun shutdownIntercom() {
        if (::audioLevelMonitor.isInitialized) audioLevelMonitor.stop()
        if (::audioPlaybackEngine.isInitialized) audioPlaybackEngine.stop()
        if (::signalingClient.isInitialized) signalingClient.disconnect()
        stopBackgroundService()
        connected = false
        localParticipantId = null
    }

    private fun updateStatus(value: String) {
        if (::statusView.isInitialized) {
            statusView.text = value
        }
    }

    private fun sidetoneLabel(): String =
        if (sidetoneEnabled) "SIDETONE: ON" else "SIDETONE: OFF"

    private fun echoLabel(): String =
        when (echoControlMode) {
            AudioLevelMonitor.EchoControlMode.Off -> "ECHO CONTROL: OFF"
            AudioLevelMonitor.EchoControlMode.EchoCancel -> "ECHO CONTROL: AEC"
            AudioLevelMonitor.EchoControlMode.Meeting -> "ECHO CONTROL: MEETING"
        }

    private fun receiveGainLabel(): String =
        "RECEIVE GAIN  ${gainBars(receiveGain, listOf(1.0f, 1.6f, 2.4f, 3.2f))}"

    private fun microphoneGainLabel(): String =
        "MIC SENS  ${gainBars(microphoneGain, listOf(0.8f, 1.0f, 1.5f, 2.0f, 2.6f))}"

    private fun gainBars(current: Float, values: List<Float>): String {
        val index = values.indexOfFirst { value -> kotlin.math.abs(value - current) < 0.05f }.coerceAtLeast(0)
        return buildString {
            append("[")
            values.forEachIndexed { valueIndex, _ ->
                append(if (valueIndex <= index) "#" else "-")
            }
            append("]")
        }
    }

    private fun nextGain(current: Float, values: List<Float>): Float {
        val index = values.indexOfFirst { value -> kotlin.math.abs(value - current) < 0.05f }
        return values[(index + 1).mod(values.size)]
    }

    private fun isValidDisplayName(value: String): Boolean =
        value.isNotBlank() && !value.equals("Your Name", ignoreCase = true)

    private fun setSetupButtonStyle(button: Button, active: Boolean, activeColor: Int) {
        button.setTextColor(if (active) Color.WHITE else Color.rgb(150, 161, 171))
        button.setBackgroundColor(if (active) activeColor else Color.rgb(30, 36, 42))
    }

    private fun parseParticipants(room: JSONObject): List<IntercomPanelView.ParticipantCard> {
        val participants = room.optJSONArray("participants") ?: return emptyList()
        return buildList {
            for (index in 0 until participants.length()) {
                val item = participants.optJSONObject(index) ?: continue
                add(
                    IntercomPanelView.ParticipantCard(
                        id = item.optString("id", "participant-$index"),
                        displayName = item.optString("displayName", "USER-${index + 1}"),
                        talking = item.optBoolean("talking", false),
                        listening = item.optBoolean("listening", true),
                        muted = item.optBoolean("muted", false),
                        isLocal = item.optString("id") == localParticipantId,
                    ),
                )
            }
        }
    }

    private data class RoomOption(
        val code: String,
        val description: String,
        val passwordProtected: Boolean,
    )
}

private class GainBarView(
    context: Activity,
    private val label: String,
    private val values: List<Float>,
    initialValue: Float,
    private val activeColor: Int,
    private val onChanged: (Float) -> Unit,
) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = android.graphics.Typeface.create("sans-serif-condensed", android.graphics.Typeface.BOLD)
    }
    private var currentIndex = values.indexOfFirst { value -> kotlin.math.abs(value - initialValue) < 0.05f }.coerceAtLeast(0)
    private val barRect = RectF()

    init {
        isClickable = true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val pad = dp(8f)
        val top = dp(27f)
        drawText(canvas, label, pad, dp(17f), 12f, Color.rgb(150, 161, 171), Paint.Align.LEFT)
        drawText(canvas, levelLabel(), width - pad, dp(17f), 12f, Color.WHITE, Paint.Align.RIGHT)

        val gap = dp(5f)
        val count = values.size.coerceAtLeast(1)
        val segmentWidth = (width - pad * 2f - gap * (count - 1)) / count
        for (index in 0 until count) {
            val left = pad + index * (segmentWidth + gap)
            barRect.set(left, top, left + segmentWidth, height - dp(8f))
            paint.style = Paint.Style.FILL
            paint.color = if (index <= currentIndex) activeColor else Color.rgb(30, 36, 42)
            canvas.drawRoundRect(barRect, dp(5f), dp(5f), paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = dp(1f)
            paint.color = Color.rgb(70, 82, 93)
            canvas.drawRoundRect(barRect, dp(5f), dp(5f), paint)
        }
        paint.style = Paint.Style.FILL
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_MOVE) {
            updateFromX(event.x)
            return true
        }
        if (event.actionMasked == MotionEvent.ACTION_UP) {
            performClick()
            updateFromX(event.x)
            return true
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun updateFromX(x: Float) {
        val pad = dp(8f)
        val usable = (width - pad * 2f).coerceAtLeast(1f)
        val index = (((x - pad).coerceIn(0f, usable) / usable) * values.size).toInt().coerceIn(0, values.lastIndex)
        if (index == currentIndex) return
        currentIndex = index
        onChanged(values[currentIndex])
        invalidate()
    }

    private fun levelLabel(): String =
        "LEVEL ${currentIndex + 1}/${values.size}"

    private fun drawText(canvas: Canvas, value: String, x: Float, y: Float, sp: Float, color: Int, align: Paint.Align) {
        textPaint.textSize = sp(sp)
        textPaint.color = color
        textPaint.textAlign = align
        canvas.drawText(value, x, y, textPaint)
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
    private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
}
