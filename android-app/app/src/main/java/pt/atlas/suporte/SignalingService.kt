package pt.atlas.suporte

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Serviço PERSISTENTE de sinalização (foreground dataSync).
 * Mantém o socket ligado mesmo sem partilhar, para permitir a reconexão a pedido do técnico.
 */
class SignalingService : Service() {

    companion object {
        const val ACAO_LIGAR = "ligar"
        const val ACAO_DESLIGAR = "desligar"
        const val CANAL = "atlas_ligacao"
        const val CANAL_RECON = "atlas_reconexao"
        const val NOTIF_ID = 4322
        const val NOTIF_RECON_ID = 4323
        @Volatile var ativo = false
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACAO_DESLIGAR -> {
                Signaling.disconnectAll()
                ativo = false
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val server = intent?.getStringExtra("server") ?: MainActivity.DEFAULT_SERVER
                val op = intent?.getStringExtra("op") ?: Signaling.op
                iniciarForeground()
                Signaling.onStatus = { msg, sh -> reportar(msg, sh) }
                Signaling.onReconnectRequest = {
                    val cap = Signaling.capture
                    if (cap != null && cap.projectionAlive) {
                        // Projeção ainda viva: reconecta automaticamente, SEM pedir autorização.
                        cap.reconectarPeer()
                    } else {
                        // Projeção perdida (ecrã bloqueou/sistema parou): precisa re-autorizar 1x.
                        mostrarNotifReconexao()
                    }
                }
                if (op.isNotBlank()) Signaling.connect(applicationContext, server, op)
                ativo = true
            }
        }
        return START_STICKY
    }

    private fun iniciarForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(CANAL, "Ligação ao suporte", NotificationManager.IMPORTANCE_LOW)
            canal.description = "Mantém a app ligada para o técnico o poder reconectar."
            nm.createNotificationChannel(canal)
        }
        val abrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif: Notification = NotificationCompat.Builder(this, CANAL)
            .setContentTitle("Suporte Atlas — ligado")
            .setContentText("Está ligado ao suporte. O técnico pode reconectar quando precisar.")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(abrir)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    /** Notificação de alta prioridade quando o técnico pede reconexão. */
    private fun mostrarNotifReconexao() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(CANAL_RECON, "Pedido de reconexão", NotificationManager.IMPORTANCE_HIGH)
            canal.description = "O técnico pediu para retomar a partilha do ecrã."
            canal.enableVibration(true)
            nm.createNotificationChannel(canal)
        }
        val i = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_RECONNECT, true)
        }
        val pi = PendingIntent.getActivity(
            this, 1, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(this, CANAL_RECON)
            .setContentTitle("Reconectar ao técnico")
            .setContentText("O técnico pediu para retomar a partilha. Toque para reconectar.")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .addAction(android.R.drawable.ic_menu_share, "RECONECTAR", pi)
            .setVibrate(longArrayOf(0, 300, 150, 300))
            .build()
        nm.notify(NOTIF_RECON_ID, notif)
    }

    private fun reportar(msg: String, sh: Boolean) {
        val i = Intent(MainActivity.ACAO_STATUS)
            .putExtra("msg", msg)
            .putExtra("ativo", sh)
        i.setPackage(packageName)
        sendBroadcast(i)
    }
}
