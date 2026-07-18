# Atlas Suporte Técnico — Extensão Chrome

## O que é
Extensão de apoio à ferramenta de suporte remoto Atlas. Durante uma sessão de
suporte, mostra o "círculo" de orientação do técnico e reproduz os cliques
indicados por ele em **qualquer site aberto no navegador**.

Funciona em conjunto com a página de suporte (cliente.html), onde o cliente
inicia a partilha de ecrã. A extensão liga-se automaticamente à mesma sessão.

## Âmbito e limites (honesto)
- ✅ Funciona em qualquer **site** dentro do Chrome/Edge (todos os separadores).
- ❌ NÃO funciona fora do navegador (outras apps, ambiente de trabalho, apps de
  banco). Para isso seria necessária uma aplicação nativa.

## Como instalar em modo de programador (teste)
1. Abrir `chrome://extensions`
2. Ativar "Modo de programador" (canto superior direito)
3. Clicar "Carregar sem pacote" e escolher a pasta `extension/`

## Publicar na Chrome Web Store
Ver o ficheiro `INSTRUCOES_PUBLICACAO.md`.

## Estrutura
- manifest.json — configuração (Manifest V3)
- background.js — liga o offscreen, executa cliques reais (chrome.debugger)
- offscreen.html/.js — mantém a ligação Socket.io ao servidor Atlas
- content.js — desenha o círculo em qualquer site e calcula a posição
- popup.html/.js — estado do suporte / desativar
- lib/socket.io.min.js — cliente Socket.io (local)
- icons/ — ícones
