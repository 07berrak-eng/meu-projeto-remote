// Background service worker (MV3).
// - Gere o documento offscreen que mantém a ligação Socket.io.
// - Recebe os cliques do técnico e executa cliques REAIS via chrome.debugger,
//   além de mandar o content script desenhar o círculo por cima de qualquer site.

let sessaoInfo = null; // { server, op, token, sessaoId, operador, ligado }
const tabsAnexadas = new Set();

async function garantirOffscreen() {
  const existe = await chrome.offscreen.hasDocument?.();
  if (existe) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Manter a ligação em tempo real ao servidor de suporte Atlas.",
  });
}

async function ativarSuporte(cfg) {
  sessaoInfo = { ...cfg, ligado: false };
  await chrome.storage.local.set({ atlasSessao: cfg });
  await garantirOffscreen();
  // pequeno atraso para o documento offscreen registar o listener
  setTimeout(() => {
    chrome.runtime.sendMessage({ destino: "offscreen", tipo: "ligar", cfg }).catch(() => {});
  }, 300);
}

async function desativarSuporte() {
  chrome.runtime.sendMessage({ destino: "offscreen", tipo: "desligar" }).catch(() => {});
  for (const tabId of Array.from(tabsAnexadas)) desanexar(tabId);
  sessaoInfo = null;
  await chrome.storage.local.remove("atlasSessao");
}

function anexar(tabId) {
  return new Promise((resolve) => {
    if (tabsAnexadas.has(tabId)) return resolve(true);
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) return resolve(false);
      tabsAnexadas.add(tabId);
      resolve(true);
    });
  });
}

function desanexar(tabId) {
  if (!tabsAnexadas.has(tabId)) return;
  chrome.debugger.detach({ tabId }, () => { tabsAnexadas.delete(tabId); });
}

function comando(tabId, metodo, params) {
  return new Promise((resolve) => {
    chrome.debugger.sendCommand({ tabId }, metodo, params, () => resolve());
  });
}

async function clicarReal(tabId, vx, vy) {
  const ok = await anexar(tabId);
  if (!ok) return;
  await comando(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: vx, y: vy });
  await comando(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: vx, y: vy, button: "left", clickCount: 1 });
  await comando(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: vx, y: vy, button: "left", clickCount: 1 });
}

async function tratarClique(x, y) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  console.log("[Atlas bg] clique", x, y, "tab", tab && tab.id, tab && tab.url);
  if (!tab || !tab.id || (tab.url || "").startsWith("chrome")) return;
  chrome.tabs.sendMessage(tab.id, { destino: "content", tipo: "clique", x, y }, (resp) => {
    if (chrome.runtime.lastError) { console.log("[Atlas bg] sem content script na aba:", chrome.runtime.lastError.message); return; }
    if (!resp) return;
    console.log("[Atlas bg] resposta content", resp);
    if (resp.dentro) clicarReal(tab.id, Math.round(resp.vx), Math.round(resp.vy));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  // Do content script da página do cliente (cliente.html) -> ativar suporte
  if (msg.destino === "background" && msg.tipo === "sessao-detectada") {
    ativarSuporte({ server: msg.server, op: msg.op, token: msg.token });
    return;
  }
  // Do popup
  if (msg.destino === "background" && msg.tipo === "estado?") {
    sendResponse(sessaoInfo || { ligado: false });
    return true;
  }
  if (msg.destino === "background" && msg.tipo === "desativar") {
    desativarSuporte();
    return;
  }
  // Do offscreen
  if (msg.destino === "background") {
    if (msg.tipo === "offscreen-pronto" && sessaoInfo) {
      chrome.runtime.sendMessage({ destino: "offscreen", tipo: "ligar", cfg: sessaoInfo }).catch(() => {});
    }
    if (msg.tipo === "clique") tratarClique(msg.x, msg.y);
    if (msg.tipo === "estado" && sessaoInfo) sessaoInfo.ligado = msg.ligado;
    if (msg.tipo === "sessao" && sessaoInfo) { sessaoInfo.sessaoId = msg.sessaoId; sessaoInfo.operador = msg.operador; }
  }
});

// Limpar debugger se a tab fechar
chrome.tabs.onRemoved.addListener((tabId) => desanexar(tabId));
chrome.debugger.onDetach.addListener((source) => { if (source.tabId) tabsAnexadas.delete(source.tabId); });

// Recuperar sessão guardada ao reiniciar o service worker
chrome.storage.local.get("atlasSessao").then((r) => { if (r && r.atlasSessao) ativarSuporte(r.atlasSessao); });
