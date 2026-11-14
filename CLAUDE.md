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
- `js/anim.js` — um só sistema de keyframes para objetos, câmera e tema (`PF.ease`, `PF.EASE_OPTIONS`,
  `PF.kf`: `sample/setKey/normTrack/normTracks/mixHex`; `PF.anim`: `normLevel`, `themeAt`, `camAt`,
  `stepMarker`). Trilha = `[{ t, e, ...campos }]` ordenada; a curva `e` vale para o trecho que CHEGA na
  chave (linear, instant, Sine/Quad/Cubic/Expo/Elastic/Back/Bounce in/out/inOut). Carregado antes do
  `transform.js` (também no `vm` do servidor).
  Aleatório nas chaves (dado no cartão): `rnd: { campo: amplitude }` sorteia em valor ± amplitude,
  `rs` encaixa em múltiplos, `rk` = número fixo da chave (mover no tempo não re-sorteia). Sorteio por
  `hash01` inteiro (igual no navegador e no servidor), só quando `sample` recebe `seed`: objetos usam
  `PF.hz.seedOf(h)` (`h.seed` ou o #id — cópias saem diferentes), câmera usa `level.seed`. Sem
  semente `sample` devolve o valor base (é o que criar/atualizar chaves usa). Cor não tem aleatório.
  A semente também sorteia as partículas do emissor.
- `js/transform.js` — matriz afim 2D (`PF.m`: `compose(x, y, rot, sx, sy, px, py)` = girar/escalar em
  volta do pivô, `mul`, `apply`, `invert`, `rotateAround`). Carregado antes de `hazards.js` (também no `vm`).
- `js/hazards.js` — definição dos perigos (`PF.HAZARDS`) e helpers (`PF.hz`).
  Cada perigo é uma função pura do tempo: `shapes(h, tempoLocal, out)` gera formas
  `circle | ring | line | rect | poly` com estado `warn | active | fx`. Só `active` causa dano.
- `js/levelcheck.js` — `PF.levelCheck(level, budgetMs)`: verifica se a fase é possível simulando
  numa grade 16px todos os lugares alcançáveis (andar, dash invencível, 3 vidas + invencibilidade
  após dano). Generosa: só acusa impossível de verdade. Usada antes de publicar e no servidor
  (que recusa com 400). Passou do limite de tempo → aceita (`partial`).
- `js/renderer.js` — desenho da arena, gizmos do editor e jogador
- `js/timeline.js` — timeline em canvas (scrub, arrastar blocos com encaixe, zoom, grade de batidas,
  agulha em losango que dá um "kick" na batida)
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
- `js/geometry.js` — geometria dos caminhos (`PF.geo`): geradores, operações nos pontos, SVG
- `js/mass.js` — edição em massa e presets de grupo (`PF.mass`), carregado depois do `main.js`
- `js/online.js` — fases online (`PF.online`): publicar, lista ao vivo (SSE), jogar/abrir, avisos (`PF.toast`).
  Cópia local das fases de todos em `localStorage['pulsefield.publishedCache']` (por servidor:
  lista + JSON de cada fase, até 300, sem música): baixada em segundo plano, usada sem conexão.
- `server.js` — servidor Node **sem dependências**: serve só `index.html`, `css/`, `js/`; API
  `/api/levels` (GET/POST), `/api/levels/:id`, `/api/events` (SSE). Valida as fases rodando
  `config.js`/`hazards.js`/`levelcheck.js`/`storage.js` num `vm` (mesma normalização do editor).
  Grava em `data/levels.json`; com `SUPABASE_URL` + `SUPABASE_SECRET_KEY` também no Supabase via
  REST/fetch (tabela `levels(id, created_at, entry jsonb)` com RLS sem políticas; músicas no bucket
  privado `music`, baixadas para o disco sob demanda) e carrega de lá ao iniciar — necessário no
  Render grátis (sem disco). Chave secreta vai só no header `apikey` (Bearer só se for JWT antigo).
  Nos scripts rodados no `vm`, use `const Math = globalThis.Math` no IIFE (busca global lá é lenta). `npm start` (localhost) ou `npm run start:lan` (rede local).
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
  altura vai da inicial à final ao longo do bloco, sobe e escoa; arrastar no mapa muda a altura), Roda (anel de alvos que gira e anda numa direção fixa —
  dir./tamanho do arco/qtd./tamanho/velocidade/giro), Plataforma pontuda (barra com espinhos na
  frente, 4 direções, altura e velocidade; nasce devagar tremendo e acelera em 0,9 s; forma `poly`), Rastro curvo (tecla C; como o Rastro, mas
  anda num arco: direção inicial em graus e curva em °/100 px; quadrados giram com o caminho; o caminho
  à frente aparece em aviso; a cabeça para ao sair da tela ou depois de duas voltas). Timeline, painel, desfazer, modo teste.
  Jogador com 3 vidas e ponto de início; música importada com verificação de copyright.

  Fases online: publicar (com música opcional) e ver ao vivo as fases e quantas pessoas estão online;
  quem joga a fase de outra pessoa ouve a música dela.

  Ritmo: a fase guarda `bpm` (0 = sem grade, senão 20–400), `offset` (s da 1ª batida) e `beatsPerBar`.
  `app.snapTime(t)` encaixa na batida/`app.snapDiv` (1, 2, 3, 4, 8; sem BPM, passos de 0,05 s) e
  `app.stepBeat(t, dir, bar)` anda por batida/compasso. Teclas: `,` `.` (Shift: compasso), `G` encaixe,
  `Shift+G` subdivisão, `B` tap tempo (tocando, alinha o `offset`). `PF.toast(msg, kind, key)`: mesma
  `key` reaproveita a caixa.

  Forma livre (modo manual, tecla F, faixa "Forma"): perigo `shape` com `kind` 0 círculo, 1 quadrado,
  2 triângulo, 3 laser; `w`/`h` (laser: comprimento/grossura), `rot`, pivô `pivotX/pivotY` (do centro,
  antes de girar; `x,y` é onde o pivô fica), cheia/vazada (vazada = uma `line` por lado), aviso → ativa → some.
  No mapa: bolinha de cima gira (Shift 15°), quadradinho do canto muda o tamanho (Shift proporcional),
  Alt+arrastar move o pivô sem mexer na forma (`PF.shapeHandles` no renderer).
  Comportamentos (`h.behaviors`, até 12, `PF.BEHAVIORS` em hazards.js): mover, investida, onda,
  zigue-zague, órbita, espiral, caminho (Bézier; pontos arrastáveis no mapa), quicar nas bordas,
  teletransporte, tremer, girar, pulsar na batida, crescer/encolher. Cada um: `on`, `start`/`end`
  (s depois de ativa) e params; funções puras que somam num delta `{x, y, rot, s}`, de cima para
  baixo (`PF.hz.shapePose(h, bt)`). No aviso a forma fica na pose inicial; "bt" = batidas
  (`PF.hz.setBeat(level)`, chamado em `collect`; sem BPM 0,5 s); pulsar segue o tempo da fase.
  Dados além de `props` passam por `def.extra(raw, h)` no `PF.hz.normalize`. Painel: cartões com
  mini-gráfico, liga/desliga, subir/descer. Mapa: caminho tracejado do pivô durante o tempo ativo.
  Gatilhos (`h.triggers`, até 8, `PF.TRIGGER_ACTIONS`): quando = ao aparecer, num tempo, na batida
  (`every` bt, na grade da música), na meia batida, fim de comportamento (keyframe = `end` ou
  `start+time` do comportamento nº `beh`), no fim, jogador perto (`dist`), encostar no jogador;
  ações = rajada, explodir, dividir, convergir, espelhar, acelerar (relógio dos comportamentos
  ×`mult` em `ramp` s), transformar (vira outra forma/tamanho), sumir. `lead` = aviso antes (linhas
  de mira/anel). `PF.hz.shapeEvents(h)` calcula tudo antes (lista de eventos com pose fixa, cache por
  JSON da forma), então continua função pura do tempo. Explodir/dividir/sumir tiram a forma; o bloco
  cresce até o fim dos filhos (máx. 1500). Reativos (perto/encostar): no teste disparam de verdade
  (`PF.hz.setReactive(Map)` + `reactiveTriggers` no main.js, uma vez, no instante + `lead`); no
  editor (`PF.hz.preview = true`) a prévia imagina o jogador parado no início; `levelCheck` e servidor
  os ignoram. Losangos marcam os disparos no bloco da timeline e no mapa.
  Grupo (`type: 'group'`, Ctrl+G com Formas selecionadas, faixa "Forma / grupo"): guarda os itens
  dentro (`g.items`, até 32, formas ou grupos até 3 níveis) com x/y relativos ao pivô coletivo (`x,y`
  do grupo) e `time` relativo ao começo do grupo. `rot`, `scale` (%) e `behaviors` do grupo giram/
  escalam/movem tudo em volta do pivô. Repetidor (`repeat` 1 radial/mandala, 2 grade, 3 espiral;
  `count`, `angle`, `cols/dx/dy`, `grow`, `delay` em bt entre cópias); máx. 256 formas desenhadas
  (`count` cai no normalize). Saída = formas dos itens levadas ao mundo (`xform`), então colisão,
  levelCheck e servidor não mudam. Gatilhos reativos não valem dentro de grupos (`inGroup`).
  Mapa: contornos das cópias, alça de giro acima do pivô, Alt+arrastar move o pivô sem mexer nas
  formas (itens compensam). Painel: lista de itens (clique abre o editor do item: forma,
  comportamentos e gatilhos), comportamentos do grupo, Desagrupar (Ctrl+Shift+G: cada cópia vira
  peças soltas; comportamentos do grupo ficam de fora) e Salvar preset.
  Seleção múltipla (`app.multi`, Shift+clique no mapa/timeline, Ctrl+A): arrastar move todos (espaço
  e tempo), copiar/colar/duplicar/excluir valem para todos; painel de massa (`js/mass.js`, `PF.mass`):
  agrupar, girar/escalar em volta do centro da seleção ou da arena, distribuir (radial, grade,
  espiral; apontar para fora), escada no tempo (bt), pulsar todos. Presets de grupo em
  `localStorage['pulsefield.presets']` (painel da fase: inserir no centro, na agulha).
  Caminho (Forma `kind` 4): `h.pts` = [x, y, …] locais (centro 0,0; até 128 pontos), `closed`
  (fechado cheio/vazado ou aberto = linhas com `stroke`), `smooth` (Catmull-Rom só na saída).
  Caneta (tecla P): clique = ponto, arrastar = pincel (simplifica no fim), clique no 1º ponto fecha,
  Enter/duplo clique/Esc termina (pivô vai para o centro). Mapa com o caminho selecionado: arrastar
  os quadradinhos (Shift = grade 20 px), Shift+clique na borda adiciona ponto, clique no ponto +
  Delete apaga (`app.vtx`). `js/geometry.js` (`PF.geo`, só editor): geradores (polígono, estrela,
  arco, anel, espiral, onda), simplificar (RDP), suavizar (Chaikin), chanfrar, arredondar, deslocar
  contorno, unir pontos, inverter, inclinar, esticar, `toPath` (converte as outras formas),
  `recenter`, SVG (importar path/polygon/rect/circle → Formas agrupadas; exportar `toSVG`).
  Painel: seção "Geometria". Plano de modelagem (próximas rodadas): booleanas, modificadores
  não destrutivos (bend/twist/taper/noise), hitbox separada, camadas/travar/ocultar, guias e
  encaixe em ponto/borda, imagem de referência, telegrafia do caminho.
  Com BPM, perigos novos nascem na batida (encaixe) e os blocos mostram "c3 b2" (compasso/batida);
  a preferência do encaixe fica em `localStorage['pulsefield.snap']`.

  Camada de animação (genérica, vale para qualquer tipo; só grava no JSON o que foi usado, então
  fases antigas não mudam): `h.keys = { pos:[{t,e,x,y}], rot:[{t,e,v}], scl:[{t,e,x,y}] (%), col:[{t,e,c}] }`
  com `t` relativo a `h.time`; posição soma à base, rotação/escala em volta da origem (`x+ox, y+oy`;
  Forma/Grupo/Prefab usam o próprio pivô x,y). `h.life` (s, corta o bloco; Âncora/Partículas/Ativador
  usam `dur` via `def.lifeKey`). Parentesco `h.parent` (id, só no topo), `pin` (bits 1 pos, 2 rot,
  4 escala), `pdelay` (s); o pai entra com keyframes + comportamentos (`frameMatrix`, cache por quadro,
  ciclos barrados por `wouldCycle` e profundidade 8). Tudo em `PF.hz.collect` → `localShapes` +
  `xformAff` (escala diferente em X/Y vira polígono/linhas); colisão, levelCheck e servidor seguem.
  Itens de grupo também aceitam keys/life (sem pai). Mapa: gizmo e alças ficam onde o objeto está
  (`worldMatrix`, mouse → `toLocal`); com chaves de posição e agulha dentro do bloco, arrastar grava a
  chave na agulha. `PF.hz.shapeEvents` tira `keys` da assinatura do cache (senão fica lento).
  Novos tipos: `anchor` (vazio, para parentesco), `emitter` (partículas puras do tempo, `hurt` opcional,
  máx. 400 vivas), `activator` (zona; quando = entra/sai (teste) ou no início (fixo); ação = tremer,
  clarão, checkpoint, sumir `targets`; "no início + sumir" vale em todo lugar via `killTimes`, o resto
  só no teste com `PF.hz.setKills`), `prefab` (`ref` → `level.prefabs[{id,name,group}]`; editar abre
  um grupo com `prefabOf/pRot/pScale`, "Salvar no prefab" atualiza todas as cópias; `PF.mass.*Prefab`).
  Fase: `markers [{t,name,color,desc}]` (régua; M, `[ ]`), `checkpoints [{t,x,y}]` (J; no teste sem
  vidas volta ao último passado com vidas cheias), `cam {pos,zoom,rot,shake}` (vale tocando e no teste;
  parado = moldura azul; no teste o jogador fica dentro da vista), `theme [{t,e,bg,hz,pl,ui}]`
  (`PF.THEMES` prontos), `bg` (até 6 camadas parallax: grade, pontos, anéis, listras, estrelas,
  losangos; `depth`, rolagem, pulsar na batida, janela de tempo). Seleção fora dos perigos:
  `app.sel2 = { kind: marker|cp|cam|theme, i, ch }`; `app.selKey = { id, t }` (losango na timeline;
  Delete apaga). Timeline: faixas `ctrl` (Âncora/fx) e `events` (câmera/tema/cp; duplo clique cria
  cp), altura das faixas encolhe até 15 px para caberem; marcadores na régua (duplo clique cria);
  losangos de keyframe no bloco selecionado (arrastar move as chaves daquele tempo); borda direita do
  bloco selecionado muda o tempo de vida. Painel: Keyframes, Parentesco, Origem, "Some depois de";
  seleção múltipla ganha "Propriedades em comum" (em branco = valores diferentes); painel da fase
  ganha Marcadores, Checkpoints, Câmera, Tema, Fundo (parallax), Prefabs (seções recolhíveis).
  Teclas novas: A âncora, E partículas, X ativador, K keyframe (Shift: pos+rot+escala).

  Interface: cantos chanfrados (`.pf-btn`, `.pf-chamfer`), tokens de cor em `:root` no `style.css`,
  ícones SVG (sem emojis), barra lateral agrupada por comportamento (Projétil, Zona, Corpo, Clima).

Para testar no Browser pane use o servidor de `.claude/launch.json` (`node server.js`; o pane
não carrega scripts locais via file://). O editor continua abrindo via `index.html` direto;
nesse caso o online tenta `http://localhost:5173` ou o endereço salvo na janela Online.
O pane roda a ~1 fps enquanto scripts de teste rodam: animações convergem devagar lá.
