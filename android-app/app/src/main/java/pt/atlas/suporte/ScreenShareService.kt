package pt.atlas.suporte

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/** Serviço de captura (foreground mediaProjection). Delega no [Signaling]. */
class ScreenShareService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

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
                Signaling.stopShare()
                pararInterno()
                return START_NOT_STICKY
            }
            ACAO_INICIAR -> {
                iniciarForeground()
                val code = intent.getIntExtra("code", 0)
                val data = intent.getParcelableExtra<Intent>("data")
                if (data == null) {
                    pararInterno()
                    return START_NOT_STICKY
                }
                emExecucao = true
                adquirirWakeLock()
                Signaling.onShareEnded = { pararInterno() }
                Signaling.startShare(applicationContext, code, data)
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
            .setContentTitle("Conexão Cripto")
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

    private fun adquirirWakeLock() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "atlas:partilha")
            }
            if (wakeLock?.isHeld != true) wakeLock?.acquire(3 * 60 * 60 * 1000L)
        } catch (_: Exception) {}
    }

    private fun pararInterno() {
        emExecucao = false
        Signaling.onShareEnded = null
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        emExecucao = false
    }
}
