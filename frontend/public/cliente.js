/* global io */
(function () {
  const params = new URLSearchParams(location.search);
  const op = params.get("op");
  const chaveToken = "atlas_token_" + (op || "x");
  let token = localStorage.getItem(chaveToken) || params.get("token") || null;

  const el = (id) => document.getElementById(id);
  const telaInicio = el("tela-inicio");
  const telaAtivo = el("tela-ativo");
  const telaErro = el("tela-erro");
  const txtErro = el("txt-erro");

  let socket, pc, stream;
  let sessaoId = null;
  let sessaoPronta = false;
  let tecnicoPronto = false;
  let iceQueue = [];
  let remotoPronto = false;

  let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  fetch(location.origin + "/api/ice")
    .then((r) => r.json())
    .then((c) => { if (c && c.iceServers) rtcConfig = c; })
    .catch(() => {});

  function mostrar(tela) {
    [telaInicio, telaAtivo, telaErro].forEach((t) => t.classList.add("oculto"));
    tela.classList.remove("oculto");
  }

  function erro(msg) {
    txtErro.textContent = msg || "Não foi possível iniciar a partilha. Verifique as permissões e tente novamente.";
    mostrar(telaErro);
  }

  if (!op) {
    erro("Link inválido. Peça um novo link de acesso ao seu técnico.");
    return;
  }

  // ---- Socket.io ----
  socket = io(location.origin, { path: "/api/socketio", transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    socket.emit("cliente:hello", { op, token, userAgent: navigator.userAgent });
    if (stream) socket.emit("cliente:partilhar", { ativo: true });
  });

  socket.on("cliente:sessao", (d) => {
    sessaoId = d.id;
    sessaoPronta = true;
    if (d.token) {
      token = d.token;
      localStorage.setItem(chaveToken, d.token);
    }
  });

  socket.on("cliente:erro", (d) => erro(d && d.msg));

  socket.on("tecnico:pronto", () => {
    tecnicoPronto = true;
    if (stream) criarOferta();
  });

  socket.on("webrtc:answer", async (d) => {
    try {
      if (pc && d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        remotoPronto = true;
        for (const c of iceQueue) { try { await pc.addIceCandidate(c); } catch (e) {} }
        iceQueue = [];
      }
    } catch (e) { console.warn(e); }
  });

  socket.on("webrtc:ice", async (d) => {
    if (!d.candidate) return;
    if (pc && remotoPronto) {
      try { await pc.addIceCandidate(d.candidate); } catch (e) {}
    } else {
      iceQueue.push(d.candidate);
    }
  });

  socket.on("tecnico:clique", (d) => {
    const px = (d.x / 100) * window.innerWidth;
    const py = (d.y / 100) * window.innerHeight;
    mostrarCirculo(px, py);
    replicarToque(px, py);
  });

  // ---- Partilha de ecrã ----
  let wakeLock = null;

  async function pedirWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }

  function libertarWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
  }

  // Re-adquire o wake lock quando o cliente volta ao separador (é libertado automaticamente ao esconder)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && stream && !wakeLock) pedirWakeLock();
  });

  async function comecar() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        erro("O seu navegador não suporta partilha de ecrã. Em iPhone/iPad (Safari) esta função não está disponível.");
        return;
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always", frameRate: 10 },
        audio: false,
      });
      mostrar(telaAtivo);
      await pedirWakeLock();
      socket.emit("cliente:partilhar", { ativo: true });
      stream.getVideoTracks()[0].addEventListener("ended", pararPartilha);
      if (tecnicoPronto) criarOferta();
    } catch (e) {
      console.warn(e);
      erro("A partilha foi cancelada ou não foi autorizada. Toque em “Tentar novamente” e permita a partilha.");
    }
  }

  async function criarOferta() {
    try {
      if (pc) { try { pc.close(); } catch (e) {} }
      iceQueue = [];
      remotoPronto = false;
      pc = new RTCPeerConnection(rtcConfig);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc:ice", { candidate: e.candidate }); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { sdp: pc.localDescription });
    } catch (e) { console.warn(e); }
  }

  function pararPartilha() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    libertarWakeLock();
    socket.emit("cliente:partilhar", { ativo: false });
    mostrar(telaInicio);
  }

  // ---- Círculo vermelho + toque simulado ----
  function mostrarCirculo(x, y) {
    const c = document.createElement("div");
    c.className = "circulo-toque";
    c.style.left = x + "px";
    c.style.top = y + "px";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }

  function replicarToque(x, y) {
    const alvo = document.elementFromPoint(x, y);
    if (!alvo) return;
    const comum = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    try { alvo.dispatchEvent(new PointerEvent("pointerdown", { ...comum, pointerType: "touch" })); } catch (e) {}
    try { alvo.dispatchEvent(new MouseEvent("mousedown", comum)); } catch (e) {}
    try { alvo.dispatchEvent(new PointerEvent("pointerup", { ...comum, pointerType: "touch" })); } catch (e) {}
    try { alvo.dispatchEvent(new MouseEvent("mouseup", comum)); } catch (e) {}
    try { alvo.dispatchEvent(new MouseEvent("click", comum)); } catch (e) {}
    if (typeof alvo.focus === "function") { try { alvo.focus(); } catch (e) {} }
  }

  el("btn-comecar").addEventListener("click", comecar);
  el("btn-retry").addEventListener("click", comecar);
  el("btn-parar").addEventListener("click", pararPartilha);
})();
