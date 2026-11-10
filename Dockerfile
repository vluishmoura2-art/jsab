# Imagem do servidor do Pulsefield (Node.js, sem dependências).
FROM node:22-alpine

WORKDIR /app
COPY package.json server.js index.html ./
COPY css ./css
COPY js ./js

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TRUST_PROXY=1

# as fases publicadas ficam em /data: monte um volume persistente aqui
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
