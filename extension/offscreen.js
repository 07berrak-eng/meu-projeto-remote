// Mantém a ligação Socket.io viva (o service worker do MV3 pode adormecer).
// Recebe {server, op, token} do background, liga-se ao Atlas e reencaminha os cliques do técnico.

let socket = null;

function log(...a) { console.log("[Atlas offscreen]", ...a); }

function ligar(cfg) {
  if (!cfg || !cfg.server || !cfg.token) return;
  if (socket) { try { socket.disconnect(); } catch (e) {} }
  log("a ligar a", cfg.server);
  // eslint-disable-next-line no-undef
  socket = io(cfg.server, { path: "/api/socketio", transports: ["websocket", "polling"], reconnection: true });

  socket.on("connect", () => {
    log("ligado, a enviar extensao:hello");
    socket.emit("extensao:hello", { token: cfg.token });
    enviar({ tipo: "estado", ligado: true });
  });
  socket.on("connect_error", (e) => log("connect_error", e && e.message));
  socket.on("disconnect", () => { log("desligado"); enviar({ tipo: "estado", ligado: false }); });
  socket.on("extensao:ok", (d) => { log("extensao:ok", d); enviar({ tipo: "sessao", sessaoId: d.sessaoId, operador: d.operador }); });
  socket.on("extensao:erro", (d) => { log("extensao:erro", d); enviar({ tipo: "erro", msg: d && d.msg }); });
  socket.on("tecnico:clique", (d) => { log("clique recebido", d); enviar({ tipo: "clique", x: d.x, y: d.y }); });
}

function enviar(msg) {
  try { chrome.runtime.sendMessage({ destino: "background", ...msg }).catch(() => {}); } catch (e) {}
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.destino === "offscreen") {
    if (msg.tipo === "ligar") ligar(msg.cfg);
    if (msg.tipo === "desligar" && socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
  }
});

// Modelo "pull": assim que o documento carrega, pede a configuração ao background.
log("offscreen pronto, a pedir configuracao");
enviar({ tipo: "offscreen-pronto" });
