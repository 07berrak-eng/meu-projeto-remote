// Atlas Suporte Desktop — processo principal (Electron)
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require("electron");
const path = require("path");

// Módulo nativo de controlo remoto (rato/teclado). Pode não existir em builds sem binários nativos.
let nut = null;
try {
  nut = require("@nut-tree-fork/nut-js");
  if (nut && nut.mouse) nut.mouse.config.mouseSpeed = 4000;
  if (nut && nut.mouse) nut.mouse.config.autoDelayMs = 0;
} catch (e) {
  console.warn("Controlo remoto indisponível (nut-js não carregou):", e.message);
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 660,
    resizable: false,
    backgroundColor: "#0f1720",
    title: "Conexão Cripto",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Escolhe automaticamente o ECRÃ PRINCIPAL quando o renderer pede getDisplayMedia
  // (evita o seletor de janela — "só conectar").
  try {
    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        desktopCapturer
          .getSources({ types: ["screen"] })
          .then((sources) => {
            if (sources && sources.length) callback({ video: sources[0], audio: false });
            else callback({});
          })
          .catch(() => callback({}));
      },
      { useSystemPicker: false }
    );
  } catch (e) {
    console.warn("setDisplayMediaRequestHandler falhou:", e.message);
  }

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC: tamanho do ecrã e controlo remoto ----
ipcMain.handle("screen-size", () => {
  const d = screen.getPrimaryDisplay();
  // size em pontos; scaleFactor para converter em píxeis reais
  const s = d.size;
  return { width: s.width, height: s.height, scale: d.scaleFactor || 1 };
});

ipcMain.on("control-tap", async (_e, { x, y }) => {
  if (!nut) return;
  try {
    const { mouse, Point, Button } = nut;
    await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
    await mouse.click(Button.LEFT);
  } catch (err) {
    console.warn("tap:", err.message);
  }
});

ipcMain.on("control-gesture", async (_e, { pontos, duracao }) => {
  if (!nut || !pontos || pontos.length === 0) return;
  try {
    const { mouse, Point, Button } = nut;
    const p0 = pontos[0];
    await mouse.setPosition(new Point(Math.round(p0.x), Math.round(p0.y)));
    if (pontos.length === 1) {
      await mouse.click(Button.LEFT);
      return;
    }
    await mouse.pressButton(Button.LEFT);
    for (let i = 1; i < pontos.length; i++) {
      const p = pontos[i];
      await mouse.setPosition(new Point(Math.round(p.x), Math.round(p.y)));
    }
    await mouse.releaseButton(Button.LEFT);
  } catch (err) {
    console.warn("gesture:", err.message);
  }
});

ipcMain.handle("tem-controlo", () => !!nut);
