package pt.atlas.suporte

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class ScreenShareService : Service() {

    private var sessao: WebRtcSession? = null

    companion object {
        const val ACAO_INICIAR = "iniciar"
        const val ACAO_PARAR = "parar"
        const val CANAL = "atlas_partilha"
        const val NOTIF_ID = 4321
        @Volatile var emExecucao = false
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACAO_PARAR -> {
                parar()
                return START_NOT_STICKY
            }
            ACAO_INICIAR -> {
                iniciarForeground()
                val code = intent.getIntExtra("code", 0)
                val data = intent.getParcelableExtra<Intent>("data")
                val server = intent.getStringExtra("server") ?: MainActivity.DEFAULT_SERVER
                val op = intent.getStringExtra("op") ?: ""
                if (data == null || op.isBlank()) {
                    reportar("Dados de partilha inválidos.", false)
                    parar()
                    return START_NOT_STICKY
                }
                emExecucao = true
                sessao = WebRtcSession(
                    applicationContext, server, op, code, data
                ) { msg, ativo -> reportar(msg, ativo) }
                sessao?.start()
            }
        }
        return START_STICKY
    }

    private fun iniciarForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(CANAL, "Partilha de ecrã", NotificationManager.IMPORTANCE_LOW)
            canal.description = "Ativo enquanto partilha o ecrã com o técnico Atlas."
            nm.createNotificationChannel(canal)
        }
        val notif: Notification = NotificationCompat.Builder(this, CANAL)
            .setContentTitle("Suporte Atlas")
            .setContentText("A partilhar o seu ecrã com o técnico.")
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun parar() {
        try { sessao?.stop() } catch (_: Exception) {}
        sessao = null
        emExecucao = false
        reportar("Partilha terminada.", false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun reportar(msg: String, ativo: Boolean) {
        val i = Intent(MainActivity.ACAO_STATUS)
            .putExtra("msg", msg)
            .putExtra("ativo", ativo)
        i.setPackage(packageName)
        sendBroadcast(i)
    }

    override fun onDestroy() {
        super.onDestroy()
        try { sessao?.stop() } catch (_: Exception) {}
        emExecucao = false
    }
}
