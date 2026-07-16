import { useEffect } from "react";
import "@/App.css";

function App() {
  useEffect(() => {
    window.location.replace("/tecnico.html");
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f1720", color: "#e8eef3", fontFamily: "system-ui, sans-serif" }}>
      <a href="/tecnico.html" style={{ color: "#34a853", fontSize: "1.1rem" }} data-testid="ir-painel-link">
        A abrir o painel do técnico…
      </a>
    </div>
  );
}

export default App;
