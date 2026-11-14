// Matemática de transformação 2D (PF.m): matriz afim [a, b, c, d, e, f]
//   x' = a·x + c·y + e     y' = b·x + d·y + f
// Usada pelas formas do modo manual (girar/escalar em volta de um pivô). Roda também no vm do servidor.
(function () {
  const Math = globalThis.Math; // local: no vm do servidor a busca global é lenta
  const D2R = Math.PI / 180;

  const M = PF.m = {
    id: () => [1, 0, 0, 1, 0, 0],
    mul: (A, B) => [
      A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
    ],
    apply: (A, x, y) => [A[0] * x + A[2] * y + A[4], A[1] * x + A[3] * y + A[5]],
    invert(A) {
      const det = A[0] * A[3] - A[1] * A[2];
      if (Math.abs(det) < 1e-12) return M.id();
      const ia = A[3] / det, ib = -A[1] / det, ic = -A[2] / det, id = A[0] / det;
      return [ia, ib, ic, id, -(ia * A[4] + ic * A[5]), -(ib * A[4] + id * A[5])];
    },
    // T(x,y) · R(rot) · S(sx,sy) · T(-pivot): o pivô (coords locais) cai em (x,y) e
    // girar/escalar acontece em volta dele. rot em graus.
    compose(x, y, rot, sx, sy, px, py) {
      const r = rot * D2R, cs = Math.cos(r), sn = Math.sin(r);
      const a = cs * sx, b = sn * sx, c = -sn * sy, d = cs * sy;
      return [a, b, c, d, x - (a * px + c * py), y - (b * px + d * py)];
    },
    // gira o ponto (x,y) em volta de (cx,cy)
    rotateAround(x, y, cx, cy, deg) {
      const r = deg * D2R, cs = Math.cos(r), sn = Math.sin(r);
      const dx = x - cx, dy = y - cy;
      return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs];
    },
  };
})();
