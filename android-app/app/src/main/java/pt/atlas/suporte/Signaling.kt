package pt.atlas.suporte

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

/**
 * Cliente de sinalização persistente (singleton de processo).
 * Mantém UMA ligação socket.io viva mesmo quando NÃO está a partilhar o ecrã,
 * para que o técnico possa pedir a reconexão a qualquer momento.
 */
object Signaling {
    private const val TAG = "AtlasSignaling"
    private val main = Handler(Looper.getMainLooper())

    @Volatile var socket: Socket? = null
    @Volatile var capture: WebRtcCapture? = null
    @Volatile var connected = false
    @Volatile var sharing = false

    var server: String = MainActivity.DEFAULT_SERVER
    var op: String = ""
    var token: String? = null

    /** Chamado quando o técnico pede reconexão (via CRM). */
    var onReconnectRequest: (() -> Unit)? = null
    /** Reporta estado para a UI (MainActivity / notificação). */
    var onStatus: ((String, Boolean) -> Unit)? = null
    /** Chamado quando a partilha termina (para parar o serviço de captura). */
    var onShareEnded: (() -> Unit)? = null

    fun screenSize(ctx: Context): Pair<Int, Int> {
        return try {
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = wm.currentWindowMetrics.bounds
                Pair(b.width(), b.height())
            } else {
                val dm = DisplayMetrics()
                @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
                Pair(dm.widthPixels, dm.heightPixels)
            }
        } catch (e: Exception) {
            val dm = ctx.resources.displayMetrics
            Pair(dm.widthPixels, dm.heightPixels)
        }
    }

    @Synchronized
    fun connect(ctx: Context, serverUrl: String, opId: String) {
        this.server = serverUrl
        this.op = opId
        val appCtx = ctx.applicationContext
        val prefs = appCtx.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
        token = prefs.getString("token_$opId", null)

        val existing = socket
        if (existing != null) {
            if (!existing.connected()) existing.connect()
            return
        }

        val opts = IO.Options()
        opts.path = "/api/socketio"
        opts.transports = arrayOf("websocket")
        opts.reconnection = true
        val s = IO.socket(serverUrl, opts)
        socket = s

        s.on(Socket.EVENT_CONNECT) {
            connected = true
            val hello = JSONObject().put("op", opId)
                .put("userAgent", "AtlasAndroid/1.2 (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})")
            token?.let { hello.put("token", it) }
            s.emit("cliente:hello", hello)
            status(if (sharing) "A partilhar o ecrã." else "Ligado ao suporte. Pronto para ajudar.", sharing)
        }
        s.on(Socket.EVENT_DISCONNECT) { connected = false }
        s.on("cliente:sessao") { args ->
            try {
                val d = args[0] as JSONObject
                if (d.has("token")) {
                    token = d.getString("token")
                    prefs.edit().putString("token_$opId", token).apply()
                }
                if (sharing) s.emit("cliente:partilhar", JSONObject().put("ativo", true))
            } catch (e: Exception) { Log.w(TAG, "sessao: ${e.message}") }
        }
        s.on("cliente:erro") { args ->
            val msg = (args.getOrNull(0) as? JSONObject)?.optString("msg") ?: "Erro do servidor."
            status("Erro: $msg", false)
        }
        s.on("tecnico:pronto") { capture?.criarOferta() }
        s.on("webrtc:answer") { args ->
            try { capture?.aplicarAnswer((args[0] as JSONObject).getJSONObject("sdp")) }
            catch (e: Exception) { Log.w(TAG, "answer: ${e.message}") }
        }
        s.on("webrtc:ice") { args ->
            try {
                val d = args[0] as JSONObject
                if (d.has("candidate") && !d.isNull("candidate")) capture?.adicionarIce(d.getJSONObject("candidate"))
            } catch (e: Exception) { Log.w(TAG, "ice: ${e.message}") }
        }
        s.on("tecnico:gesto") { args ->
            try {
                val d = args[0] as JSONObject
                val arr = d.getJSONArray("pontos")
                val n = arr.length()
                if (n == 0) return@on
                val sz = capture?.let { Pair(it.screenW, it.screenH) } ?: screenSize(appCtx)
                val w = sz.first; val h = sz.second
                val xs = FloatArray(n); val ys = FloatArray(n)
                for (i in 0 until n) {
                    val p = arr.getJSONObject(i)
                    xs[i] = (p.getDouble("x") / 100.0 * w).toFloat()
                    ys[i] = (p.getDouble("y") / 100.0 * h).toFloat()
                }
                val dur = d.optLong("duracao", 0L)
                val ctrl = ControlService.instance
                if (ctrl != null) main.post { if (n == 1) ctrl.tap(xs[0], ys[0]) else ctrl.gesture(xs, ys, dur) }
            } catch (e: Exception) { Log.w(TAG, "gesto: ${e.message}") }
        }
        s.on("cliente:pedir-reconexao") {
            main.post { onReconnectRequest?.invoke() }
        }
        s.connect()
    }

    /** Inicia a captura de ecrã usando o socket persistente. */
    fun startShare(ctx: Context, code: Int, data: Intent) {
        val s = socket ?: return
        try { capture?.stop() } catch (_: Exception) {}
        val cap = WebRtcCapture(
            ctx.applicationContext, server, s, code, data,
            { msg, ativo -> status(msg, ativo) },
            { handleProjectionStopped() }
        )
        capture = cap
        sharing = true
        cap.start()
        if (connected) s.emit("cliente:partilhar", JSONObject().put("ativo", true))
        status("A partilhar o ecrã. O técnico já o pode ajudar.", true)
    }

    /** Para a partilha mas MANTÉM o socket ligado (para permitir reconexão). */
    fun stopShare() {
        sharing = false
        try { socket?.emit("cliente:partilhar", JSONObject().put("ativo", false)) } catch (_: Exception) {}
        try { capture?.stop() } catch (_: Exception) {}
        capture = null
        status("Partilha terminada. Continua ligado — o técnico pode pedir reconexão.", false)
    }

    /** A projeção parou sozinha (ecrã desligou, sistema revogou, etc.). */
    private fun handleProjectionStopped() {
        sharing = false
        try { socket?.emit("cliente:partilhar", JSONObject().put("ativo", false)) } catch (_: Exception) {}
        try { capture?.stop() } catch (_: Exception) {}
        capture = null
        status("A partilha parou. O técnico pode pedir para reconectar.", false)
        main.post { onShareEnded?.invoke() }
    }

    /** Termina tudo: partilha + socket. */
    fun disconnectAll() {
        sharing = false
        try { capture?.stop() } catch (_: Exception) {}
        capture = null
        try { socket?.disconnect(); socket?.off() } catch (_: Exception) {}
        socket = null
        connected = false
    }

    private fun status(msg: String, ativo: Boolean) { main.post { onStatus?.invoke(msg, ativo) } }
}
