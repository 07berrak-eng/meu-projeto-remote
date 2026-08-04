/* global io */
(function () {
  const SERVER = "https://remote-assist-21.emergent.host";

  const el = (id) => document.getElementById(id);
  const btn = el("btn");
  const statusEl = el("status");
  const controloEl = el("controlo");

  let socket = null, pc = null, stream = null;
  let op = null, token = null;
  let sessaoPronta = false, tecnicoPronto = false, remotoPronto = false;
  let iceQueue = [];
  let ativo = false;
  let screenSize = { width: 1920, height: 1080, scale: 1 };

  let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  function setStatus(m) { statusEl.textContent = m; }

  async function carregarIce() {
    try {
      const r = await fetch(SERVER + "/api/ice");
      const c = await r.json();
      if (c && c.iceServers) rtcConfig = c;
    } catch (e) {}
  }

  async function buscarOp() {
    try {
      const r = await fetch(SERVER + "/api/app-config");
      const o = await r.json();
      return o && o.op ? o.op : null;
    } catch (e) { return null; }
  }

  async function conectar() {
    setStatus("A preparar a partilha de ecrã…");
    // Verifica controlo remoto disponível
    try {
      const tem = await window.atlas.temControlo();
      controloEl.textContent = tem ? "Controlo remoto: ATIVO ✓" : "Controlo remoto: indisponível nesta build";
      controloEl.className = "controlo " + (tem ? "on" : "off");
    } catch (e) {}
    try { screenSize = await window.atlas.screenSize(); } catch (e) {}

    // Captura do ecrã principal (sem seletor — o processo principal escolhe automaticamente)
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      try { await stream.getVideoTracks()[0].applyConstraints({ frameRate: 12 }); } catch (e) {}
      stream.getVideoTracks()[0].addEventListener("ended", pararTudo);
    } catch (e) {
      setStatus("Não foi possível capturar o ecrã: " + (e && e.message));
      return;
    }

    op = await buscarOp();
    if (!op) { setStatus("Sem ligação ao servidor. Verifique a Internet."); return; }
    token = localStorage.getItem("atlas_token_" + op) || null;
    await carregarIce();
    ligarSocket();

    ativo = true;
    btn.textContent = "TERMINAR";
    btn.classList.add("stop");
    setStatus("Ligado. A partilhar o seu ecrã com o técnico.");
  }

  function ligarSocket() {
    socket = io(SERVER, { path: "/api/socketio", transports: ["websocket", "polling"], reconnection: true });

    socket.on("connect", () => {
      socket.emit("cliente:hello", { op, token, userAgent: "AtlasDesktop/1.0 (" + navigator.platform + ")" });
      if (stream) anunciarPartilha();
    });

    socket.on("cliente:sessao", (d) => {
      sessaoPronta = true;
      if (d && d.token) { token = d.token; localStorage.setItem("atlas_token_" + op, d.token); }
      anunciarPartilha();
    });

    socket.on("cliente:erro", (d) => setStatus("Erro: " + ((d && d.msg) || "servidor")));

    socket.on("tecnico:pronto", () => { tecnicoPronto = true; if (stream) criarOferta(); });

    socket.on("webrtc:answer", async (d) => {
      try {
        if (pc && d.sdp && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(d.sdp);
          remotoPronto = true;
          for (const c of iceQueue) { try { await pc.addIceCandidate(c); } catch (e) {} }
          iceQueue = [];
        }
      } catch (e) {}
    });

    socket.on("webrtc:ice", async (d) => {
      if (!d.candidate) return;
      if (pc && remotoPronto) { try { await pc.addIceCandidate(d.candidate); } catch (e) {} }
      else iceQueue.push(d.candidate);
    });

    // ---- Controlo remoto real (rato) ----
    socket.on("tecnico:clique", (d) => {
      const x = (d.x / 100) * screenSize.width;
      const y = (d.y / 100) * screenSize.height;
      try { window.atlas.tap(x, y); } catch (e) {}
    });
    socket.on("tecnico:gesto", (d) => {
      const pts = (d.pontos || []).map((p) => ({ x: (p.x / 100) * screenSize.width, y: (p.y / 100) * screenSize.height }));
      try { window.atlas.gesture(pts, d.duracao || 0); } catch (e) {}
    });

    // Pedido de reconexão do técnico → recria a oferta (stream continua vivo, sem novo pedido)
    socket.on("cliente:pedir-reconexao", () => { if (stream) criarOferta(); });
  }

  function anunciarPartilha() {
    if (!socket) return;
    if (sessaoPronta) socket.emit("cliente:partilhar", { ativo: true });
    else setTimeout(anunciarPartilha, 150);
  }

  async function criarOferta() {
    try {
      if (pc) { try { pc.close(); } catch (e) {} }
      iceQueue = []; remotoPronto = false;
      pc = new RTCPeerConnection(rtcConfig);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc:ice", { candidate: e.candidate }); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { sdp: pc.localDescription });
    } catch (e) {}
  }

  function pararTudo() {
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (pc) pc.close(); } catch (e) {}
    try { if (socket) { socket.emit("cliente:partilhar", { ativo: false }); socket.disconnect(); } } catch (e) {}
    stream = null; pc = null; socket = null;
    sessaoPronta = false; tecnicoPronto = false; remotoPronto = false;
    ativo = false;
    btn.textContent = "CONECTAR";
    btn.classList.remove("stop");
    setStatus("Desligado. Clique em CONECTAR para voltar a ligar.");
  }

  btn.addEventListener("click", () => { if (ativo) pararTudo(); else conectar(); });
})();
