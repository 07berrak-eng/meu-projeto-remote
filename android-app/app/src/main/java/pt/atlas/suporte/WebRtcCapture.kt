package pt.atlas.suporte

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.net.HttpURLConnection
import java.net.URL

/**
 * Captura de ecrã + WebRTC. NÃO é dona do socket — usa o socket persistente do [Signaling].
 */
class WebRtcCapture(
    private val context: Context,
    private val serverUrl: String,
    private val socket: Socket,
    @Suppress("UNUSED_PARAMETER") projectionCode: Int,
    private val projectionData: Intent,
    private val onStatus: (String, Boolean) -> Unit,
    private val onProjectionStopped: () -> Unit
) {
    private val TAG = "AtlasCapture"

    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var screenCapturer: ScreenCapturerAndroid? = null
    private var surfaceHelper: SurfaceTextureHelper? = null

    private var remoteReady = false
    private val pendingIce = ArrayList<IceCandidate>()
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile var screenW = 1080
    @Volatile var screenH = 1920

    fun start() {
        Thread {
            try {
                val ice = buscarIceServers()
                iniciarWebRtc(ice)
            } catch (e: Exception) {
                Log.e(TAG, "start falhou", e)
                onStatus("Falha ao iniciar a partilha: ${e.message}", false)
            }
        }.start()
    }

    private fun buscarIceServers(): List<PeerConnection.IceServer> {
        val servers = ArrayList<PeerConnection.IceServer>()
        try {
            val con = URL("$serverUrl/api/ice").openConnection() as HttpURLConnection
            con.connectTimeout = 8000
            con.readTimeout = 8000
            con.inputStream.bufferedReader().use { r ->
                val obj = JSONObject(r.readText())
                val arr = obj.getJSONArray("iceServers")
                for (i in 0 until arr.length()) {
                    val s = arr.getJSONObject(i)
                    val urls = ArrayList<String>()
                    val u = s.get("urls")
                    if (u is JSONArray) {
                        for (j in 0 until u.length()) urls.add(u.getString(j))
                    } else {
                        urls.add(u.toString())
                    }
                    val b = PeerConnection.IceServer.builder(urls)
                    if (s.has("username")) b.setUsername(s.getString("username"))
                    if (s.has("credential")) b.setPassword(s.getString("credential"))
                    servers.add(b.createIceServer())
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "ice fetch falhou: ${e.message}")
        }
        if (servers.isEmpty()) {
            servers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        }
        return servers
    }

    private fun iniciarWebRtc(iceServers: List<PeerConnection.IceServer>) {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
        )
        val egl = EglBase.create()
        eglBase = egl
        val encoder = DefaultVideoEncoderFactory(egl.eglBaseContext, true, true)
        val decoder = DefaultVideoDecoderFactory(egl.eglBaseContext)
        val f = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoder)
            .setVideoDecoderFactory(decoder)
            .createPeerConnectionFactory()
        factory = f

        val capturer = ScreenCapturerAndroid(projectionData, object : MediaProjection.Callback() {
            override fun onStop() {
                mainHandler.post { onProjectionStopped() }
            }
        })
        screenCapturer = capturer
        val helper = SurfaceTextureHelper.create("CaptureThread", egl.eglBaseContext)
        surfaceHelper = helper
        val src = f.createVideoSource(true) // isScreencast
        videoSource = src
        capturer.initialize(helper, context, src.capturerObserver)
        val (w, h) = tamanhoEcra()
        screenW = w
        screenH = h
        capturer.startCapture(w, h, 15)
        val track = f.createVideoTrack("screen0", src)
        videoTrack = track

        val config = PeerConnection.RTCConfiguration(iceServers)
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        config.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        pc = f.createPeerConnection(config, pcObserver)
        pc?.addTrack(track, listOf("stream0"))
    }

    private val pcObserver = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            try {
                val cJson = JSONObject()
                    .put("candidate", c.sdp)
                    .put("sdpMid", c.sdpMid)
                    .put("sdpMLineIndex", c.sdpMLineIndex)
                socket.emit("webrtc:ice", JSONObject().put("candidate", cJson))
            } catch (e: Exception) {
                Log.w(TAG, "enviar ice: ${e.message}")
            }
        }

        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            when (state) {
                PeerConnection.IceConnectionState.CONNECTED,
                PeerConnection.IceConnectionState.COMPLETED ->
                    onStatus("Ligado ao técnico. Ele já vê o seu ecrã.", true)
                PeerConnection.IceConnectionState.FAILED ->
                    onStatus("Ligação instável. A tentar reconectar…", true)
                else -> {}
            }
        }

        override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
        override fun onIceConnectionReceivingChange(p0: Boolean) {}
        override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
        override fun onAddStream(p0: MediaStream?) {}
        override fun onRemoveStream(p0: MediaStream?) {}
        override fun onDataChannel(p0: org.webrtc.DataChannel?) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(p0: RtpReceiver?, p1: Array<out MediaStream>?) {}
    }

    fun criarOferta() {
        val c = MediaConstraints()
        pc?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc?.setLocalDescription(EmptySdp(), desc)
                try {
                    val sdpJson = JSONObject().put("type", "offer").put("sdp", desc.description)
                    socket.emit("webrtc:offer", JSONObject().put("sdp", sdpJson))
                } catch (e: Exception) { Log.w(TAG, "offer emit: ${e.message}") }
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(p0: String?) { Log.w(TAG, "createOffer: $p0") }
            override fun onSetFailure(p0: String?) {}
        }, c)
    }

    fun aplicarAnswer(sdpObj: JSONObject) {
        val sdp = sdpObj.getString("sdp")
        pc?.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                remoteReady = true
                synchronized(pendingIce) {
                    for (cand in pendingIce) pc?.addIceCandidate(cand)
                    pendingIce.clear()
                }
            }
            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
            override fun onSetFailure(p0: String?) { Log.w(TAG, "setRemote: $p0") }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    fun adicionarIce(candObj: JSONObject) {
        val sdpMid = if (candObj.has("sdpMid") && !candObj.isNull("sdpMid")) candObj.getString("sdpMid") else null
        val idx = if (candObj.has("sdpMLineIndex") && !candObj.isNull("sdpMLineIndex")) candObj.getInt("sdpMLineIndex") else 0
        val cand = IceCandidate(sdpMid, idx, candObj.getString("candidate"))
        if (remoteReady) pc?.addIceCandidate(cand)
        else synchronized(pendingIce) { pendingIce.add(cand) }
    }

    private fun tamanhoEcra(): Pair<Int, Int> {
        return try {
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = wm.currentWindowMetrics.bounds
                Pair(b.width(), b.height())
            } else {
                val dm = DisplayMetrics()
                @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
                Pair(dm.widthPixels, dm.heightPixels)
            }
        } catch (e: Exception) {
            val dm = context.resources.displayMetrics
            Pair(dm.widthPixels, dm.heightPixels)
        }
    }

    fun stop() {
        try { screenCapturer?.stopCapture() } catch (_: Exception) {}
        try { screenCapturer?.dispose() } catch (_: Exception) {}
        try { videoSource?.dispose() } catch (_: Exception) {}
        try { surfaceHelper?.dispose() } catch (_: Exception) {}
        try { pc?.close() } catch (_: Exception) {}
        try { pc?.dispose() } catch (_: Exception) {}
        try { factory?.dispose() } catch (_: Exception) {}
        try { eglBase?.release() } catch (_: Exception) {}
    }

    private open inner class EmptySdp : SdpObserver {
        override fun onCreateSuccess(p0: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(p0: String?) {}
        override fun onSetFailure(p0: String?) {}
    }
}
