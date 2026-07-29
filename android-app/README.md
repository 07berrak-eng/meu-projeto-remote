# App Android nativa — Suporte Atlas

App nativa (Kotlin) que captura o **ecrã inteiro do telemóvel** via MediaProjection e transmite por **WebRTC** para o servidor Atlas. O técnico continua a ver no painel web.

- Package: `pt.atlas.suporte`
- Servidor por defeito: `https://remote-assist-21.emergent.host`
- Liga-se ao mesmo Socket.io (`/api/socketio`) e usa os mesmos eventos do cliente web
  (`cliente:hello`, `cliente:partilhar`, `webrtc:offer/answer/ice`, `tecnico:pronto`).
- O utilizador cola o link de suporte (com `?op=<linkId>`) e toca em PARTILHAR ECRÃ.

## Estrutura
- `app/src/main/java/pt/atlas/suporte/MainActivity.kt` — UI + pedido de permissão MediaProjection
- `ScreenShareService.kt` — serviço em primeiro plano (foregroundServiceType=mediaProjection)
- `WebRtcSession.kt` — captura de ecrã + PeerConnection + sinalização Socket.io

## Como reconstruir o APK (neste ambiente)
O host é aarch64; o `aapt2` do SDK é x86_64, por isso corre via QEMU. Tudo está cacheado em `/root/android-build`.

```
bash /root/build_apk.sh
```
O APK final é copiado para `/app/frontend/public/atlas-suporte.apk`.

> Nota: as ferramentas (JDK, SDK, Gradle, QEMU) são recriadas/cacheadas em `/root` pelo script,
> porque tudo o que está fora de `/app` e `/root` é apagado nos reinícios do pod.
