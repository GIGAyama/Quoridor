/*
 * ゲームの決まりのうち、画面に関係しない部分。
 *
 * ここを App.jsx から出したのは、テストを書けるようにするため。
 * 「相手のゴールへの道を完全に塞ぐカベは置けない」という判定は
 * このゲームの根っこなので、壊れると児童が詰んだまま進めなくなる。
 * 関数名と引数の並びは App.jsx にあったときのまま変えていない。
 */

/**
 * 2つの隣り合うマスの間がカベで塞がれているか。
 * カベは2マスぶんの長さを持つので、両隣のどちらに掛かっていても塞がる。
 */
export const isWallBlocking = (r1, c1, r2, c2, walls) => {
  for (const w of walls) {
    if (w.orientation === 'h') {
      if (Math.abs(r1 - r2) === 1 && c1 === c2) {
        const borderRow = Math.min(r1, r2);
        if (w.row === borderRow && (c1 === w.col || c1 === w.col + 1)) return true;
      }
    } else {
      if (Math.abs(c1 - c2) === 1 && r1 === r2) {
        const borderCol = Math.min(c1, c2);
        if (w.col === borderCol && (r1 === w.row || r1 === w.row + 1)) return true;
      }
    }
  }
  return false;
};

/**
 * そのマスへ動けるか。
 * 1マス進むのが基本で、相手のコマの上には乗れない。
 * 相手と向かい合っているときだけ、飛び越して2マス進める。
 */
export const isValidMove = (player, targetR, targetC, pid, players, walls) => {
  if (player.row === targetR && player.col === targetC) return false;
  const opponentPid = pid === 1 ? 2 : 1;
  const opponent = players[opponentPid];
  const dist = Math.abs(player.row - targetR) + Math.abs(player.col - targetC);

  if (dist === 1) {
    if (targetR === opponent.row && targetC === opponent.col) return false;
    return !isWallBlocking(player.row, player.col, targetR, targetC, walls);
  }
  if (dist === 2 && (player.row === targetR || player.col === targetC)) {
    const midR = (player.row + targetR) / 2;
    const midC = (player.col + targetC) / 2;
    if (opponent.row === midR && opponent.col === midC) {
      return !isWallBlocking(player.row, player.col, midR, midC, walls)
        && !isWallBlocking(midR, midC, targetR, targetC, walls);
    }
  }
  return false;
};

/**
 * そのプレイヤーのゴール列へ、まだ道が残っているか（幅優先探索）。
 * カベを置く前にこれを見て、道が消えるなら置かせない。
 */
export const pathExists = (pid, players, walls, boardSize) => {
  const p = players[pid];
  const queue = [{ r: p.row, c: p.col }];
  const visited = new Set([`${p.row},${p.col}`]);
  const dirs = [{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }];

  while (queue.length > 0) {
    const { r, c } = queue.shift();
    if (c === p.goalCol) return true;
    for (const d of dirs) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && !visited.has(`${nr},${nc}`)) {
        if (!isWallBlocking(r, c, nr, nc, walls)) {
          visited.add(`${nr},${nc}`);
          queue.push({ r: nr, c: nc });
        }
      }
    }
  }
  return false;
};
