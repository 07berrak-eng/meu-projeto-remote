# Publicar a extensão "Atlas Suporte Técnico" na Chrome Web Store

## Ficheiro a carregar
Use o pacote: **atlas-suporte-extensao.zip** (gerado na raiz do projeto, em /app).
Não inclua a pasta node_modules nem o base.png — o zip já vem limpo.

## Passos no Developer Console
1. Ir a https://chrome.google.com/webstore/devconsole
2. Clicar **"Add new item"**.
3. Carregar **atlas-suporte-extensao.zip**.
4. Preencher a ficha da loja:
   - **Nome:** Atlas Suporte Técnico
   - **Descrição breve:** Suporte técnico remoto Atlas — orientação com círculo e cliques em qualquer site.
   - **Descrição detalhada:** (sugestão)
     "Extensão de apoio ao suporte técnico remoto Atlas. Durante uma sessão de
     suporte iniciada pelo utilizador, permite que o técnico mostre um círculo de
     orientação e reproduza cliques na página que o cliente está a ver, em
     qualquer site do navegador. A extensão liga-se apenas à sessão de suporte
     indicada pelo técnico e pode ser desativada a qualquer momento."
   - **Categoria:** Ferramentas (Productivity/Tools)
   - **Idioma:** Português (Portugal)
   - **Ícone:** já incluído no zip (128px).
   - **Capturas de ecrã (1280x800 ou 640x400):** tirar 1–2 imagens do painel do
     técnico + a página do cliente com o círculo (obrigatório pelo menos 1).
   - **Política de privacidade:** publicar o texto de POLITICA_PRIVACIDADE.txt
     numa página acessível (por ex. uma página no vosso site) e colar o URL.

5. **Justificação das permissões** (a Google vai perguntar — cole isto):
   - debugger: "Reproduzir na página ativa os cliques que o técnico indica durante
     a sessão de suporte solicitada pelo utilizador."
   - host_permissions <all_urls>: "Mostrar o círculo de orientação e reproduzir o
     clique na página que o utilizador está a visualizar, seja qual for o site."
   - offscreen/storage/tabs/scripting: "Manter a ligação em tempo real ao servidor
     de suporte e identificar a página ativa."
   - Declarar **uso único**: apoio ao suporte técnico remoto solicitado pelo utilizador.

6. **Visibilidade:** recomendo **"Não listada" (Unlisted)** — só quem tiver o link
   instala. (Pode mudar para Pública depois.)

7. Clicar **"Submit for review"**. A revisão demora normalmente 1–5 dias úteis.

## Depois de aprovada
1. Copiar o URL da extensão na loja (algo como
   https://chrome.google.com/webstore/detail/....).
2. No ficheiro `/app/frontend/public/cliente.js`, definir:
   `const EXTENSAO_URL = "<URL da loja>";`
   (Assim aparece automaticamente o botão "Instalar extensão de suporte avançado"
   na página do cliente depois de iniciar a partilha.)
3. Fazer redeploy do site.

## Nota técnica importante
Para o círculo cair no sítio certo, o cliente deve partilhar o **ECRÃ INTEIRO**
(não apenas uma janela/separador), porque a posição é calculada em relação ao ecrã.
