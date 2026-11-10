# Hospedar o Pulsefield na internet

O servidor (`server.js`) entrega o editor **e** as fases online no mesmo endereço.
Depois de hospedado, qualquer pessoa abre `https://seu-endereco` e já entra conectada.

## O que a hospedagem precisa ter

1. **Node.js 18+** ou **Docker** (já existe um `Dockerfile` pronto).
2. **Disco/volume persistente** para a pasta das fases. Sem isso, as fases publicadas somem
   a cada reinício ou atualização.
3. **Conexões longas** (o "ao vivo" usa Server-Sent Events). Hospedagens de *funções
   serverless* (Vercel Functions, Netlify Functions) **não servem**. Use um serviço que roda
   um processo contínuo: Railway, Fly.io, Render (plano com disco), uma VPS etc.

## Variáveis de ambiente

| Variável | Valor | Para quê |
|---|---|---|
| `PORT` | a hospedagem define | porta; quando existe, o servidor escuta em `0.0.0.0` |
| `DATA_DIR` | caminho do volume, ex. `/data` | onde fica `levels.json` |
| `TRUST_PROXY` | `1` | usa o IP real do jogador (vem do proxy) no limite de publicações |
| `ADMIN_TOKEN` | uma senha longa e aleatória | permite apagar fases (moderação) |
| `MAX_MUSIC_MB` | padrão `10` | tamanho máximo da música de cada fase |
| `MUSIC_TOTAL_MB` | padrão `1024` | espaço total para músicas; acima disso tira a música das fases mais antigas |

O volume precisa ter espaço para as músicas (pelo menos o valor de `MUSIC_TOTAL_MB`).

O `Dockerfile` já define `PORT=8080`, `DATA_DIR=/data` e `TRUST_PROXY=1`.
Defina só o `ADMIN_TOKEN` no painel da hospedagem (nunca coloque ele no código).

Para gerar um token:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## Passo a passo (com Docker — Railway, Fly.io, Render…)

1. Coloque o projeto num repositório Git (GitHub, por exemplo). O `.gitignore` já deixa
   a pasta `data/` de fora.
2. Na hospedagem, crie um serviço a partir do repositório. Ela detecta o `Dockerfile`.
3. Crie um **volume** e monte em `/data`.
4. Adicione a variável `ADMIN_TOKEN`.
5. Configure o *health check* para `/healthz` (se a hospedagem pedir).
6. Publique. Abra o endereço gerado e confira o **● Online** verde no topo.

Os nomes dos menus mudam de uma hospedagem para outra e os planos/preços mudam com o
tempo; confira a documentação atual dela para "volume" e "variáveis de ambiente".

## Passo a passo (VPS com Node)

```bash
git clone <seu-repositorio> pulsefield && cd pulsefield
```

```bash
PORT=8080 DATA_DIR=/var/lib/pulsefield TRUST_PROXY=1 ADMIN_TOKEN=<seu-token> node server.js
```

Coloque um proxy com HTTPS na frente (Caddy ou Nginx) e use um gerenciador de processo
(systemd, pm2) para ele reiniciar sozinho. Com Nginx, desligue o buffer em `/api/events`
(`proxy_buffering off;`) — o servidor já manda `X-Accel-Buffering: no`, que resolve na maioria dos casos.

## Moderação: apagar uma fase

Pegue o `id` da fase em `https://seu-endereco/api/levels` e rode:

```bash
curl -X DELETE https://seu-endereco/api/levels/<id> -H "Authorization: Bearer <seu-token>"
```

Ela some na hora da lista de todo mundo que está online, e a música dela é apagada do disco.

## Músicas das fases (direitos autorais)

Quem publica com música precisa marcar que a música é dela, é livre ou que tem permissão.
O servidor repete a verificação simples de metadados (bloqueia copyright, ISRC, gravadora)
e só aceita MP3, WAV, OGG, FLAC e M4A. **Essa verificação não reconhece a música pelo som**:
uma faixa protegida sem metadados passa. Se alguém avisar que uma música é protegida,
apague a fase com o comando acima. Num site público, deixe um contato visível para esses avisos.

## Limites já embutidos

- Fase de até 300 KB e 2000 perigos; fases vazias são recusadas.
- Música de até 10 MB por fase e 1 GB no total (ajustáveis pelas variáveis acima).
- 5 publicações a cada 10 minutos por IP.
- Até 20 conexões ao vivo por IP e 2000 no total.
- Guarda as 500 fases mais recentes.
- Só `index.html`, `css/` e `js/` são públicos; `server.js` e os dados não.
- Nomes de fase/autor são limpos e sempre exibidos como texto.

## O que ainda não tem

- Contas de usuário (qualquer um publica com qualquer nome).
- Filtro automático de palavras ofensivas (a moderação é manual, pelo `ADMIN_TOKEN`).
- Reconhecimento de música pelo som (precisaria de um serviço externo, como AcoustID).
- Mais de uma instância do servidor ao mesmo tempo (as fases ficam num arquivo local;
  para escalar seria preciso um banco de dados).
