package pt.atlas.suporte

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Serviço de Acessibilidade que executa toques reais no ecrã (dispatchGesture).
 * Tem de ser ativado pelo utilizador em Definições > Acessibilidade.
 */
class ControlService : AccessibilityService() {

    companion object {
        @Volatile var instance: ControlService? = null
        private const val TAG = "AtlasControl"
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "ControlService ligado")
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance == this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    /** Executa um toque nas coordenadas (em pixéis do ecrã). */
    fun tap(x: Float, y: Float) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        try {
            val path = Path().apply { moveTo(x, y) }
            val stroke = GestureDescription.StrokeDescription(path, 0L, 70L)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            dispatchGesture(gesture, null, null)
        } catch (e: Exception) {
            Log.w(TAG, "tap falhou: ${e.message}")
        }
    }

    /** Executa um deslize (swipe) entre dois pontos. */
    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, duracaoMs: Long = 250L) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        try {
            val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
            val stroke = GestureDescription.StrokeDescription(path, 0L, duracaoMs)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            dispatchGesture(gesture, null, null)
        } catch (e: Exception) {
            Log.w(TAG, "swipe falhou: ${e.message}")
        }
    }
}
