package pt.atlas.suporte

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import pt.atlas.suporte.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private lateinit var mpm: MediaProjectionManager
    private var ativo = false

    companion object {
        const val DEFAULT_SERVER = "https://remote-assist-21.emergent.host"
        const val ACAO_STATUS = "pt.atlas.suporte.STATUS"
        const val PREFS = "atlas_prefs"
    }

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            iniciarServico(result.resultCode, result.data!!)
        } else {
            setStatus("Autorização de partilha recusada. Toque novamente para tentar.")
        }
    }

    private val notifLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { pedirProjecao() }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val msg = intent?.getStringExtra("msg") ?: return
            val on = intent.getBooleanExtra("ativo", ativo)
            ativo = on
            setStatus(msg)
            atualizarBotao()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        b.etCodigo.setText(prefs.getString("ultimo_link", ""))

        b.btnPartilhar.setOnClickListener {
            if (ativo) {
                pararServico()
            } else {
                val entrada = b.etCodigo.text.toString().trim()
                val (_, op) = extrair(entrada)
                if (op.isBlank()) {
                    setStatus("Cole o link de suporte que o técnico lhe enviou.")
                    return@setOnClickListener
                }
                prefs.edit().putString("ultimo_link", entrada).apply()
                garantirNotificacaoEProjecao()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        ContextCompat.registerReceiver(
            this, statusReceiver, IntentFilter(ACAO_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        ativo = ScreenShareService.emExecucao
        atualizarBotao()
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}
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

    private fun iniciarServico(code: Int, data: Intent) {
        val entrada = b.etCodigo.text.toString().trim()
        val (server, op) = extrair(entrada)
        val i = Intent(this, ScreenShareService::class.java).apply {
            action = ScreenShareService.ACAO_INICIAR
            putExtra("code", code)
            putExtra("data", data)
            putExtra("server", server)
            putExtra("op", op)
        }
        ContextCompat.startForegroundService(this, i)
        ativo = true
        setStatus("A ligar ao técnico…")
        atualizarBotao()
    }

    private fun pararServico() {
        val i = Intent(this, ScreenShareService::class.java).apply {
            action = ScreenShareService.ACAO_PARAR
        }
        startService(i)
        ativo = false
        setStatus("Partilha terminada.")
        atualizarBotao()
    }

    private fun atualizarBotao() {
        b.btnPartilhar.text = if (ativo) "PARAR PARTILHA" else "PARTILHAR ECRÃ"
    }

    private fun setStatus(msg: String) {
        b.tvStatus.text = msg
    }

    private fun extrair(entrada: String): Pair<String, String> {
        var server = DEFAULT_SERVER
        var op = entrada
        if (entrada.startsWith("http", ignoreCase = true)) {
            try {
                val u = Uri.parse(entrada)
                val porta = if (u.port > 0) ":" + u.port else ""
                server = u.scheme + "://" + u.host + porta
                op = u.getQueryParameter("op") ?: ""
            } catch (_: Exception) { }
        }
        return Pair(server, op.trim())
    }
}
