// Content script injetado em TODOS os sites.
// 1) Na página do cliente (cliente.html) lê a sessão e envia ao background.
// 2) Em qualquer site: recebe o clique do técnico (% do ecrã inteiro), calcula a
//    posição dentro do viewport desta aba e desenha o círculo laranja/vermelho.

(function () {
  // ---- Ponte com a página do cliente (cliente.html) ----
  function detectarSessao() {
    const bridge = document.getElementById("atlas-ext-bridge");
    if (!bridge) return;
    const op = bridge.getAttribute("data-op");
    const token = bridge.getAttribute("data-token");
    const server = bridge.getAttribute("data-server");
    if (op && token && server) {
      chrome.runtime.sendMessage({ destino: "background", tipo: "sessao-detectada", op, token, server }).catch(() => {});
    }
  }
  detectarSessao();
  const obs = new MutationObserver(detectarSessao);
  try { obs.observe(document.documentElement, { attributes: true, childList: true, subtree: true }); } catch (e) {}

  // ---- Círculo do técnico ----
  function estilo() {
    if (document.getElementById("atlas-ext-style")) return;
    const s = document.createElement("style");
    s.id = "atlas-ext-style";
    s.textContent = `
      .atlas-ext-circulo{position:fixed;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;
        border:4px solid #ff3b3b;background:rgba(255,90,40,.28);
        box-shadow:0 0 0 3px rgba(255,255,255,.65),0 8px 22px rgba(226,59,59,.5);
        pointer-events:none;z-index:2147483647;animation:atlasExtFade 1.5s ease-out forwards;}
      @keyframes atlasExtFade{0%{transform:scale(.4);opacity:0}15%{transform:scale(1);opacity:1}100%{transform:scale(1.5);opacity:0}}`;
    (document.head || document.documentElement).appendChild(s);
  }

  function desenharCirculo(vx, vy) {
    estilo();
    const c = document.createElement("div");
    c.className = "atlas-ext-circulo";
    c.style.left = vx + "px";
    c.style.top = vy + "px";
    (document.body || document.documentElement).appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }

  // Converte % do ecrã inteiro -> posição no viewport desta aba.
  // Requer que o cliente esteja a partilhar o ECRÃ INTEIRO.
  function mapear(xPct, yPct) {
    const sx = (xPct / 100) * screen.width;
    const sy = (yPct / 100) * screen.height;
    // Topo do viewport no ecrã = posição da janela + altura do "chrome" (abas/barra de endereço).
    const chromeTop = Math.max(0, window.outerHeight - window.innerHeight);
    const vpLeft = window.screenX;
    const vpTop = window.screenY + chromeTop;
    const vx = sx - vpLeft;
    const vy = sy - vpTop;
    const margem = 2;
    const dentro = vx >= -margem && vy >= -margem
      && vx <= window.innerWidth + margem && vy <= window.innerHeight + margem;
    return { dentro, vx, vy };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.destino === "content" && msg.tipo === "clique") {
      const r = mapear(msg.x, msg.y);
      console.log("[Atlas content] clique %", msg.x, msg.y, "->", r, "screen", screen.width, screen.height, "winpos", window.screenX, window.screenY, "inner", window.innerWidth, window.innerHeight);
      if (r.dentro) desenharCirculo(r.vx, r.vy);
      sendResponse(r);
      return true;
    }
  });
})();
