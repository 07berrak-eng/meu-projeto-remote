# Suporte Atlas — App Desktop (Electron)

App de desktop para **partilha de ecrã + controlo remoto** com reconexão automática.
Liga-se automaticamente à conta principal (admin), tal como a app Android.
Um único botão **CONECTAR**.

- Windows, macOS e Linux
- Partilha de ecrã via WebRTC (escolhe o ecrã principal automaticamente — sem seletor)
- Controlo remoto real do rato via `@nut-tree-fork/nut-js`
- Reconexão automática (socket.io) e resposta ao pedido de reconexão do técnico

O servidor usado está definido em `renderer/renderer.js` na constante `SERVER`
(por omissão: `https://remote-assist-21.emergent.host`).

---

## 1. Requisitos
- Node.js 18+ e npm
- Ferramentas de build nativas (para o `nut-js`):
  - **Windows**: "Desktop development with C++" (Visual Studio Build Tools) + Python 3
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `build-essential`, `libxtst-dev`, `libpng++-dev`, `libx11-dev`

## 2. Instalar dependências
```bash
cd desktop-app
npm install
```

## 3. Correr em desenvolvimento
```bash
npm start
```

## 4. Gerar o instalador (na MESMA plataforma alvo)
> Importante: por causa do módulo nativo de controlo remoto, o instalador deve ser
> gerado **no próprio sistema operativo** (Windows num Windows, macOS num Mac, etc.).

```bash
# Windows (.exe / NSIS)
npm run dist:win

# macOS (.dmg)
npm run dist:mac

# Linux (.AppImage)
npm run dist:linux
```
Os ficheiros finais ficam na pasta `dist/`.

## 5. Notas importantes
- **Controlo remoto**: se o `nut-js` não conseguir compilar/carregar, a app continua a
  **partilhar o ecrã** normalmente, apenas sem controlo do rato (a UI indica "Controlo remoto: indisponível").
- **macOS**: a primeira execução pede permissões em *Definições do Sistema → Privacidade e Segurança →
  Acessibilidade* e *Gravação de ecrã*. É necessário autorizar a app uma vez.
- **Windows SmartScreen**: por não estar assinada com certificado de code-signing, o Windows pode mostrar
  um aviso na 1.ª instalação ("Mais informações → Executar assim mesmo"). Para remover, assine o instalador
  com um certificado EV/OV.
- **Assinatura de código** (opcional, recomendado para produção):
  - Windows: definir `CSC_LINK` e `CSC_KEY_PASSWORD` (certificado .pfx) antes de `npm run dist:win`.
  - macOS: `CSC_LINK`/`CSC_KEY_PASSWORD` + notarização (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`).

## 6. Como funciona (resumo técnico)
- `main.js` (processo principal): cria a janela, escolhe o ecrã principal via
  `setDisplayMediaRequestHandler`, e executa o controlo remoto (nut-js) por IPC.
- `preload.js`: expõe `window.atlas.{screenSize, tap, gesture, temControlo}` de forma segura.
- `renderer/renderer.js`: liga o socket.io (`/api/socketio`), faz o handshake `cliente:hello`,
  cria a oferta WebRTC quando o técnico está pronto e reencaminha `tecnico:clique`/`tecnico:gesto`
  para o controlo do rato.
- Compatível com o backend existente (mesmos eventos do cliente web/Android).
