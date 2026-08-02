package pt.atlas.suporte

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject
import pt.atlas.suporte.databinding.ActivityMainBinding
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private lateinit var mpm: MediaProjectionManager
    private var ativo = false
    private var opAtual: String? = null

    companion object {
        const val DEFAULT_SERVER = "https://remote-assist-21.emergent.host"
        const val ACAO_STATUS = "pt.atlas.suporte.STATUS"
        const val PREFS = "atlas_prefs"
        const val EXTRA_RECONNECT = "reconectar"
    }

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            iniciarCaptura(result.resultCode, result.data!!)
        } else {
            setStatus("Autorização de partilha recusada. Continua ligado — toque em COMEÇAR para tentar.")
        }
    }

    private val notifLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { pedirProjecao() }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val msg = intent?.getStringExtra("msg") ?: return
            ativo = intent.getBooleanExtra("ativo", ativo)
            setStatus(msg)
            atualizarBotao()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        b.btnPartilhar.setOnClickListener {
            if (ativo) pararPartilha() else prosseguir()
        }
        b.btnControlo.setOnClickListener {
            try {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                setStatus("Ative \"Suporte Atlas — Controlo remoto\" na lista e volte à app.")
            } catch (e: Exception) {
                setStatus("Abra Definições > Acessibilidade e ative o Suporte Atlas.")
            }
        }
        b.btnDesligar.setOnClickListener { desligarTudo() }

        tratarReconexao(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarReconexao(intent)
    }

    override fun onResume() {
        super.onResume()
        ContextCompat.registerReceiver(
            this, statusReceiver, IntentFilter(ACAO_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        ativo = ScreenShareService.emExecucao
        atualizarBotao()
        atualizarControlo()
        atualizarLigacao()
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}
    }

    /** Pedido de reconexão vindo da notificação: retoma a partilha diretamente. */
    private fun tratarReconexao(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_RECONNECT, false) == true) {
            intent.removeExtra(EXTRA_RECONNECT)
            setStatus("O técnico pediu para reconectar. A preparar a partilha…")
            prosseguir()
        }
    }

    private fun prosseguir() {
        if (!acessibilidadeAtiva()) {
            AlertDialog.Builder(this)
                .setTitle("Ativar controlo remoto (uma vez)")
                .setMessage("Para o técnico poder tocar e deslizar no seu ecrã, ative o \"Suporte Atlas — Controlo remoto\" na lista de Acessibilidade. É só desta vez. Depois volte e toque em COMEÇAR.")
                .setPositiveButton("Abrir definições") { _, _ ->
                    try { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } catch (e: Exception) {}
                }
                .setNegativeButton("Partilhar só o ecrã") { _, _ -> iniciarLigacao() }
                .show()
            return
        }
        iniciarLigacao()
    }

    private fun iniciarLigacao() {
        setStatus("A ligar ao suporte…")
        val opCache = opAtual ?: Signaling.op.ifBlank { null }
        if (opCache != null) {
            opAtual = opCache
            ligarSinalizacao(opCache)
            garantirNotificacaoEProjecao()
            return
        }
        Thread {
            val op = buscarOp()
            runOnUiThread {
                if (op.isNullOrBlank()) {
                    setStatus("Não foi possível ligar ao servidor. Verifique a Internet e tente novamente.")
                } else {
                    opAtual = op
                    ligarSinalizacao(op)
                    garantirNotificacaoEProjecao()
                }
            }
        }.start()
    }

    /** Garante que o serviço persistente (socket) está a correr. */
    private fun ligarSinalizacao(op: String) {
        val i = Intent(this, SignalingService::class.java).apply {
            action = SignalingService.ACAO_LIGAR
            putExtra("server", DEFAULT_SERVER)
            putExtra("op", op)
        }
        ContextCompat.startForegroundService(this, i)
    }

    private fun buscarOp(): String? {
        return try {
            val con = URL("$DEFAULT_SERVER/api/app-config").openConnection() as HttpURLConnection
            con.connectTimeout = 8000
            con.readTimeout = 8000
            con.inputStream.bufferedReader().use {
                val o = JSONObject(it.readText())
                if (o.isNull("op")) null else o.getString("op")
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun garantirNotificacaoEProjecao() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            pedirProjecao()
        }
    }

    private fun pedirProjecao() {
        setStatus("A pedir autorização para partilhar o ecrã…")
        projectionLauncher.launch(mpm.createScreenCaptureIntent())
    }

    private fun iniciarCaptura(code: Int, data: Intent) {
        val i = Intent(this, ScreenShareService::class.java).apply {
            action = ScreenShareService.ACAO_INICIAR
            putExtra("code", code)
            putExtra("data", data)
        }
        ContextCompat.startForegroundService(this, i)
        ativo = true
        setStatus("A ligar ao técnico…")
        atualizarBotao()
    }

    private fun pararPartilha() {
        val i = Intent(this, ScreenShareService::class.java).apply {
            action = ScreenShareService.ACAO_PARAR
        }
        startService(i)
        ativo = false
        setStatus("Partilha parada. Continua ligado — o técnico pode pedir reconexão.")
        atualizarBotao()
    }

    private fun desligarTudo() {
        val p = Intent(this, ScreenShareService::class.java).apply { action = ScreenShareService.ACAO_PARAR }
        startService(p)
        val d = Intent(this, SignalingService::class.java).apply { action = SignalingService.ACAO_DESLIGAR }
        startService(d)
        ativo = false
        setStatus("Desligado do suporte. Toque em COMEÇAR para voltar a ligar.")
        atualizarBotao()
        atualizarLigacao()
    }

    private fun atualizarBotao() {
        b.btnPartilhar.text = if (ativo) "PARAR PARTILHA" else "COMEÇAR"
    }

    private fun atualizarLigacao() {
        val ligado = SignalingService.ativo
        b.btnDesligar.visibility = if (ligado) android.view.View.VISIBLE else android.view.View.GONE
        b.tvLigacao.text = if (ligado)
            "Ligado ao suporte ✓ — pode reconectar a qualquer momento"
        else
            "Não ligado. Toque em COMEÇAR para ligar."
    }

    private fun atualizarControlo() {
        val on = acessibilidadeAtiva()
        b.tvControlo.text = if (on) "Controlo remoto: ATIVO ✓" else "Controlo remoto: desativado"
        b.btnControlo.text = if (on) "Controlo remoto ativado ✓" else "Ativar controlo remoto (toques)"
    }

    private fun acessibilidadeAtiva(): Boolean {
        return try {
            val s = Settings.Secure.getString(
                contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            s.contains("$packageName/$packageName.ControlService")
        } catch (e: Exception) { false }
    }

    private fun setStatus(msg: String) {
        b.tvStatus.text = msg
    }
}
