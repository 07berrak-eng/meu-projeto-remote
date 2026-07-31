/* global io */
(function () {
  const API = location.origin + "/api";
  const el = (id) => document.getElementById(id);

  let token = localStorage.getItem("atlas_tec_token") || null;
  let socket = null;
  let linkId = null;
  let email = null;
  let role = null;
  let contasCache = [];
  let sessoes = [];

  let pcs = {};              // sessaoId -> { pc, stream, remotoPronto, iceQueue }
  let sessaoAtiva = null;    // sessão aberta no modal
  let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  const iceReady = fetch(API + "/ice")
    .then((r) => r.json())
    .then((c) => { if (c && c.iceServers) rtcConfig = c; })
    .catch(() => {});

  // ---------- Auth ----------
  async function api(caminho, opcoes = {}) {
    const res = await fetch(API + caminho, {
      ...opcoes,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(opcoes.headers || {}),
      },
    });
    if (!res.ok) {
      const dados = await res.json().catch(() => ({}));
      throw new Error(dados.detail || "Erro de ligação.");
    }
    return res.json();
  }

  el("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    el("login-erro").textContent = "";
    try {
      const dados = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: el("in-email").value, password: el("in-pass").value }),
      });
      token = dados.token;
      email = dados.email;
      linkId = dados.linkId;
      role = dados.role;
      localStorage.setItem("atlas_tec_token", token);
      iniciarApp();
    } catch (err) {
      el("login-erro").textContent = err.message;
    }
  });

  function sair() {
    localStorage.removeItem("atlas_tec_token");
    if (socket) socket.disconnect();
    location.reload();
  }
  el("btn-sair").addEventListener("click", sair);

  // ---------- App ----------
  async function iniciarApp() {
    try {
      const eu = await api("/auth/me");
      email = eu.email; linkId = eu.linkId; role = eu.role;
    } catch (e) { sair(); return; }

    el("tela-login").classList.add("oculto");
    el("tela-app").classList.remove("oculto");
    el("lbl-operador").textContent = email;
    const link = location.origin + "/cliente.html?op=" + linkId;
    el("link-cliente").textContent = link;

    if (role === "admin") {
      el("aba-contas").classList.remove("oculto");
      carregarContas();
    }

    ligarSocket();
    try { sessoes = await api("/sessoes"); render(); } catch (e) {}
  }

  function ligarSocket() {
    socket = window.io(location.origin, { path: "/api/socketio", transports: ["websocket", "polling"], auth: { token } });
    socket.on("sessoes:atualizar", (lista) => { sessoes = lista || []; render(); });
    socket.on("tecnico:erro", (d) => alert(d && d.msg));
    socket.on("webrtc:offer", aoReceberOferta);
    socket.on("webrtc:ice", async (d) => {
      if (!d.candidate) return;
      const entry = pcs[d.sessaoId];
      if (!entry) return;
      if (entry.pc && entry.remotoPronto) {
        try { await entry.pc.addIceCandidate(d.candidate); } catch (e) {}
      } else {
        entry.iceQueue.push(d.candidate);
      }
    });
  }

  // ---------- CRM render ----------
  function esc(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function dataFmt(iso) { try { return new Date(iso).toLocaleString("pt-PT"); } catch (e) { return iso; } }
  function dispositivo(ua) {
    if (!ua) return "Dispositivo desconhecido";
    if (/iphone|ipad/i.test(ua)) return "iPhone/iPad";
    if (/android/i.test(ua)) return "Android";
    if (/windows/i.test(ua)) return "Windows";
    if (/mac/i.test(ua)) return "Mac";
    if (/linux/i.test(ua)) return "Linux";
    return "Dispositivo";
  }

  function cartao(s) {
    const nome = s.nome || dispositivo(s.userAgent);
    const thumb = s.online ? `<div class="thumb-wrap" data-testid="thumb-wrap-${s.id}">
        <video id="thumb-${s.id}" class="thumb-video" muted autoplay playsinline data-ver="${s.id}" data-testid="thumb-video-${s.id}"></video>
        <div class="thumb-espera" id="thumb-espera-${s.id}" data-testid="thumb-espera-${s.id}">${s.aPartilhar ? "A ligar ao ecrã…" : "Ligado — sem partilha"}</div>
      </div>` : "";
    const selos = [
      s.online ? '<span class="selo on">Online</span>' : '<span class="selo off">Offline</span>',
      s.aPartilhar ? '<span class="selo share">A partilhar</span>' : "",
    ].join("");
    let encaminhar = "";
    if (role === "admin") {
      const opts = contasCache
        .filter((c) => c.email !== email)
        .map((c) => `<option value="${esc(c.email)}">${esc(c.email)}${c.role === "admin" ? " (admin)" : ""}</option>`)
        .join("");
      encaminhar = `<div class="encaminhar">
        <span class="encaminhar-lbl">Encaminhar para:</span>
        <select class="sel-encaminhar" data-encaminhar="${s.id}" data-testid="encaminhar-${s.id}">
          <option value="">Escolher técnico…</option>${opts}
        </select>
      </div>`;
    }
    return `<div class="cartao-sessao" data-testid="sessao-${s.id}">
      <div class="cab"><span class="${s.online ? "ponto-online" : "ponto-offline"}"></span>
        <span class="nome">${esc(nome)}</span></div>
      ${thumb}
      <div class="disp">${esc(dispositivo(s.userAgent))} · <span style="opacity:.7">${esc(s.userAgent || "")}</span></div>
      <div class="meta">Início: ${dataFmt(s.inicio)}</div>
      <div class="selos">${selos}</div>
      ${encaminhar}
      <div class="acoes">
        <button class="ver" data-ver="${s.id}" data-testid="btn-ver-${s.id}">Ver / Reconectar</button>
        <button data-renomear="${s.id}" data-testid="btn-renomear-${s.id}">Renomear</button>
        <button class="apagar" data-apagar="${s.id}" data-testid="btn-apagar-${s.id}">Apagar</button>
      </div>
    </div>`;
  }

  function render() {
    const online = sessoes.filter((s) => s.online);
    const hist = sessoes.filter((s) => !s.online);
    el("conta-online").textContent = online.length;
    el("conta-hist").textContent = hist.length;
    el("grelha-online").innerHTML = online.map(cartao).join("");
    el("grelha-hist").innerHTML = hist.map(cartao).join("");
    el("vazio-online").classList.toggle("oculto", online.length > 0);
    el("vazio-hist").classList.toggle("oculto", hist.length > 0);
    sincronizar();
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-ver],[data-renomear],[data-apagar]");
    if (!t) return;
    if (t.dataset.ver) abrirVer(t.dataset.ver);
    else if (t.dataset.renomear) {
      const s = sessoes.find((x) => x.id === t.dataset.renomear);
      const nome = prompt("Nome para esta sessão (só você o vê):", s ? s.nome : "");
      if (nome !== null) { try { await api("/sessoes/" + t.dataset.renomear, { method: "PATCH", body: JSON.stringify({ nome }) }); } catch (er) { alert(er.message); } }
    } else if (t.dataset.apagar) {
      if (confirm("Apagar esta sessão?")) { try { await api("/sessoes/" + t.dataset.apagar, { method: "DELETE" }); } catch (er) { alert(er.message); } }
    }
  });

  document.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-encaminhar]");
    if (!sel) return;
    const sessaoId = sel.dataset.encaminhar;
    const para = sel.value;
    if (!para) return;
    if (!confirm("Encaminhar esta sessão para " + para + "?")) { sel.value = ""; return; }
    try {
      await api("/admin/encaminhar", { method: "POST", body: JSON.stringify({ sessaoId, para }) });
    } catch (er) { alert(er.message); sel.value = ""; }
  });

  el("btn-limpar").addEventListener("click", async () => {
    if (confirm("Apagar TODAS as sessões deste operador?")) {
      try { await api("/sessoes", { method: "DELETE" }); } catch (er) { alert(er.message); }
    }
  });

  el("btn-copiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el("link-cliente").textContent); el("btn-copiar").textContent = "Copiado ✓"; setTimeout(() => (el("btn-copiar").textContent = "Copiar link"), 1600); } catch (e) {}
  });

  // ---------- Abas ----------
  document.querySelectorAll(".aba").forEach((a) => a.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((x) => x.classList.remove("ativa"));
    a.classList.add("ativa");
    const aba = a.dataset.aba;
    el("painel-sessoes").classList.toggle("oculto", aba !== "sessoes");
    el("painel-config").classList.toggle("oculto", aba !== "config");
    el("painel-contas").classList.toggle("oculto", aba !== "contas");
  }));

  // ---------- Gestão de contas (admin) ----------
  async function carregarContas() {
    try {
      const d = await api("/admin/utilizadores");
      const contas = d.contas || [];
      contasCache = contas;
      el("conta-total").textContent = contas.length;
      el("lista-contas").innerHTML = contas.map((c) => {
        const ehAdmin = c.role === "admin";
        const linkOp = location.origin + "/cliente.html?op=" + c.linkId;
        const botao = (ehAdmin || c.email === email)
          ? `<span class="conta-tag">${ehAdmin ? "ADMIN" : "você"}</span>`
          : `<button class="btn-apagar-conta" data-apagar-conta="${esc(c.email)}" data-testid="apagar-conta-${esc(c.email)}">Apagar</button>`;
        return `<div class="conta-linha" data-testid="conta-${esc(c.email)}">
          <div class="conta-info">
            <span class="conta-email">${esc(c.email)}</span>
            <span class="conta-link">${esc(linkOp)}</span>
          </div>
          ${botao}
        </div>`;
      }).join("");
    } catch (err) {
      el("lista-contas").innerHTML = `<div class="vazio">${esc(err.message)}</div>`;
    }
    render();
  }

  el("form-conta").addEventListener("submit", async (e) => {
    e.preventDefault();
    el("conta-msg").textContent = ""; el("conta-erro").textContent = "";
    try {
      const r = await api("/admin/utilizadores", {
        method: "POST",
        body: JSON.stringify({ email: el("in-novo-email").value, password: el("in-nova-senha").value }),
      });
      el("conta-msg").textContent = "Conta criada ✓ — " + r.conta.email;
      el("form-conta").reset();
      carregarContas();
    } catch (err) { el("conta-erro").textContent = err.message; }
  });

  el("lista-contas").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-apagar-conta]");
    if (!btn) return;
    const alvo = btn.dataset.apagarConta;
    if (!confirm("Apagar a conta " + alvo + "? Esta ação é irreversível.")) return;
    try {
      await api("/admin/utilizadores/" + encodeURIComponent(alvo), { method: "DELETE" });
      carregarContas();
    } catch (err) { alert(err.message); }
  });

  el("form-senha").addEventListener("submit", async (e) => {
    e.preventDefault();
    el("senha-msg").textContent = "";
    try {
      await api("/auth/senha", { method: "POST", body: JSON.stringify({ atual: el("in-atual").value, nova: el("in-nova").value }) });
      el("senha-msg").textContent = "Palavra-passe atualizada ✓";
      el("form-senha").reset();
    } catch (err) { el("senha-msg").style.color = "#ff8a8a"; el("senha-msg").textContent = err.message; }
  });

  // ---------- Ver ecrã / Miniaturas (WebRTC multi-peer) ----------
  function conectar(id) {
    if (pcs[id]) return;
    pcs[id] = { pc: null, stream: null, remotoPronto: false, iceQueue: [] };
    socket.emit("tecnico:ver", { sessaoId: id });
    socket.emit("tecnico:pedir-reconexao", { sessaoId: id });
  }

  function desconectar(id) {
    const entry = pcs[id];
    if (!entry) return;
    if (entry.pc) { try { entry.pc.close(); } catch (e) {} }
    delete pcs[id];
    if (socket) socket.emit("tecnico:parar", { sessaoId: id });
  }

  function aplicarStream(id) {
    const entry = pcs[id];
    if (!entry || !entry.stream) return;
    const tv = document.getElementById("thumb-" + id);
    if (tv) {
      if (tv.srcObject !== entry.stream) { tv.srcObject = entry.stream; tv.play().catch(() => {}); }
      tv.classList.add("ativa");
      const esp = document.getElementById("thumb-espera-" + id);
      if (esp) esp.classList.add("oculto");
    }
    if (sessaoAtiva === id) {
      const v = el("video-ecra");
      if (v.srcObject !== entry.stream) { v.srcObject = entry.stream; v.play().catch(() => {}); }
      el("video-espera").classList.add("oculto");
    }
  }

  function sincronizar() {
    if (!socket) return;
    const porId = {};
    sessoes.forEach((s) => (porId[s.id] = s));
    // liga automaticamente às sessões online que estão a partilhar (miniaturas)
    sessoes.forEach((s) => { if (s.online && s.aPartilhar && !pcs[s.id]) conectar(s.id); });
    // desliga as que já não se aplicam (exceto a que está aberta no modal)
    Object.keys(pcs).forEach((id) => {
      const s = porId[id];
      const manter = s && s.online && s.aPartilhar;
      if (!manter && id !== sessaoAtiva) desconectar(id);
    });
    // reanexa os streams aos vídeos (o innerHTML foi reconstruído)
    Object.keys(pcs).forEach((id) => aplicarStream(id));
  }

  function abrirVer(id) {
    sessaoAtiva = id;
    const s = sessoes.find((x) => x.id === id);
    el("modal-titulo").textContent = (s && (s.nome || dispositivo(s.userAgent))) || "Ecrã do cliente";
    el("modal-ver").classList.remove("oculto");
    const entry = pcs[id];
    if (entry && entry.stream) {
      el("video-espera").classList.add("oculto");
      const v = el("video-ecra"); v.srcObject = entry.stream; v.play().catch(() => {});
    } else {
      el("video-ecra").srcObject = null;
      el("video-espera").classList.remove("oculto");
      el("espera-txt").textContent = s && s.aPartilhar ? "A ligar ao ecrã do cliente…" : "À espera que o cliente toque em COMEÇAR / RECONECTAR…";
      if (s && s.online) conectar(id);
    }
  }

  function pedirReconexao() {
    if (!sessaoAtiva) return;
    socket.emit("tecnico:pedir-reconexao", { sessaoId: sessaoAtiva });
    const b = el("btn-pedir-reconexao");
    b.textContent = "Pedido enviado ✓";
    setTimeout(() => (b.textContent = "🔄 Pedir reconexão"), 1800);
  }

  async function aoReceberOferta(d) {
    const id = d && d.sessaoId;
    if (!id || !d.sdp) return;
    const entry = pcs[id];
    if (!entry) return;
    try {
      await iceReady;
      if (entry.pc) { try { entry.pc.close(); } catch (e) {} }
      entry.iceQueue = [];
      entry.remotoPronto = false;
      const pc = new RTCPeerConnection(rtcConfig);
      entry.pc = pc;
      pc.ontrack = (ev) => {
        if (entry.pc !== pc) return;
        entry.stream = ev.streams[0];
        aplicarStream(id);
      };
      pc.onicecandidate = (ev) => { if (ev.candidate && entry.pc === pc) socket.emit("webrtc:ice", { sessaoId: id, candidate: ev.candidate }); };
      pc.oniceconnectionstatechange = () => {
        if (entry.pc !== pc) return;
        const st = pc.iceConnectionState;
        if ((st === "failed" || st === "disconnected") && sessaoAtiva === id) {
          el("espera-txt").textContent = "Ligação instável. A tentar reconectar…";
          el("video-espera").classList.remove("oculto");
        }
      };
      await pc.setRemoteDescription(d.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      entry.remotoPronto = true;
      for (const c of entry.iceQueue) { try { await pc.addIceCandidate(c); } catch (e) {} }
      entry.iceQueue = [];
      socket.emit("webrtc:answer", { sessaoId: id, sdp: pc.localDescription });
    } catch (e) { console.warn(e); }
  }

  el("video-ecra").addEventListener("click", (e) => {
    if (!sessaoAtiva) return;
    const v = e.currentTarget;
    const rect = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    let x, y;
    if (vw && vh) {
      // Mapeamento preciso considerando as barras pretas (object-fit: contain)
      const escala = Math.min(rect.width / vw, rect.height / vh);
      const larg = vw * escala, alt = vh * escala;
      const offX = (rect.width - larg) / 2, offY = (rect.height - alt) / 2;
      const cx = e.clientX - rect.left - offX;
      const cy = e.clientY - rect.top - offY;
      if (cx < 0 || cy < 0 || cx > larg || cy > alt) return; // clicou na barra preta
      x = (cx / larg) * 100;
      y = (cy / alt) * 100;
    } else {
      x = ((e.clientX - rect.left) / rect.width) * 100;
      y = ((e.clientY - rect.top) / rect.height) * 100;
    }
    // Feedback imediato no ecrã do técnico
    const m = el("marca-clique-tec");
    m.style.left = (e.clientX - rect.left) + "px";
    m.style.top = (e.clientY - rect.top) + "px";
    m.classList.remove("oculto");
    m.style.animation = "none";
    void m.offsetWidth;
    m.style.animation = "toqueFade 1.5s ease-out forwards";
    socket.emit("tecnico:clique", { sessaoId: sessaoAtiva, x, y });
  });

  el("btn-pedir-reconexao").addEventListener("click", pedirReconexao);

  el("btn-fullscreen").addEventListener("click", () => {
    const caixa = el("video-caixa");
    if (!document.fullscreenElement) {
      (caixa.requestFullscreen || caixa.webkitRequestFullscreen || function () {}).call(caixa);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  });

  function fecharModal() {
    const id = sessaoAtiva;
    sessaoAtiva = null;
    el("modal-ver").classList.add("oculto");
    el("video-ecra").srcObject = null;
    // manter a ligação viva se ainda serve de miniatura; caso contrário, desligar
    const s = sessoes.find((x) => x.id === id);
    if (id && !(s && s.online && s.aPartilhar)) desconectar(id);
  }
  el("btn-fechar-modal").addEventListener("click", fecharModal);

  // ---------- Arranque ----------
  if (token) iniciarApp();
})();
