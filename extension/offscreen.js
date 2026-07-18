// Mantém a ligação Socket.io viva (o service worker do MV3 pode adormecer).
// Recebe {server, op, token} do background, liga-se ao Atlas e reencaminha os cliques do técnico.

let socket = null;
let dados = null;

function ligar(cfg) {
  dados = cfg;
  if (socket) { try { socket.disconnect(); } catch (e) {} }
  // eslint-disable-next-line no-undef
  socket = io(cfg.server, { path: "/api/socketio", transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    socket.emit("extensao:hello", { token: cfg.token });
    enviar({ tipo: "estado", ligado: true });
  });
  socket.on("disconnect", () => enviar({ tipo: "estado", ligado: false }));
  socket.on("extensao:ok", (d) => enviar({ tipo: "sessao", sessaoId: d.sessaoId, operador: d.operador }));
  socket.on("extensao:erro", (d) => enviar({ tipo: "erro", msg: d && d.msg }));
  socket.on("tecnico:clique", (d) => enviar({ tipo: "clique", x: d.x, y: d.y }));
}

function enviar(msg) {
  chrome.runtime.sendMessage({ destino: "background", ...msg }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.destino === "offscreen") {
    if (msg.tipo === "ligar") ligar(msg.cfg);
    if (msg.tipo === "desligar" && socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
  }
});
