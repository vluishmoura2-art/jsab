// Geometria dos caminhos (PF.geo): geradores (polígono, estrela, arco, anel, espiral, onda),
// operações nos pontos (simplificar, suavizar, chanfrar, arredondar, deslocar contorno, unir
// pontos, inverter, inclinar, esticar), converter formas em caminho e SVG (importar/exportar).
// Pontos sempre como lista plana [x, y, x, y…]. Só o editor usa (o servidor só lê os pontos).
(function () {
  const { W, H, u } = PF;
  const G = PF.geo = {};
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const MAX = () => PF.hz.MAX_PTS;
  const r2 = v => Math.round(v * 100) / 100;
  const clean = pts => pts.slice(0, MAX() * 2).map(r2);
  const pairs = p => { const o = []; for (let i = 0; i + 1 < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
  const flat = ps => { const o = []; for (const [x, y] of ps) o.push(x, y); return o; };

  // ---------- geradores (centro em 0,0) ----------
  G.polygon = (n, r) => { const o = []; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + TAU * i / n; o.push(Math.cos(a) * r, Math.sin(a) * r); } return clean(o); };
  G.star = (n, r, inner) => {
    const o = [];
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + Math.PI * i / n, rr = i % 2 ? r * inner : r; o.push(Math.cos(a) * rr, Math.sin(a) * rr); }
    return clean(o);
  };
  // arco aberto (vira uma linha com a grossura do contorno)
  G.arc = (r, start, sweep) => {
    const n = Math.max(3, Math.min(MAX(), Math.ceil(Math.abs(sweep) / 8) + 1)), o = [];
    for (let i = 0; i < n; i++) { const a = (start + sweep * i / (n - 1)) * D2R; o.push(Math.cos(a) * r, Math.sin(a) * r); }
    return clean(o);
  };
  // espiral aberta: de r0 até r1 dando "turns" voltas
  G.spiral = (turns, r0, r1) => {
    const n = Math.max(8, Math.min(MAX(), Math.ceil(turns * 24))), o = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1), a = -Math.PI / 2 + TAU * turns * t, r = r0 + (r1 - r0) * t; o.push(Math.cos(a) * r, Math.sin(a) * r); }
    return clean(o);
  };
  // onda aberta horizontal
  G.wave = (len, amp, waves) => {
    const n = Math.max(8, Math.min(MAX(), Math.ceil(waves * 12) + 1)), o = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1); o.push(-len / 2 + len * t, Math.sin(TAU * waves * t) * amp); }
    return clean(o);
  };

  // ---------- operações ----------
  // Ramer–Douglas–Peucker: tira pontos que quase não mudam o desenho
  G.simplify = (p, closed, tol) => {
    const P = pairs(p);
    if (P.length < 4) return p.slice();
    const keep = new Uint8Array(P.length);
    const segDist = (q, a, b) => u.distToSeg(q[0], q[1], a[0], a[1], b[0], b[1]);
    const rdp = (i, j) => {
      let m = -1, idx = -1;
      for (let k = i + 1; k < j; k++) { const d = segDist(P[k], P[i], P[j]); if (d > m) { m = d; idx = k; } }
      if (m > tol) { keep[idx] = 1; rdp(i, idx); rdp(idx, j); }
    };
    keep[0] = keep[P.length - 1] = 1;
    rdp(0, P.length - 1);
    const out = P.filter((_, i) => keep[i]);
    return flat(out.length >= (closed ? 3 : 2) ? out : P);
  };
  // Chaikin: cada canto vira dois pontos (suaviza; repetir deixa mais redondo)
  G.chaikin = (p, closed) => {
    const P = pairs(p), n = P.length, out = [];
    if (n < 3 || n * 2 > MAX()) return p.slice();
    const segs = closed ? n : n - 1;
    if (!closed) out.push(P[0]);
    for (let i = 0; i < segs; i++) {
      const a = P[i], b = P[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(P[n - 1]);
    return clean(flat(out));
  };
  // chanfrar: cada canto é cortado a "d" px dos dois lados (bevel)
  G.bevel = (p, closed, d) => {
    const P = pairs(p), n = P.length, out = [];
    if (n < 3) return p.slice();
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) { out.push(P[i]); continue; }
      const c = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      const la = Math.hypot(a[0] - c[0], a[1] - c[1]), lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
      const da = Math.min(d, la / 2), db = Math.min(d, lb / 2);
      if (la < 1e-6 || lb < 1e-6) { out.push(c); continue; }
      out.push([c[0] + (a[0] - c[0]) * da / la, c[1] + (a[1] - c[1]) * da / la], [c[0] + (b[0] - c[0]) * db / lb, c[1] + (b[1] - c[1]) * db / lb]);
    }
    return clean(flat(out.slice(0, MAX())));
  };
  // arredondar cantos (fillet): chanfra e passa o Chaikin duas vezes
  G.fillet = (p, closed, d) => { let q = G.bevel(p, closed, d); q = G.chaikin(q, closed); return G.chaikin(q, closed); };
  // área com sinal (sentido dos pontos)
  const area = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  // deslocar o contorno: d > 0 engorda, d < 0 afina (canto em ponta, limitado)
  G.offset = (p, closed, d) => {
    const P = pairs(p), n = P.length;
    if (n < 2) return p.slice();
    const sgn = closed && area(P) < 0 ? -1 : 1; // normal para fora em qualquer sentido
    const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l * sgn, -dx / l * sgn]; };
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = closed || i > 0 ? P[(i - 1 + n) % n] : null, next = closed || i < n - 1 ? P[(i + 1) % n] : null;
      const n1 = prev ? nrm(prev, P[i]) : null, n2 = next ? nrm(P[i], next) : null;
      let nx, ny;
      if (n1 && n2) {
        nx = n1[0] + n2[0]; ny = n1[1] + n2[1];
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const k = Math.min(4, 1 / Math.max(0.25, nx * n1[0] + ny * n1[1])); // miter limitado
        nx *= k; ny *= k;
      } else [nx, ny] = n1 || n2;
      out.push([P[i][0] + nx * d, P[i][1] + ny * d]);
    }
    return clean(flat(out));
  };
  // unir pontos vizinhos mais perto que "d" (weld/merge)
  G.merge = (p, closed, d) => {
    const P = pairs(p), out = [];
    for (const q of P) {
      const last = out[out.length - 1];
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < d) { last[0] = (last[0] + q[0]) / 2; last[1] = (last[1] + q[1]) / 2; } else out.push(q.slice());
    }
    if (closed && out.length > 2) {
      const a = out[0], b = out[out.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < d) out.pop();
    }
    return out.length >= (closed ? 3 : 2) ? clean(flat(out)) : p.slice();
  };
  G.flip = (p, axis) => clean(p.map((v, i) => (i % 2 === axis ? -v : v)));                 // 0 = ↔, 1 = ↕
  G.skew = (p, ax, ay) => { const tx = Math.tan(ax * D2R), ty = Math.tan(ay * D2R); const o = []; for (let i = 0; i < p.length; i += 2) o.push(p[i] + p[i + 1] * tx, p[i + 1] + p[i] * ty); return clean(o); };
  G.stretch = (p, sx, sy) => clean(p.map((v, i) => v * (i % 2 ? sy : sx)));
  G.reverse = p => { const P = pairs(p).reverse(); return flat(P); };
  // centro do desenho (média dos pontos)
  G.center = p => { let x = 0, y = 0; const n = p.length / 2 || 1; for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; } return [x / n, y / n]; };

  // Coloca os pontos em volta do centro (0,0) sem mexer na forma no mapa (pivô acompanha).
  G.recenter = h => {
    const [cx, cy] = G.center(h.pts);
    if (Math.abs(cx) + Math.abs(cy) < 0.01) return;
    h.pts = clean(h.pts.map((v, i) => v - (i % 2 ? cy : cx)));
    h.pivotX = r2(h.pivotX - cx); h.pivotY = r2(h.pivotY - cy);
  };

  // Converte círculo/quadrado/triângulo/laser em caminho editável (mesmo desenho)
  G.toPath = h => {
    if (h.kind === 4) return;
    if (h.kind === 3) { h.pts = [-h.w / 2, 0, h.w / 2, 0]; h.closed = 0; h.stroke = u.clamp(h.h, 2, 200); }
    else if (h.kind === 0) { h.pts = clean(pairs(PF.hz.shapeLocal({ ...h, kind: 0 })).filter((_, i) => i % 2 === 0).flat()); h.closed = 1; h.smooth = 1; }
    else { h.pts = clean(PF.hz.shapeLocal(h)); h.closed = 1; h.smooth = 0; }
    h.kind = 4;
  };

  // ---------- SVG ----------
  // Lê o atributo "d" de um <path> (M L H V C S Q T Z, maiúsculas e minúsculas); curvas viram
  // retas curtas. Devolve uma lista de subcaminhos { pts, closed }.
  G.parsePathD = d => {
    const tok = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const subs = [];
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, cur = null, lcx = 0, lcy = 0;
    const num = () => Number(tok[i++]);
    const isNum = () => i < tok.length && !/[a-zA-Z]/.test(tok[i]);
    const add = (x, y) => { if (!cur) { cur = { pts: [], closed: 0 }; subs.push(cur); } cur.pts.push(x, y); cx = x; cy = y; };
    const bez = (x1, y1, x2, y2, x, y) => {
      const x0 = cx, y0 = cy;
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, q = 1 - t;
        add(q * q * q * x0 + 3 * q * q * t * x1 + 3 * q * t * t * x2 + t * t * t * x, q * q * q * y0 + 3 * q * q * t * y1 + 3 * q * t * t * y2 + t * t * t * y);
      }
      lcx = x2; lcy = y2;
    };
    while (i < tok.length) {
      if (!isNum()) cmd = tok[i++];
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === 'Z') { if (cur) { cur.closed = 1; cx = sx; cy = sy; } cur = null; continue; }
      if (!isNum()) { i++; continue; }
      if (C === 'M') { cur = null; const x = ox + num(), y = oy + num(); add(x, y); sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') add(ox + num(), oy + num());
      else if (C === 'H') add(ox + num(), cy);
      else if (C === 'V') add(cx, oy + num());
      else if (C === 'C') { const a = ox + num(), b = oy + num(), c = ox + num(), e = oy + num(); bez(a, b, c, e, ox + num(), oy + num()); }
      else if (C === 'S') { const a = 2 * cx - lcx, b = 2 * cy - lcy, c = ox + num(), e = oy + num(); bez(a, b, c, e, ox + num(), oy + num()); }
      else if (C === 'Q' || C === 'T') {
        let qx, qy;
        if (C === 'Q') { qx = ox + num(); qy = oy + num(); } else { qx = 2 * cx - lcx; qy = 2 * cy - lcy; }
        const x = ox + num(), y = oy + num();
        bez(cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
        lcx = qx; lcy = qy;
      } else i++; // A (arco) e outros: pula o número
    }
    return subs.filter(sp => sp.pts.length >= 4);
  };
  // Lê um arquivo SVG: <path d>, <polygon>/<polyline points>, <rect>, <circle>, <ellipse>
  G.parseSVG = text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const subs = [];
    doc.querySelectorAll('path').forEach(el => subs.push(...G.parsePathD(el.getAttribute('d') || '')));
    doc.querySelectorAll('polygon, polyline').forEach(el => {
      const n = (el.getAttribute('points') || '').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
      if (n.length >= 4) subs.push({ pts: n.map(Number), closed: el.tagName.toLowerCase() === 'polygon' ? 1 : 0 });
    });
    doc.querySelectorAll('rect').forEach(el => {
      const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0, w = +el.getAttribute('width') || 0, h = +el.getAttribute('height') || 0;
      if (w && h) subs.push({ pts: [x, y, x + w, y, x + w, y + h, x, y + h], closed: 1 });
    });
    doc.querySelectorAll('circle, ellipse').forEach(el => {
      const cx = +el.getAttribute('cx') || 0, cy = +el.getAttribute('cy') || 0;
      const rx = +(el.getAttribute('r') || el.getAttribute('rx')) || 0, ry = +(el.getAttribute('r') || el.getAttribute('ry')) || 0;
      if (rx && ry) { const o = []; for (let k = 0; k < 24; k++) { const a = TAU * k / 24; o.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); } subs.push({ pts: o, closed: 1 }); }
    });
    return subs;
  };
  // Cria Formas "caminho" a partir do SVG: tudo encaixado num quadrado de "fit" px no centro.
  // Cada subcaminho vira uma Forma; com mais de uma, elas já vêm agrupadas.
  G.shapesFromSVG = (text, fit = 360) => {
    let subs = G.parseSVG(text);
    if (!subs.length) return [];
    subs = subs.slice(0, 32);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sp of subs) for (let i = 0; i < sp.pts.length; i += 2) { x0 = Math.min(x0, sp.pts[i]); x1 = Math.max(x1, sp.pts[i]); y0 = Math.min(y0, sp.pts[i + 1]); y1 = Math.max(y1, sp.pts[i + 1]); }
    const k = fit / Math.max(1, x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return subs.map(sp => {
      let pts = sp.pts.map((v, i) => (v - (i % 2 ? my : mx)) * k);
      if (pts.length > MAX() * 2) pts = G.simplify(pts, sp.closed, 1.5);
      if (pts.length > MAX() * 2) pts = pts.slice(0, MAX() * 2);
      const h = PF.hz.create('shape', W / 2, H / 2, 0);
      Object.assign(h, { kind: 4, pts: clean(pts), closed: sp.closed, smooth: 0, hollow: 0, stroke: 8 });
      G.recenter(h);
      // o pivô volta para onde estava o desenho (posição no mapa = centro do SVG)
      const [px, py] = [-h.pivotX, -h.pivotY];
      h.x = W / 2 + px; h.y = H / 2 + py; h.pivotX = 0; h.pivotY = 0;
      return h;
    });
  };
  // Exporta as formas (caminho ou não) como SVG no tamanho da arena, na pose de repouso
  G.toSVG = list => {
    const paths = [];
    for (const h of list) {
      if (h.type !== 'shape') continue;
      const m = PF.hz.shapeMatrix(h);
      const loc = h.kind === 3 ? [-h.w / 2, 0, h.w / 2, 0] : PF.hz.shapeLocal(h);
      const pts = [];
      for (let i = 0; i < loc.length; i += 2) pts.push(PF.m.apply(m, loc[i], loc[i + 1]).map(v => r2(v)).join(','));
      const closed = h.kind !== 3 && (h.kind !== 4 || h.closed);
      const filled = closed && !h.hollow;
      const sw = h.kind === 3 ? h.h : h.stroke;
      paths.push(`<path d="M${pts.join(' L')}${closed ? ' Z' : ''}" fill="${filled ? '#FF4D5E' : 'none'}" stroke="${filled ? 'none' : '#FF4D5E'}" stroke-width="${filled ? 0 : sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n  <rect width="${W}" height="${H}" fill="#0B1416"/>\n  ${paths.join('\n  ')}\n</svg>\n`;
  };
  G.download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
})();
