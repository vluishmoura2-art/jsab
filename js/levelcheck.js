// Verificação de fase possível (PF.levelCheck). Roda no editor antes de publicar e de novo
// no servidor. Simula, numa grade da arena, todos os lugares onde o jogador pode estar a cada
// instante: andando, usando o dash (invencível) e gastando as vidas (com a invencibilidade
// depois do dano). Se em algum momento não sobra nenhum lugar vivo, a fase é impossível.
// A simulação é generosa (grade e passos de tempo aproximados): só acusa o que é impossível
// de verdade, não fases só difíceis.
(function () {
  const Math = globalThis.Math; // local: no vm do servidor a busca global é lenta
  const { W, H } = PF;
  const CELL = 16;
  const GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL), N = GW * GH;
  // estado de cada célula num número só (maior = melhor):
  //   vidas * S_HP + (quanto o dash já recarregou) * S_CD + passos de invencibilidade
  const S_CD = 64, S_HP = 64 * 16;

  // máximo numa janela quadrada de raio r ("pode chegar em até r células")
  function dilate(src, r, tmp, dst) {
    if (r <= 0) { dst.set(src); return; }
    for (let y = 0; y < GH; y++) {
      const row = y * GW;
      for (let x = 0; x < GW; x++) {
        let m = 0;
        const a = x - r < 0 ? 0 : x - r, b = x + r > GW - 1 ? GW - 1 : x + r;
        for (let i = row + a, e = row + b; i <= e; i++) if (src[i] > m) m = src[i];
        tmp[row + x] = m;
      }
    }
    for (let x = 0; x < GW; x++) {
      for (let y = 0; y < GH; y++) {
        let m = 0;
        const a = y - r < 0 ? 0 : y - r, b = y + r > GH - 1 ? GH - 1 : y + r;
        for (let i = a * GW + x, e = b * GW + x; i <= e; i += GW) if (tmp[i] > m) m = tmp[i];
        dst[y * GW + x] = m;
      }
    }
  }

  function bbox(s) {
    if (s.kind === 'circle') return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
    if (s.kind === 'ring') { const e = s.r + s.w / 2; return [s.x - e, s.y - e, s.x + e, s.y + e]; }
    if (s.kind === 'line') { const e = s.w / 2; return [Math.min(s.x1, s.x2) - e, Math.min(s.y1, s.y2) - e, Math.max(s.x1, s.x2) + e, Math.max(s.y1, s.y2) + e]; }
    if (s.kind === 'rect') {
      const ex = s.rot ? Math.hypot(s.w, s.h) / 2 : s.w / 2, ey = s.rot ? ex : s.h / 2;
      return [s.x - ex, s.y - ey, s.x + ex, s.y + ey];
    }
    return null;
  }

  // marca as células onde o jogador levaria dano neste instante
  function rasterize(level, t, pr, unsafe, shapes) {
    unsafe.fill(0);
    shapes.length = 0;
    PF.hz.collect(level, t, shapes);
    for (const s of shapes) {
      if (s.state !== 'active') continue;
      const b = bbox(s);
      if (!b) continue;
      const x0 = Math.max(0, Math.floor((b[0] - pr) / CELL)), x1 = Math.min(GW - 1, Math.floor((b[2] + pr) / CELL));
      const y0 = Math.max(0, Math.floor((b[1] - pr) / CELL)), y1 = Math.min(GH - 1, Math.floor((b[3] + pr) / CELL));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * GW + x;
          if (!unsafe[i] && PF.hz.hitsPlayer(s, x * CELL + CELL / 2, y * CELL + CELL / 2, pr)) unsafe[i] = 1;
        }
      }
    }
  }

  // Devolve { ok, at, hitsNeeded, partial }:
  //  ok=false -> impossível; "at" = instante (s) em que ninguém sobrevive
  //  ok=true  -> possível; hitsNeeded = quantas vidas é preciso perder no melhor caminho
  //  partial  -> a conta passou de budgetMs e parou antes do fim (aí a fase é aceita)
  PF.levelCheck = function (level, budgetMs = 4000) {
    const P = PF.PLAYER;
    const started = Date.now();
    const dur = Math.max(0, Number(level.duration) || 0);
    const dt = Math.max(1 / 15, dur / 2000); // até 2000 passos, mesmo em fases longas
    const steps = Math.ceil(dur / dt);
    const walkR = Math.ceil(P.speed * dt / CELL);
    const dashR = Math.ceil(P.dashSpeed * P.dashTime / CELL);
    const cdSteps = Math.min(15, Math.max(1, Math.ceil(P.dashCd / dt)));
    const hurtSteps = Math.min(S_CD - 1, Math.round(P.hurtTime / dt));
    const spawnSteps = Math.min(S_CD - 1, Math.round(0.6 / dt));

    let cur = new Uint16Array(N), next = new Uint16Array(N);
    const tmp = new Uint16Array(N), walk = new Uint16Array(N), ready = new Uint16Array(N), dash = new Uint16Array(N);
    const unsafe = new Uint8Array(N), shapes = [];

    const sp = level.spawn || { x: W / 2, y: H / 2 };
    const sx = Math.min(GW - 1, Math.max(0, Math.floor(sp.x / CELL))), sy = Math.min(GH - 1, Math.max(0, Math.floor(sp.y / CELL)));
    cur[sy * GW + sx] = P.hp * S_HP + cdSteps * S_CD + spawnSteps;

    for (let k = 1; k <= steps; k++) {
      const t = Math.min(dur, k * dt);
      rasterize(level, t, P.r, unsafe, shapes);

      // andar: chega em até walkR células
      dilate(cur, walkR, tmp, walk);
      // dash (só com ele recarregado): pula até dashR células sem levar dano no caminho
      for (let i = 0; i < N; i++) {
        const v = cur[i];
        ready[i] = v && ((v % S_HP) / S_CD | 0) >= cdSteps ? v - (v % S_HP) : 0;
      }
      dilate(ready, dashR, tmp, dash);

      let alive = false;
      for (let i = 0; i < N; i++) {
        let v = walk[i], hp, cd, hurt;
        if (v) {
          hp = v / S_HP | 0; cd = (v % S_HP) / S_CD | 0; hurt = v % S_CD;
          if (cd < cdSteps) cd++; // o dash vai recarregando
        } else hp = 0;
        const d = dash[i];
        if (d && (d / S_HP | 0) > hp) { hp = d / S_HP | 0; cd = 0; hurt = 0; } // depois do dash: recarregando
        if (!hp) { next[i] = 0; continue; }
        // dano de quem parou num lugar perigoso (a invencibilidade protege)
        if (hurt > 0) hurt--;
        else if (unsafe[i]) { hp--; hurt = hurtSteps; }
        next[i] = hp > 0 ? hp * S_HP + cd * S_CD + hurt : 0;
        if (hp > 0) alive = true;
      }
      if (!alive) return { ok: false, at: t, hitsNeeded: P.hp };
      const sw = cur; cur = next; next = sw;
      if (k % 50 === 0 && Date.now() - started > budgetMs) return { ok: true, at: t, hitsNeeded: 0, partial: true };
    }

    let best = 0;
    for (let i = 0; i < N; i++) { const hp = cur[i] / S_HP | 0; if (hp > best) best = hp; }
    return { ok: true, at: dur, hitsNeeded: P.hp - best };
  };
})();
