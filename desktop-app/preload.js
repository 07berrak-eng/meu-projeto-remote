// Ponte segura entre o renderer e o processo principal
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("atlas", {
  screenSize: () => ipcRenderer.invoke("screen-size"),
  temControlo: () => ipcRenderer.invoke("tem-controlo"),
  tap: (x, y) => ipcRenderer.send("control-tap", { x, y }),
  gesture: (pontos, duracao) => ipcRenderer.send("control-gesture", { pontos, duracao }),
});
