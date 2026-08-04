/* global io */
(function () {
  const params = new URLSearchParams(location.search);
  let op = params.get("op");
  if (op) { try { localStorage.setItem("atlas_last_op", op); } catch (e) {} }
  else { op = localStorage.getItem("atlas_last_op"); }
  const chaveToken = "atlas_token_" + (op || "x");
  let token = localStorage.getItem(chaveToken) || params.get("token") || null;

  const el = (id) => document.getElementById(id);
  const telaInicio = el("tela-inicio");
  const telaAtivo = el("tela-ativo");
  const telaErro = el("tela-erro");
  const telaReconectar = el("tela-reconectar");
  const telaNavegador = el("tela-navegador");
  const txtErro = el("txt-erro");

  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const ehAndroid = /android/i.test(navigator.userAgent);
  const emStandalonePWA = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  // APK nativo (mais recente). O parâmetro ?v força o download da versão nova.
  const APK_URL = "/atlas-suporte.apk?v=6";
  function baixarApp() { window.location.href = APK_URL; }

  // Deteção de sistema para o computador
  const ehWindows = /windows|win32|win64/i.test(navigator.userAgent);
  const ehMac = (/mac os x|macintosh/i.test(navigator.userAgent)) && !ehIOS;
  const ehLinux = (/linux/i.test(navigator.userAgent)) && !ehAndroid;
  const ehDesktop = !ehAndroid && !ehIOS;

  // Instaladores da app Desktop (preenchido após ligar a compilação na nuvem — GitHub).
  // Exemplo: "utilizador/repositorio"
  const REPO_SLUG = "07berrak-eng/meu-projeto-remote";
  function urlRelease(ficheiro) {
    return REPO_SLUG ? `https://github.com/${REPO_SLUG}/releases/latest/download/${ficheiro}` : "";
  }
  const DOWNLOADS = {
    win: urlRelease("Conexao-Cripto-Setup.exe"),
    mac: urlRelease("Conexao-Cripto.dmg"),
    linux: urlRelease("Conexao-Cripto.AppImage"),
  };

  let socket, pc, stream;
  let sessaoId = null;
  let sessaoPronta = false;
  let tecnicoPronto = false;
  let iceQueue = [];
  let remotoPronto = false;

  let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  const iceReady = fetch(location.origin + "/api/ice")
    .then((r) => r.json())
    .then((c) => { if (c && c.iceServers) rtcConfig = c; })
    .catch(() => {});

  function mostrar(tela) {
    [telaInicio, telaAtivo, telaErro, telaReconectar, telaNavegador].forEach((t) => t && t.classList.add("oculto"));
    tela.classList.remove("oculto");
  }

  function mostrarReconectar(titulo, msg) {
    if (stream) return; // já está a partilhar
    el("reconectar-titulo").textContent = titulo;
    el("reconectar-msg").textContent = msg;
    mostrar(telaReconectar);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
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
  socket = window.io(location.origin, { path: "/api/socketio", transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    socket.emit("cliente:hello", { op, token, userAgent: navigator.userAgent });
    if (stream) partilharQuando(true);
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
      if (pc && d.sdp && pc.signalingState === "have-local-offer") {
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

  socket.on("cliente:pedir-reconexao", () => {
    mostrarReconectar("Reconectar?", "O técnico pediu para retomar a partilha do seu ecrã. Toque em RECONECTAR para continuar.");
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

  // Anuncia a partilha ao servidor só depois do handshake cliente:sessao (evita corrida com cliente:hello)
  function partilharQuando(ativo) {
    if (!ativo || sessaoPronta) { socket.emit("cliente:partilhar", { ativo }); return; }
    const iv = setInterval(() => {
      if (sessaoPronta) { clearInterval(iv); socket.emit("cliente:partilhar", { ativo: true }); }
    }, 100);
    setTimeout(() => clearInterval(iv), 5000);
  }

  // Abre a página no navegador (Chrome), onde a captura de ecrã funciona no Android.
  function urlNoNavegador() {
    return location.origin + "/cliente.html?op=" + encodeURIComponent(op || "") + "&nav=1";
  }

  function mostrarFallbackNavegador() {
    mostrar(telaNavegador);
  }

  async function comecar() {
    // iOS/Safari não suporta partilha de ecrã por web (nem em app instalada)
    if (ehIOS) {
      erro("No iPhone/iPad, a partilha de ecrã pela web não é suportada. Utilize um telemóvel Android ou um computador.");
      return;
    }
    const md = navigator.mediaDevices;
    // API de captura indisponível (comum na app instalada em standalone no Android) -> recurso ao Chrome
    if (!md || !md.getDisplayMedia) {
      mostrarFallbackNavegador();
      return;
    }
    try {
      // Constraints mínimas: mais compatíveis com o Android (algumas versões rejeitam cursor/frameRate)
      stream = await md.getDisplayMedia({ video: true, audio: false });
      // Tenta baixar o frame rate (não crítico se falhar)
      try { await stream.getVideoTracks()[0].applyConstraints({ frameRate: 10 }); } catch (e) {}
      mostrar(telaAtivo);
      await pedirWakeLock();
      partilharQuando(true);
      stream.getVideoTracks()[0].addEventListener("ended", partilhaInterrompida);
      if (tecnicoPronto) criarOferta();
    } catch (e) {
      console.warn("getDisplayMedia falhou:", e && e.name, e && e.message);
      const nome = e && e.name;
      if (nome === "NotAllowedError" || nome === "AbortError") {
        erro("A partilha foi cancelada. Toque em “Tentar novamente” e, no aviso do telemóvel, escolha o ecrã inteiro e toque em “Começar agora”.");
      } else if (nome === "NotSupportedError" || nome === "TypeError" || nome === "InvalidStateError" || nome === "NotReadableError") {
        // A app instalada bloqueou a captura -> abrir no Chrome
        mostrarFallbackNavegador();
      } else {
        erro("Não foi possível iniciar a partilha (" + (nome || "erro") + "). Abra este link no Chrome e permita a gravação do ecrã.");
      }
    }
  }

  async function criarOferta() {
    try {
      await iceReady;
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

  function limparRecursos() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    libertarWakeLock();
    socket.emit("cliente:partilhar", { ativo: false });
  }

  function pararPartilha() {
    limparRecursos();
    mostrar(telaInicio);
  }

  // Chamado quando a captura termina sozinha (ecrã adormeceu, sistema parou, etc.)
  function partilhaInterrompida() {
    limparRecursos();
    mostrarReconectar(
      "Partilha interrompida",
      "A partilha do seu ecrã parou (o ecrã pode ter adormecido). Toque em RECONECTAR para continuar."
    );
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
  el("btn-reconectar").addEventListener("click", comecar);
  el("btn-parar").addEventListener("click", pararPartilha);

  // Instalar a app nativa (Android)
  const btnInstalarApp = el("btn-instalar");
  if (btnInstalarApp) btnInstalarApp.addEventListener("click", baixarApp);
  const btnInstalarNav = el("btn-instalar-nav");
  if (btnInstalarNav) btnInstalarNav.addEventListener("click", baixarApp);

  // Em Android (fora da PWA instalada): destacar apenas o botão INSTALAR APP.
  if (ehAndroid && !emStandalonePWA) {
    const t = el("inicio-titulo"); if (t) t.innerHTML = "Suporte em direto<br/>com a app Conexão Cripto";
    const p = el("inicio-texto"); if (p) p.textContent = "Instale a aplicação Conexão Cripto para o técnico ver o seu ecrã e o ajudar a resolver o problema, com toques guiados em direto.";
    const bc = el("btn-comecar"); if (bc) bc.classList.add("oculto");
    if (btnInstalarApp) btnInstalarApp.classList.remove("oculto");
    const aviso = document.querySelector(".aviso"); if (aviso) aviso.classList.add("oculto");
    const lim = document.querySelector(".limitacoes"); if (lim) lim.classList.add("oculto");
  }

  // No computador: mostrar a secção "Instalar a app de computador" (opcional).
  if (ehDesktop) {
    const cx = el("app-desktop");
    if (cx) cx.classList.remove("oculto");
    const mapa = { win: el("dl-win"), mac: el("dl-mac"), linux: el("dl-linux") };
    let algum = false;
    Object.keys(mapa).forEach((k) => {
      const a = mapa[k]; if (!a) return;
      const url = DOWNLOADS[k];
      if (url) { a.href = url; algum = true; }
      else { a.classList.add("off"); a.removeAttribute("href"); }
    });
    // Realça o sistema detetado
    const detetado = ehWindows ? "win" : ehMac ? "mac" : ehLinux ? "linux" : null;
    if (detetado && mapa[detetado]) mapa[detetado].classList.add("realce");
    // Se ainda não há instaladores publicados
    if (!algum) {
      const nota = el("ad-indisp");
      if (nota) {
        nota.textContent = "Os instaladores para computador estarão disponíveis em breve. Entretanto, no computador basta clicar em COMEÇAR para partilhar o ecrã — não precisa de instalar nada.";
        nota.classList.remove("oculto");
      }
    }
  }

  // ---- PWA: service worker (offline/atalho) ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
