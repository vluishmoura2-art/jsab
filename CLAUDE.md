# Pulsefield — editor de fases de ritmo/desvio

Projeto original inspirado no gênero "desviar no ritmo". Não copiar nome, personagens, músicas,
fases ou identidade visual de jogos existentes.

## Stack (obrigatória)

- **HTML** — estrutura da interface do editor
- **CSS** — estilos customizados quando Tailwind não bastar (`css/style.css`)
- **Tailwind CSS** — via CDN (`cdn.tailwindcss.com/3.4.16`), cores em `tailwind.config` no `index.html`
- **JavaScript** vanilla — scripts clássicos (não ES modules) num namespace global `PF`,
  para o editor abrir com duplo clique em `index.html` (file://) sem servidor
- **Canvas 2D** — arena (`#stage`) e timeline (`#timeline`)

Sem frameworks, engines de jogo ou bundlers sem pedido explícito.

## Estrutura

- `js/config.js` — constantes, paleta, utilitários (`PF.u`)
- `js/hazards.js` — definição dos perigos (`PF.HAZARDS`) e helpers (`PF.hz`).
  Cada perigo é uma função pura do tempo: `shapes(h, tempoLocal, out)` gera formas
  `circle | ring | line | rect` com estado `warn | active | fx`. Só `active` causa dano.
- `js/renderer.js` — desenho da arena, gizmos do editor e jogador
- `js/timeline.js` — timeline em canvas (scrub, arrastar blocos, zoom)
- `js/panel.js` — painel de propriedades gerado a partir de `props` de cada perigo
- `js/storage.js` — autosave (localStorage), exportar/importar JSON (`format: "pulsefield-level"`)
- `js/musiccheck.js` — verificação simples de direitos autorais (`PF.musicCheck`): lê só metadados
  (ID3, Vorbis/FLAC/OGG, M4A, WAV INFO). Bloqueia com copyright/ISRC/gravadora/licença restritiva;
  libera licença livre declarada (CC, domínio público…). Não reconhece a música pelo som.
- `js/audio.js` — música (`PF.audio`): Web Audio, relógio principal da reprodução, picos da
  onda, arquivo salvo no IndexedDB
- `js/main.js` — estado do app (`PF.app`), entrada, modo teste (jogador com `PF.PLAYER.hp` vidas,
  início em `level.spawn`, losango gira para a direção do movimento), loop.
  `app.playLevel()` joga uma fase online sem tocar na fase do editor (`app.editLevel` guarda a
  sua; `commit()` não salva enquanto isso).
- `js/online.js` — fases online (`PF.online`): publicar, lista ao vivo (SSE), jogar/abrir, avisos (`PF.toast`).
  Cópia local das fases de todos em `localStorage['pulsefield.publishedCache']` (por servidor:
  lista + JSON de cada fase, até 300, sem música): baixada em segundo plano, usada sem conexão.
- `server.js` — servidor Node **sem dependências**: serve só `index.html`, `css/`, `js/`; API
  `/api/levels` (GET/POST), `/api/levels/:id`, `/api/events` (SSE). Valida as fases rodando
  `config.js`/`hazards.js`/`storage.js` num `vm` (mesma normalização do editor). Grava em
  `data/levels.json`. `npm start` (localhost) ou `npm run start:lan` (rede local).
  Hospedagem: `Dockerfile` + `HOSPEDAR.md`. Env: `PORT` (liga 0.0.0.0), `DATA_DIR` (volume),
  `TRUST_PROXY=1` (IP = último item do X-Forwarded-For), `ADMIN_TOKEN` (DELETE /api/levels/:id,
  evento SSE `removed`). `/healthz` para health check. Limites: 5 publicações/10 min por IP,
  20 conexões ao vivo por IP, 2000 no total.
  Música nas fases: POST `application/octet-stream` = `[uint32 BE tamanho do JSON][JSON][áudio]`,
  JSON com `musicName` e `musicRights: true` (obrigatório). O servidor roda `musiccheck.js` de novo,
  confere o formato pelos bytes e grava em `DATA_DIR/music/<id>.bin`; `GET /api/levels/:id/music`.
  Env `MAX_MUSIC_MB` (padrão 10) e `MUSIC_TOTAL_MB` (padrão 1024; tira a música das fases mais antigas).
  No cliente, `PF.audio.pushTemp()/popTemp()` toca a música da fase online sem perder a sua
  (`PF.audio.raw` guarda os bytes originais para publicar).

Arena lógica: 1280×720.

## Identidade visual

Conceito "osciloscópio noturno": linhas finas, brilho suave, formas que pulsam.

| Função | Hex |
|---|---|
| Fundo da arena | `#0B1416` |
| Painéis | `#151E21` |
| Jogador (losango) | `#FFB347` |
| Perigo | `#FF4D5E` |
| Acento / UI | `#7CFFB2` |
| Texto | `#D8E2E4` |

Fontes: Space Grotesk (UI/títulos) e JetBrains Mono (números/timeline).

## Versões

- **0.0.1** — perigos: Bola (dir., tamanho, velocidade, quantidade, recarga), Bola explosiva
  (tamanho, tempo p/ explodir, qtd./velocidade/tamanho das bolinhas), Linha e Círculo
  (tempo p/ aparecer, tempo ativa, grossura), Rastro/snake (dir., largura, altura, velocidade,
  quadrados atrás; a cabeça pulsa e solta quadrados que nascem com brilho, ficam parados e
  encolhem até sumir), Trovão (nuvem ondulada na borda de cima ou de baixo, lado escolhido pelo
  clique; durante a duração solta partículas e, a cada N s, um quadrado girando que abre um
  círculo oco ao bater na borda oposta; `init(h)` no perigo roda ao criar), Linha dupla (duas fileiras de círculos
  cheios/ocos intercalados; modo Centro largura×altura, Vertical ou Horizontal na tela toda;
  aviso que se estende, entrada/saída em onda, pulso e fluxo ao longo da faixa), Água (só embaixo; colunas arredondadas com ondas;
  altura vai da inicial à final ao longo do bloco, sobe e escoa; arrastar no mapa muda a altura). Timeline, painel, desfazer, modo teste.
  Jogador com 3 vidas e ponto de início; música importada com verificação de copyright.

  Fases online: publicar (com música opcional) e ver ao vivo as fases e quantas pessoas estão online;
  quem joga a fase de outra pessoa ouve a música dela.

Para testar no Browser pane use o servidor de `.claude/launch.json` (`node server.js`; o pane
não carrega scripts locais via file://). O editor continua abrindo via `index.html` direto;
nesse caso o online tenta `http://localhost:5173` ou o endereço salvo na janela Online.
O pane roda a ~1 fps enquanto scripts de teste rodam: animações convergem devagar lá.
