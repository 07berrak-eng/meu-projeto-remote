/* global io */
(function () {
  const API = location.origin + "/api";
  const el = (id) => document.getElementById(id);

  let token = localStorage.getItem("atlas_tec_token") || null;
  let socket = null;
  let linkId = null;
  let email = null;
  let sessoes = [];

  let pc = null;
  let sessaoAtiva = null;
  const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

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
      email = eu.email; linkId = eu.linkId;
    } catch (e) { sair(); return; }

    el("tela-login").classList.add("oculto");
    el("tela-app").classList.remove("oculto");
    el("lbl-operador").textContent = email;
    const link = location.origin + "/cliente.html?op=" + linkId;
    el("link-cliente").textContent = link;

    ligarSocket();
    try { sessoes = await api("/sessoes"); render(); } catch (e) {}
  }

  function ligarSocket() {
    socket = io(location.origin, { path: "/api/socketio", transports: ["websocket", "polling"], auth: { token } });
    socket.on("sessoes:atualizar", (lista) => { sessoes = lista || []; render(); });
    socket.on("tecnico:erro", (d) => alert(d && d.msg));
    socket.on("webrtc:offer", aoReceberOferta);
    socket.on("webrtc:ice", async (d) => {
      try { if (pc && d.candidate) await pc.addIceCandidate(d.candidate); } catch (e) {}
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
    const selos = [
      s.online ? '<span class="selo on">Online</span>' : '<span class="selo off">Offline</span>',
      s.aPartilhar ? '<span class="selo share">A partilhar</span>' : "",
    ].join("");
    return `<div class="cartao-sessao" data-testid="sessao-${s.id}">
      <div class="cab"><span class="${s.online ? "ponto-online" : "ponto-offline"}"></span>
        <span class="nome">${esc(nome)}</span></div>
      <div class="disp">${esc(dispositivo(s.userAgent))} · <span style="opacity:.7">${esc(s.userAgent || "")}</span></div>
      <div class="meta">Início: ${dataFmt(s.inicio)}</div>
      <div class="selos">${selos}</div>
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
  }

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
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
    const s = a.dataset.aba === "sessoes";
    el("painel-sessoes").classList.toggle("oculto", !s);
    el("painel-config").classList.toggle("oculto", s);
  }));

  el("form-senha").addEventListener("submit", async (e) => {
    e.preventDefault();
    el("senha-msg").textContent = "";
    try {
      await api("/auth/senha", { method: "POST", body: JSON.stringify({ atual: el("in-atual").value, nova: el("in-nova").value }) });
      el("senha-msg").textContent = "Palavra-passe atualizada ✓";
      el("form-senha").reset();
    } catch (err) { el("senha-msg").style.color = "#ff8a8a"; el("senha-msg").textContent = err.message; }
  });

  // ---------- Ver ecrã (WebRTC answerer) ----------
  function abrirVer(id) {
    sessaoAtiva = id;
    const s = sessoes.find((x) => x.id === id);
    el("modal-titulo").textContent = (s && (s.nome || dispositivo(s.userAgent))) || "Ecrã do cliente";
    el("video-espera").classList.remove("oculto");
    el("espera-txt").textContent = s && s.aPartilhar ? "A ligar ao ecrã do cliente…" : "À espera que o cliente toque em COMEÇAR…";
    el("modal-ver").classList.remove("oculto");
    socket.emit("tecnico:ver", { sessaoId: id });
  }

  async function aoReceberOferta(d) {
    if (!sessaoAtiva || !d.sdp) return;
    try {
      if (pc) { try { pc.close(); } catch (e) {} }
      pc = new RTCPeerConnection(rtcConfig);
      pc.ontrack = (ev) => {
        el("video-ecra").srcObject = ev.streams[0];
        el("video-espera").classList.add("oculto");
      };
      pc.onicecandidate = (ev) => { if (ev.candidate) socket.emit("webrtc:ice", { sessaoId: sessaoAtiva, candidate: ev.candidate }); };
      await pc.setRemoteDescription(d.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { sessaoId: sessaoAtiva, sdp: pc.localDescription });
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

  el("btn-fullscreen").addEventListener("click", () => {
    const caixa = el("video-caixa");
    if (!document.fullscreenElement) {
      (caixa.requestFullscreen || caixa.webkitRequestFullscreen || function () {}).call(caixa);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  });

  function fecharModal() {
    if (sessaoAtiva) socket.emit("tecnico:parar", { sessaoId: sessaoAtiva });
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    el("video-ecra").srcObject = null;
    sessaoAtiva = null;
    el("modal-ver").classList.add("oculto");
  }
  el("btn-fechar-modal").addEventListener("click", fecharModal);

  // ---------- Arranque ----------
  if (token) iniciarApp();
})();
