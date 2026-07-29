# PRD — Suporte Técnico Remoto "Atlas" (Co-browsing)

## Problema original
Sistema web de suporte técnico remoto multi-operador. Cliente abre link, toca COMEÇAR e partilha o ecrã (WebRTC); o técnico vê o ecrã e orienta com um círculo vermelho replicando o toque dentro da própria página (co-browsing). Cada acesso guardado num CRM por operador. Transparência total.

## Arquitetura
- Backend: FastAPI + python-socketio (ASGI combinado), porta 8001, rotas sob `/api`, Socket.io em `/api/socketio`.
- BD: MongoDB — coleções `sessoes` e `utilizadores`.
- Auth: JWT + bcrypt (só técnico). Seeding a partir do `.env`, reposição de password se divergir.
- Frontend: HTML/CSS/JS puro em `frontend/public/` servido pelo dev server (mesma origem): `/`→`/tecnico.html`, `/cliente.html?op=<linkId>`, `/tecnico.html`.
- WebRTC: cliente é offerer, técnico answerer; STUN Google; relay de sinalização por Socket.io em salas `sess:{id}`.

## Personas
- Cliente leigo (mobile-first): 1 botão grande COMEÇAR.
- Técnico/operador (desktop): CRM isolado por operador.

## Implementado (2026-07-16)
- Auth JWT + bcrypt; seeding das 12 contas do `.env` com reposição de password.
- Login, `/me`, alteração de password própria.
- CRM: listar/renomear/apagar/limpar tudo; isolamento por `operador` (REST + Socket).
- Link próprio por operador com botão copiar.
- Socket.io: registo/reconexão de sessão por `token`, estado online/aPartilhar em tempo real (`sessoes:atualizar`).
- Sinalização WebRTC (offer/answer/ice) e co-browsing (`tecnico:clique` → círculo vermelho 44px fade 1.5s + toque simulado via elementFromPoint + eventos pointer/mouse/click).
- Robustez de disconnect: só marca offline se o socket ainda for o dono atual.
- Página cliente: estados inicio/ativo/erro, limitações honestas, tratamento de erro amigável.
- Barra do técnico com "✦ CRIADO POR: VICTOR SILVA & PEDRO CABRAL".

## Backlog / próximos (P1/P2)
- P1: TURN próprio (coturn) e HTTPS para redes restritivas.
- P1: Adaptador Redis no Socket.io para múltiplas réplicas.
- P2: Rate-limiting / anti-força-bruta, rotação de JWT_SECRET, CORS restrito, RGPD/consentimento explícito.
- P2: Indicador de qualidade de ligação / reconexão automática do vídeo.

## Implementado (2026-07-29) — continuação
- Credenciais TURN Metered aplicadas no `.env` e confirmadas via `/api/ice` (corrige ecrã preto entre redes diferentes em produção — requer REDEPLOY).
- Miniaturas AO VIVO no painel do técnico: assim que o painel abre, liga-se automaticamente a TODOS os clientes online que estão a partilhar e mostra a tela ao vivo dentro de cada cartão (antes de clicar em Ver). Refactor multi-peer em `tecnico.js` (mapa `pcs` por `sessaoId`); backend inclui `sessaoId` em `webrtc:offer`/`webrtc:ice`. Clicar na miniatura ou em "Ver/Reconectar" abre o modal reutilizando o mesmo stream; fechar o modal mantém a miniatura viva. (Testado 100% — iteration_12.json)
- Corrigida condição de corrida `cliente:hello` vs `cliente:partilhar` (o selo "A partilhar"/miniatura falhava quando o cliente clicava COMEÇAR muito rápido): retry no backend (`cliente_partilhar`) + gating no cliente (`partilharQuando` espera `sessaoPronta`). (Testado 100%)
- Extensão Chrome v1.0.3: corrigido o mapeamento de coordenadas em `content.js` (removida subtração incorreta de `chromeW`; viewport = `screenX`, `screenY + (outerHeight-innerHeight)`). NÃO testável no ambiente cloud — requer reinstalar/republicar e testar em Chrome real. Requer partilha do ECRÃ INTEIRO.

## Notas de ambiente
- Alterações a `.env` (TURN) e à extensão só chegam à produção após REDEPLOY / reinstalação da extensão.
