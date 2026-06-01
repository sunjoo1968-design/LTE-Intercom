package com.lteintercom.app.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import com.lteintercom.app.model.CallState
import com.lteintercom.app.model.ChannelState
import com.lteintercom.app.model.ConnectionState
import com.lteintercom.app.model.HeadsetState
import com.lteintercom.app.model.IntercomPanelState
import com.lteintercom.app.model.ListenState
import com.lteintercom.app.model.TalkState
import com.lteintercom.app.model.AudioMeter
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

class IntercomPanelView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    interface Listener {
        fun onTalk(channelId: String, active: Boolean)
        fun onListen(channelId: String, active: Boolean)
        fun onCall(channelId: String)
    }

    var listener: Listener? = null

    private var panelState = IntercomPanelState.sample().copy(
        channels = fallbackChannels(),
    )

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = android.graphics.Typeface.create("sans-serif-condensed", android.graphics.Typeface.BOLD)
    }
    private val channelHitAreas = mutableListOf<ChannelHitArea>()
    private var activeTalkChannel: Int? = null
    private var lastTouchY = 0f
    private var scrollYPosition = 0f
    private var maxScrollY = 0f
    private var touchMoved = false
    private var lastTalkTapAtMs = 0L
    private var lastTalkTapChannel: Int? = null
    private var swipeStartX = 0f
    private var swipeStartY = 0f
    private var compactMode = false
    private var modeSwitching = false
    private var compactTalkRect = RectF()
    private val latchedChannelIds = mutableSetOf<String>()
    private val localChannelIds = mutableSetOf<String>()

    private val bg = Color.rgb(10, 13, 16)
    private val panel = Color.rgb(23, 28, 33)
    private val panel2 = Color.rgb(30, 36, 42)
    private val stroke = Color.rgb(70, 82, 93)
    private val text = Color.rgb(236, 240, 243)
    private val subText = Color.rgb(150, 161, 171)
    private val red = Color.rgb(225, 43, 46)
    private val redDark = Color.rgb(91, 22, 25)
    private val green = Color.rgb(29, 196, 105)
    private val greenDark = Color.rgb(19, 75, 48)
    private val amber = Color.rgb(246, 184, 48)
    private val blue = Color.rgb(68, 154, 255)
    private var connectionLabel = "OFFLINE"
    private var inputLevel = 0f

    init {
        isFocusable = true
        setBackgroundColor(bg)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        channelHitAreas.clear()

        val w = width.toFloat()
        val h = height.toFloat()
        val pad = dp(14f)
        canvas.drawColor(bg)

        if (compactMode) {
            drawCompactPanel(canvas, w, h, pad)
            postInvalidateDelayed(350L)
            return
        }

        val headerHeight = dp(112f)
        drawHeader(canvas, RectF(0f, 0f, w, headerHeight), pad)

        val footerHeight = dp(32f)
        val localPairs = localChannelPairs()
        val remotePairs = remoteChannelPairs(localPairs.map { it.first }.toSet())
        val localHeight = if (localPairs.isNotEmpty()) min(dp(210f), h * 0.34f) else 0f
        val localTop = h - footerHeight - localHeight - dp(8f)
        val remoteTop = headerHeight + dp(22f)
        val remoteBottom = if (localHeight > 0f) localTop - dp(10f) else h - footerHeight - dp(8f)
        val columns = if (w > h && w > dp(720f)) 3 else if (w > dp(680f)) 2 else 1
        val gap = dp(10f)
        val rows = (remotePairs.size + columns - 1) / columns
        val cardW = (w - pad * 2 - gap * (columns - 1)) / columns
        val cardH = dp(76f)
        val contentHeight = rows * cardH + max(0, rows - 1) * gap
        val viewportHeight = max(0f, remoteBottom - remoteTop)
        maxScrollY = max(0f, contentHeight - viewportHeight)
        scrollYPosition = scrollYPosition.coerceIn(0f, maxScrollY)

        drawText(canvas, "PARTICIPANTS", pad + dp(4f), headerHeight + dp(14f), 12f, subText, Paint.Align.LEFT)
        canvas.save()
        canvas.clipRect(0f, remoteTop, w, remoteBottom)
        canvas.translate(0f, -scrollYPosition)
        remotePairs.forEachIndexed { drawIndex, pair ->
            val index = pair.first
            val channel = pair.second
            val col = drawIndex % columns
            val row = drawIndex / columns
            val left = pad + col * (cardW + gap)
            val top = remoteTop + row * (cardH + gap)
            val fullRect = RectF(left, top, left + cardW, top + cardH)
            drawRemoteParticipant(canvas, fullRect, channel)
        }
        canvas.restore()

        if (maxScrollY > 0f) {
            drawScrollIndicator(canvas, RectF(w - dp(8f), remoteTop, w - dp(4f), remoteBottom))
        }

        if (localPairs.isNotEmpty()) {
            drawText(canvas, "MY TALK", pad + dp(4f), localTop - dp(7f), 12f, subText, Paint.Align.LEFT)
            val pair = localPairs.first()
            drawChannel(canvas, RectF(pad, localTop, w - pad, localTop + localHeight), pair.first, pair.second, scrolls = false)
        }

        drawFooter(canvas, RectF(0f, h - footerHeight, w, h))
        postInvalidateDelayed(350L)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val hit = channelHitAreas.firstOrNull { hitArea ->
            val y = if (hitArea.scrolls) event.y + scrollYPosition else event.y
            hitArea.rect.contains(event.x, y)
        }
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                swipeStartX = event.x
                swipeStartY = event.y
                lastTouchY = event.y
                touchMoved = false
                if (compactMode && compactTalkRect.contains(event.x, event.y)) {
                    val index = localChannelPairs().firstOrNull()?.first ?: 0
                    activeTalkChannel = index
                    val channel = panelState.channels.getOrNull(index)
                    if (channel != null && channel.talkState !is TalkState.Latched) {
                        setTalkState(index, TalkState.Momentary)
                        listener?.onTalk(channelId(index), true)
                    }
                    parent?.requestDisallowInterceptTouchEvent(true)
                    return true
                }
                if (hit != null && hit.type == HitType.Talk) {
                    activeTalkChannel = hit.index
                    val channel = panelState.channels[hit.index]
                    if (channel.talkState !is TalkState.Latched) {
                        setTalkState(hit.index, TalkState.Momentary)
                        listener?.onTalk(channelId(hit.index), true)
                    }
                    parent?.requestDisallowInterceptTouchEvent(true)
                    return true
                }
                if (hit != null && hit.type == HitType.Listen) {
                    val active = toggleListen(hit.index)
                    listener?.onListen(channelId(hit.index), active)
                    return true
                }
                if (hit != null && hit.type == HitType.Call) {
                    setCallState(hit.index)
                    listener?.onCall(channelId(hit.index))
                    return true
                }
            }

            MotionEvent.ACTION_MOVE -> {
                val deltaY = lastTouchY - event.y
                if (kotlin.math.abs(deltaY) > dp(4f)) {
                    touchMoved = true
                    if (activeTalkChannel == null) {
                        scrollYPosition = (scrollYPosition + deltaY).coerceIn(0f, maxScrollY)
                        invalidate()
                    }
                }
                lastTouchY = event.y
                return true
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val index = activeTalkChannel
                if (index != null) {
                    finishTalk(index, event.actionMasked)
                    activeTalkChannel = null
                    return true
                }
                val deltaX = event.x - swipeStartX
                val deltaY = event.y - swipeStartY
                if (event.actionMasked == MotionEvent.ACTION_UP && abs(deltaX) > dp(70f) && abs(deltaX) > abs(deltaY) * 1.4f) {
                    animateModeSwitch(deltaX)
                    return true
                }
            }
        }
        return true
    }

    private fun animateModeSwitch(deltaX: Float) {
        if (modeSwitching || width <= 0) return
        modeSwitching = true
        val direction = if (deltaX < 0f) -1f else 1f
        animate()
            .translationX(direction * width * 0.22f)
            .alpha(0.82f)
            .setDuration(90L)
            .withEndAction {
                compactMode = !compactMode
                scrollYPosition = 0f
                translationX = -direction * width * 0.22f
                alpha = 0.82f
                invalidate()
                animate()
                    .translationX(0f)
                    .alpha(1f)
                    .setDuration(130L)
                    .withEndAction { modeSwitching = false }
                    .start()
            }
            .start()
    }

    private fun finishTalk(index: Int, actionMasked: Int) {
        val channel = panelState.channels.getOrNull(index) ?: return
        val now = SystemClock.uptimeMillis()
        val isDoubleTap = lastTalkTapChannel == index && now - lastTalkTapAtMs <= 450L
        if (isDoubleTap && channel.latchAllowed) {
            val nextState = if (channel.talkState is TalkState.Latched) TalkState.Idle else TalkState.Latched
            setTalkState(index, nextState)
            listener?.onTalk(channelId(index), nextState is TalkState.Latched)
            lastTalkTapAtMs = 0L
            lastTalkTapChannel = null
        } else {
            if (channel.talkState !is TalkState.Latched) {
                setTalkState(index, TalkState.Idle)
                listener?.onTalk(channelId(index), false)
            }
            lastTalkTapAtMs = now
            lastTalkTapChannel = index
        }
        if (actionMasked == MotionEvent.ACTION_CANCEL && channel.talkState !is TalkState.Latched) {
            setTalkState(index, TalkState.Idle)
            listener?.onTalk(channelId(index), false)
        }
    }

    private fun drawCompactPanel(canvas: Canvas, w: Float, h: Float, pad: Float) {
        drawText(canvas, panelState.displayName, w / 2f, dp(66f), 30f, text, Paint.Align.CENTER)
        drawText(canvas, panelState.roomName + "  /  " + connectionLabel, w / 2f, dp(92f), 13f, subText, Paint.Align.CENTER)
        drawText(canvas, "Swipe for detailed view", w - pad, dp(32f), 11f, subText, Paint.Align.RIGHT)

        val local = localChannelPairs().firstOrNull()?.second
        val remote = remoteChannelPairs(localChannelPairs().map { it.first }.toSet())
        val centerX = w / 2f
        val centerY = h * 0.48f
        val ringRadius = min(w * 0.39f, h * 0.24f)
        val ring = RectF(centerX - ringRadius, centerY - ringRadius, centerX + ringRadius, centerY + ringRadius)

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(10f)
        paint.strokeCap = Paint.Cap.ROUND
        paint.color = Color.rgb(210, 218, 224)
        canvas.drawArc(ring, 203f, 134f, false, paint)
        canvas.drawArc(ring, 23f, 134f, false, paint)

        val talkers = remote.filter { it.second.talkState !is TalkState.Idle }.take(6)
        val listeners = remote.filter { it.second.listenState is ListenState.On }.take(6)
        drawCompactSegments(canvas, ring, talkers.ifEmpty { remote.take(6) }, 205f, 130f, true)
        drawCompactSegments(canvas, ring, listeners.ifEmpty { remote.take(6) }, 25f, 130f, false)
        paint.style = Paint.Style.FILL
        paint.strokeCap = Paint.Cap.BUTT

        drawText(canvas, "TALK", centerX, centerY - ringRadius - dp(14f), 13f, text, Paint.Align.CENTER)
        drawText(canvas, "LISTEN", centerX, centerY + ringRadius + dp(28f), 13f, text, Paint.Align.CENTER)

        val talkRadius = min(w * 0.25f, dp(118f))
        compactTalkRect = RectF(centerX - talkRadius, centerY - talkRadius, centerX + talkRadius, centerY + talkRadius)
        val active = local?.talkState?.let { it !is TalkState.Idle } ?: false
        paint.color = if (active) red else Color.rgb(247, 235, 106)
        canvas.drawOval(compactTalkRect, paint)
        drawText(canvas, if (active) "TALKING" else "Press to", centerX, centerY - dp(24f), 17f, if (active) Color.WHITE else Color.BLACK, Paint.Align.CENTER)
        drawText(canvas, "TALK", centerX, centerY + dp(18f), 39f, if (active) Color.WHITE else Color.BLACK, Paint.Align.CENTER)
        drawText(canvas, "double tap latch", centerX, centerY + dp(43f), 13f, if (active) Color.WHITE else Color.BLACK, Paint.Align.CENTER)

        val talkCount = remote.count { it.second.talkState !is TalkState.Idle }
        val listenCount = remote.count { it.second.listenState is ListenState.On }
        drawCompactCounter(canvas, RectF(pad, h - dp(126f), pad + dp(116f), h - dp(76f)), "TALKERS", talkCount, red)
        drawCompactCounter(canvas, RectF(w - pad - dp(116f), h - dp(126f), w - pad, h - dp(76f)), "LISTENERS", listenCount, green)
        drawText(canvas, java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date()), centerX, h - dp(82f), 30f, text, Paint.Align.CENTER)
    }

    private fun drawCompactSegments(canvas: Canvas, ring: RectF, pairs: List<Pair<Int, ChannelState>>, start: Float, sweep: Float, talkBand: Boolean) {
        if (pairs.isEmpty()) return
        val segmentSweep = min(22f, sweep / pairs.size - 4f)
        val gap = if (pairs.size <= 1) 0f else (sweep - segmentSweep * pairs.size) / (pairs.size - 1)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(30f)
        paint.strokeCap = Paint.Cap.BUTT
        pairs.forEachIndexed { index, pair ->
            val channel = pair.second
            val active = channel.talkState !is TalkState.Idle
            paint.color = when {
                talkBand && active -> red
                talkBand -> green
                channel.listenState is ListenState.On -> blue
                else -> Color.rgb(36, 42, 48)
            }
            val angle = start + index * (segmentSweep + gap)
            canvas.drawArc(ring, angle, segmentSweep, false, paint)

            val midAngle = Math.toRadians((angle + segmentSweep / 2f).toDouble())
            val labelRadius = ring.width() * 0.5f
            val labelX = ring.centerX() + cos(midAngle).toFloat() * labelRadius
            val labelY = ring.centerY() + sin(midAngle).toFloat() * labelRadius + dp(5f)
            drawText(
                canvas,
                channel.shortLabel,
                labelX,
                labelY,
                10f,
                if (talkBand && active) Color.WHITE else text,
                Paint.Align.CENTER,
            )
        }
        paint.style = Paint.Style.FILL
    }

    private fun drawCompactCounter(canvas: Canvas, rect: RectF, label: String, value: Int, color: Int) {
        fillRound(canvas, rect, dp(25f), Color.rgb(18, 23, 28))
        strokeRound(canvas, rect, dp(25f), color, dp(1.2f))
        drawText(canvas, value.toString(), rect.centerX(), rect.top + dp(28f), 22f, color, Paint.Align.CENTER)
        drawText(canvas, label, rect.centerX(), rect.top + dp(43f), 10f, subText, Paint.Align.CENTER)
    }

    private fun drawHeader(canvas: Canvas, rect: RectF, pad: Float) {
        fillRound(canvas, RectF(pad, dp(10f), rect.right - pad, rect.bottom), dp(8f), panel)
        drawText(canvas, "LTE INTERCOM", pad + dp(16f), dp(36f), 15f, subText, Paint.Align.LEFT)
        drawText(canvas, panelState.roomName, pad + dp(16f), dp(69f), 28f, text, Paint.Align.LEFT)
        drawText(canvas, panelState.displayName, rect.right - pad - dp(16f), dp(69f), 24f, blue, Paint.Align.RIGHT)

        val statusTop = dp(82f)
        drawStatusPill(canvas, RectF(pad + dp(16f), statusTop, pad + dp(150f), statusTop + dp(24f)), connectionLabel, if (connectionLabel.startsWith("CONNECTED")) green else amber)
        drawStatusPill(canvas, RectF(pad + dp(158f), statusTop, pad + dp(274f), statusTop + dp(24f)), "LTE 42ms", green)
        drawStatusPill(canvas, RectF(pad + dp(282f), statusTop, pad + dp(414f), statusTop + dp(24f)), headsetLabel(panelState.headsetState), green)

        val meterLeft = max(pad + dp(396f), rect.right - pad - dp(260f))
        if (meterLeft < rect.right - pad - dp(24f)) {
            drawMeter(canvas, RectF(meterLeft, statusTop + dp(3f), rect.right - pad - dp(24f), statusTop + dp(21f)), inputLevel, blue)
        }
    }

    private fun drawChannel(canvas: Canvas, rect: RectF, index: Int, channel: ChannelState, scrolls: Boolean = true) {
        val enabled = channel.enabled
        fillRound(canvas, rect, dp(8f), if (enabled) panel else Color.rgb(18, 21, 24))
        strokeRound(canvas, rect, dp(8f), if (enabled) stroke else Color.rgb(45, 49, 53), dp(1.2f))

        val left = rect.left + dp(12f)
        val right = rect.right - dp(12f)
        val top = rect.top + dp(12f)

        drawLamp(canvas, RectF(left, top, left + dp(18f), top + dp(18f)), talkColor(channel.talkState), channel.talkState !is TalkState.Idle)
        drawText(canvas, channel.shortLabel, left + dp(26f), top + dp(15f), 13f, subText, Paint.Align.LEFT)
        drawText(canvas, channel.label, left, top + dp(43f), 25f, if (enabled) text else subText, Paint.Align.LEFT)

        val meterRect = RectF(left, top + dp(53f), right, top + dp(68f))
        val pulse = ((SystemClock.uptimeMillis() / 350L + index) % 4) * 0.05f
        drawMeter(canvas, meterRect, min(1f, channel.meter.peak + pulse), if (enabled) green else stroke)

        val listenRect = RectF(left, top + dp(78f), left + (right - left) * 0.45f, top + dp(112f))
        val callRect = RectF(right - dp(76f), top + dp(78f), right, top + dp(112f))
        val talkRect = RectF(left, top + dp(121f), right, rect.bottom - dp(10f))
        val isLocalChannel = channel.id in localChannelIds || localChannelIds.isEmpty()

        drawButton(
            canvas,
            listenRect,
            listenLabel(channel.listenState),
            if (channel.listenState is ListenState.On) greenDark else panel2,
            if (channel.listenState is ListenState.On) green else subText,
        )
        drawLevel(canvas, RectF(listenRect.right + dp(8f), top + dp(89f), callRect.left - dp(8f), top + dp(101f)), channel.listenState)
        drawButton(
            canvas,
            callRect,
            "CALL",
            if (channel.callState is CallState.Incoming) amber else panel2,
            if (channel.callState is CallState.Incoming) Color.BLACK else amber,
        )
        if (isLocalChannel) {
            drawButton(
                canvas,
                talkRect,
                talkLabel(channel.talkState),
                when (channel.talkState) {
                    TalkState.Disabled -> Color.rgb(37, 40, 43)
                    TalkState.Idle -> redDark
                    else -> red
                },
                if (channel.talkState == TalkState.Disabled) subText else Color.WHITE,
            )
        } else {
            drawRemoteTalkState(canvas, talkRect, channel.talkState)
        }

        channelHitAreas += ChannelHitArea(index, HitType.Listen, listenRect, scrolls)
        channelHitAreas += ChannelHitArea(index, HitType.Call, callRect, scrolls)
        if (isLocalChannel) {
            channelHitAreas += ChannelHitArea(index, HitType.Talk, talkRect, scrolls)
        }
    }

    private fun drawRemoteParticipant(canvas: Canvas, rect: RectF, channel: ChannelState) {
        val active = channel.talkState !is TalkState.Idle
        fillRound(canvas, rect, dp(8f), if (active) Color.rgb(42, 24, 27) else panel)
        strokeRound(canvas, rect, dp(8f), if (active) red else stroke, dp(if (active) 1.8f else 1.0f))

        val left = rect.left + dp(10f)
        val right = rect.right - dp(10f)
        val centerY = rect.centerY()
        drawLamp(canvas, RectF(left, centerY - dp(9f), left + dp(18f), centerY + dp(9f)), talkColor(channel.talkState), active)
        drawText(canvas, channel.label, left + dp(27f), centerY - dp(3f), 17f, if (active) Color.WHITE else text, Paint.Align.LEFT)
        drawText(canvas, if (active) "TALKING" else "LISTENING", right, centerY - dp(4f), 11f, if (active) red else subText, Paint.Align.RIGHT)
        drawMeter(canvas, RectF(left + dp(27f), centerY + dp(10f), right, centerY + dp(20f)), channel.meter.peak, if (active) red else green)
    }

    private fun drawFooter(canvas: Canvas, rect: RectF) {
        paint.color = Color.rgb(8, 10, 12)
        canvas.drawRect(rect, paint)
        drawText(canvas, "PTT: hold to talk  |  double tap: latch on/off", rect.centerX(), rect.top + dp(25f), 13f, subText, Paint.Align.CENTER)
    }

    private fun drawScrollIndicator(canvas: Canvas, track: RectF) {
        fillRound(canvas, track, dp(2f), Color.rgb(35, 40, 46))
        val ratio = height / (height + maxScrollY)
        val thumbHeight = max(dp(32f), track.height() * ratio)
        val travel = track.height() - thumbHeight
        val thumbTop = track.top + if (maxScrollY > 0f) travel * (scrollYPosition / maxScrollY) else 0f
        fillRound(canvas, RectF(track.left, thumbTop, track.right, thumbTop + thumbHeight), dp(2f), Color.rgb(130, 145, 158))
    }

    private fun drawButton(canvas: Canvas, rect: RectF, label: String, bgColor: Int, fgColor: Int) {
        fillRound(canvas, rect, dp(7f), bgColor)
        strokeRound(canvas, rect, dp(7f), Color.argb(160, 255, 255, 255), dp(0.8f))
        val textSize = if (rect.height() > dp(48f)) 19f else 15f
        drawText(canvas, label, rect.centerX(), rect.centerY() + dp(6f), textSize, fgColor, Paint.Align.CENTER)
    }

    private fun drawRemoteTalkState(canvas: Canvas, rect: RectF, state: TalkState) {
        val active = state !is TalkState.Idle
        fillRound(canvas, rect, dp(7f), if (active) Color.rgb(58, 23, 25) else Color.rgb(26, 31, 36))
        val label = if (active) "REMOTE TALKING" else "REMOTE"
        drawText(canvas, label, rect.centerX(), rect.centerY() + dp(6f), 16f, if (active) red else subText, Paint.Align.CENTER)
    }

    private fun drawLevel(canvas: Canvas, rect: RectF, listenState: ListenState) {
        fillRound(canvas, rect, dp(4f), Color.rgb(46, 53, 60))
        val level = if (listenState is ListenState.On) listenState.level.coerceIn(0f, 1f) else 0f
        fillRound(canvas, RectF(rect.left, rect.top, rect.left + rect.width() * level, rect.bottom), dp(4f), green)
    }

    private fun drawMeter(canvas: Canvas, rect: RectF, level: Float, color: Int) {
        val bars = 12
        val gap = dp(2f)
        val barW = (rect.width() - gap * (bars - 1)) / bars
        for (i in 0 until bars) {
            val active = i < (level.coerceIn(0f, 1f) * bars).toInt()
            paint.color = if (active) color else Color.rgb(39, 45, 51)
            val x = rect.left + i * (barW + gap)
            val barTop = rect.bottom - rect.height() * ((i + 4f) / (bars + 4f))
            canvas.drawRoundRect(RectF(x, barTop, x + barW, rect.bottom), dp(2f), dp(2f), paint)
        }
    }

    private fun drawLamp(canvas: Canvas, rect: RectF, color: Int, active: Boolean) {
        paint.color = if (active) color else Color.rgb(48, 54, 60)
        canvas.drawOval(rect, paint)
        if (active) {
            paint.color = Color.argb(70, Color.red(color), Color.green(color), Color.blue(color))
            canvas.drawOval(RectF(rect.left - dp(5f), rect.top - dp(5f), rect.right + dp(5f), rect.bottom + dp(5f)), paint)
        }
    }

    private fun drawStatusPill(canvas: Canvas, rect: RectF, label: String, accent: Int) {
        fillRound(canvas, rect, dp(12f), Color.rgb(35, 42, 49))
        drawLamp(canvas, RectF(rect.left + dp(7f), rect.top + dp(7f), rect.left + dp(17f), rect.top + dp(17f)), accent, true)
        drawText(canvas, label, rect.left + dp(24f), rect.top + dp(17f), 12f, text, Paint.Align.LEFT)
    }

    private fun fillRound(canvas: Canvas, rect: RectF, radius: Float, color: Int) {
        paint.style = Paint.Style.FILL
        paint.color = color
        canvas.drawRoundRect(rect, radius, radius, paint)
    }

    private fun strokeRound(canvas: Canvas, rect: RectF, radius: Float, color: Int, strokeWidth: Float) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = strokeWidth
        paint.color = color
        canvas.drawRoundRect(rect, radius, radius, paint)
        paint.style = Paint.Style.FILL
    }

    private fun drawText(canvas: Canvas, value: String, x: Float, y: Float, sp: Float, color: Int, align: Paint.Align) {
        textPaint.textSize = sp(sp)
        textPaint.color = color
        textPaint.textAlign = align
        canvas.drawText(value, x, y, textPaint)
    }

    private fun setTalkState(index: Int, state: TalkState) {
        val id = channelId(index)
        when (state) {
            TalkState.Latched -> latchedChannelIds += id
            TalkState.Idle, TalkState.Disabled -> latchedChannelIds -= id
            TalkState.Momentary -> Unit
        }
        panelState = panelState.copy(
            channels = panelState.channels.mapIndexed { channelIndex, channel ->
                if (channelIndex == index && channel.enabled) channel.copy(talkState = state) else channel
            },
        )
        invalidate()
    }

    fun setPanelIdentity(roomName: String, displayName: String) {
        panelState = panelState.copy(
            roomName = roomName.ifBlank { panelState.roomName },
            displayName = displayName.ifBlank { panelState.displayName },
        )
        invalidate()
    }

    fun setConnectionLabel(label: String) {
        connectionLabel = label.take(18)
        invalidate()
    }

    fun setInputLevel(level: Float) {
        inputLevel = level.coerceIn(0f, 1f)
        invalidate()
    }

    fun setParticipants(participants: List<ParticipantCard>) {
        val previousCallStates = panelState.channels.associate { channel -> channel.id to channel.callState }
        val nextChannels = if (participants.isEmpty()) {
            latchedChannelIds.clear()
            localChannelIds.clear()
            fallbackChannels()
        } else {
            val activeIds = participants.map { participant -> participant.id }.toSet()
            latchedChannelIds.retainAll(activeIds)
            localChannelIds.clear()
            localChannelIds += participants.filter { participant -> participant.isLocal }.map { participant -> participant.id }
            participants.mapIndexed { index, participant ->
                val talkState = when {
                    participant.id in latchedChannelIds -> TalkState.Latched
                    participant.talking -> TalkState.Momentary
                    else -> TalkState.Idle
                }
                ChannelState(
                    id = participant.id,
                    label = participant.displayName.uppercase(),
                    shortLabel = "P${(index + 1).toString().padStart(2, '0')}",
                    talkState = talkState,
                    listenState = if (participant.listening) ListenState.On(level = 0.75f) else ListenState.Off,
                    callState = previousCallStates[participant.id] ?: CallState.Idle,
                    meter = if (participant.talking) AudioMeter(peak = 0.86f, rms = 0.55f) else AudioMeter(peak = 0.08f, rms = 0.03f),
                    enabled = !participant.muted,
                    latchAllowed = true,
                )
            }
        }
        panelState = panelState.copy(channels = nextChannels)
        scrollYPosition = 0f
        invalidate()
    }

    fun setIncomingCall(participantId: String) {
        panelState = panelState.copy(
            channels = panelState.channels.map { channel ->
                if (channel.id == participantId && channel.enabled) channel.copy(callState = CallState.Incoming(channel.label)) else channel
            },
        )
        invalidate()
    }

    private fun toggleListen(index: Int): Boolean {
        var active = false
        panelState = panelState.copy(
            channels = panelState.channels.mapIndexed { channelIndex, channel ->
                if (channelIndex == index && channel.enabled) {
                    active = channel.listenState is ListenState.Off
                    channel.copy(
                        listenState = when (val current = channel.listenState) {
                            ListenState.Off -> ListenState.On(0.7f)
                            is ListenState.On -> ListenState.Off
                        },
                    )
                } else {
                    channel
                }
            },
        )
        invalidate()
        return active
    }

    private fun setCallState(index: Int) {
        panelState = panelState.copy(
            channels = panelState.channels.mapIndexed { channelIndex, channel ->
                if (channelIndex == index && channel.enabled) channel.copy(callState = CallState.Outgoing) else channel
            },
        )
        invalidate()
    }

    private fun talkColor(state: TalkState): Int =
        when (state) {
            TalkState.Idle -> redDark
            TalkState.Disabled -> stroke
            else -> red
        }

    private fun talkLabel(state: TalkState): String =
        when (state) {
            TalkState.Idle -> "HOLD TO TALK"
            TalkState.Momentary -> "TALKING"
            TalkState.Latched -> "LATCHED"
            TalkState.Disabled -> "DISABLED"
        }

    private fun listenLabel(state: ListenState): String =
        when (state) {
            ListenState.Off -> "LISTEN OFF"
            is ListenState.On -> "LISTEN ON"
        }

    private fun headsetLabel(state: HeadsetState): String =
        when (state) {
            HeadsetState.None -> "NO HEADSET"
            HeadsetState.Wired -> "WIRED OK"
            HeadsetState.Usb -> "USB OK"
            HeadsetState.BluetoothSco -> "BT SCO"
        }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
    private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
    private fun channelId(index: Int): String = panelState.channels.getOrNull(index)?.id ?: "ch-$index"

    private fun localChannelPairs(): List<Pair<Int, ChannelState>> {
        val channels = panelState.channels
        val local = channels.mapIndexedNotNull { index, channel ->
            if (channel.id in localChannelIds) index to channel else null
        }
        return local.ifEmpty {
            channels.firstOrNull()?.let { channel -> listOf(0 to channel) } ?: emptyList()
        }
    }

    private fun remoteChannelPairs(localIndexes: Set<Int>): List<Pair<Int, ChannelState>> =
        panelState.channels.mapIndexedNotNull { index, channel ->
            if (index !in localIndexes) index to channel else null
        }.sortedWith { first, second ->
            val firstTalking = first.second.talkState !is TalkState.Idle
            val secondTalking = second.second.talkState !is TalkState.Idle
            when {
                firstTalking && !secondTalking -> -1
                !firstTalking && secondTalking -> 1
                else -> first.second.label.compareTo(second.second.label)
            }
        }

    private fun fallbackChannels(): List<ChannelState> =
        IntercomPanelState.sample().channels.take(3) + listOf(
            ChannelState(
                id = "partyline-stage",
                label = "STAGE",
                shortLabel = "CH04",
                talkState = TalkState.Idle,
                listenState = ListenState.On(level = 0.54f),
                callState = CallState.Idle,
                meter = AudioMeter(peak = 0.28f, rms = 0.18f),
                enabled = true,
                latchAllowed = true,
            ),
        )

    data class ParticipantCard(
        val id: String,
        val displayName: String,
        val talking: Boolean,
        val listening: Boolean,
        val muted: Boolean,
        val isLocal: Boolean,
    )

    private data class ChannelHitArea(
        val index: Int,
        val type: HitType,
        val rect: RectF,
        val scrolls: Boolean = true,
    )

    private enum class HitType {
        Talk,
        Listen,
        Call,
    }
}
