const $ = (id) => document.getElementById(id);

function render(estado) {
  const ligado = estado && estado.ligado;
  $("ponto").classList.toggle("on", !!ligado);
  if (ligado) {
    $("txt-estado").textContent = "Suporte ativo";
    $("info").innerHTML = "Ligado ao técnico <b>" + (estado.operador || "") + "</b>. O técnico já o pode orientar em <b>qualquer site</b> do navegador.";
    $("btn-desativar").style.display = "block";
  } else if (estado && (estado.op || estado.token)) {
    $("txt-estado").textContent = "A ligar…";
    $("info").textContent = "A estabelecer ligação ao servidor de suporte…";
    $("btn-desativar").style.display = "block";
  } else {
    $("txt-estado").textContent = "Sem sessão";
    $("info").textContent = "Abra o link de suporte que o técnico lhe enviou e inicie a partilha de ecrã. A extensão liga-se automaticamente.";
    $("btn-desativar").style.display = "none";
  }
}

chrome.runtime.sendMessage({ destino: "background", tipo: "estado?" }, (resp) => {
  render(resp || { ligado: false });
});

$("btn-desativar").addEventListener("click", () => {
  chrome.runtime.sendMessage({ destino: "background", tipo: "desativar" });
  render({ ligado: false });
});
