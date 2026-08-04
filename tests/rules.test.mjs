/*
 * ゲームの根っこの決まりのテスト。
 *
 *   node --test tests/
 *
 * ここが壊れると、児童が「置けるはずのカベが置けない」「詰んで進めない」と
 * 訴えるが、先生には理由が分からない、という形の不具合になる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWallBlocking, isValidMove, pathExists } from '../src/rules.js';

const N = 9;
const start = () => ({
  1: { row: 4, col: 0, goalCol: 8 },
  2: { row: 4, col: 8, goalCol: 0 },
});

test('カベは2マスぶんの長さを持つので、両隣のどちらの境界も塞ぐ', () => {
  // (2,3) に縦のカベ。3列目と4列目の間を、2段目と3段目にわたって塞ぐ。
  const walls = [{ row: 2, col: 3, orientation: 'v' }];
  assert.equal(isWallBlocking(2, 3, 2, 4, walls), true, '上の段が塞がっていない');
  assert.equal(isWallBlocking(3, 3, 3, 4, walls), true, '下の段が塞がっていない');
  assert.equal(isWallBlocking(4, 3, 4, 4, walls), false, '3段目まで塞いでしまっている');
  assert.equal(isWallBlocking(2, 3, 3, 3, walls), false, '縦のカベが上下の行き来を塞いでしまっている');
});

test('横のカベは上下の行き来だけを塞ぐ', () => {
  const walls = [{ row: 2, col: 3, orientation: 'h' }];
  assert.equal(isWallBlocking(2, 3, 3, 3, walls), true);
  assert.equal(isWallBlocking(2, 4, 3, 4, walls), true);
  assert.equal(isWallBlocking(2, 5, 3, 5, walls), false);
  assert.equal(isWallBlocking(2, 3, 2, 4, walls), false, '横のカベが左右を塞いでしまっている');
});

test('となりのマスへは動けるが、ナナメには動けない', () => {
  const players = start();
  assert.equal(isValidMove(players[1], 4, 1, 1, players, []), true);
  assert.equal(isValidMove(players[1], 3, 0, 1, players, []), true);
  assert.equal(isValidMove(players[1], 3, 1, 1, players, []), false, 'ナナメに動けてしまう');
  assert.equal(isValidMove(players[1], 4, 0, 1, players, []), false, 'その場に留まれてしまう');
  assert.equal(isValidMove(players[1], 4, 2, 1, players, []), false, '2マス先へ飛べてしまう');
});

test('カベの向こう側へは動けない', () => {
  const players = start();
  const walls = [{ row: 3, col: 0, orientation: 'v' }];   // 4段目・1列目と2列目の間
  assert.equal(isValidMove(players[1], 4, 1, 1, players, walls), false);
});

test('相手のコマの上には乗れないが、向かい合っていれば飛び越せる', () => {
  const players = { 1: { row: 4, col: 3, goalCol: 8 }, 2: { row: 4, col: 4, goalCol: 0 } };
  assert.equal(isValidMove(players[1], 4, 4, 1, players, []), false, '相手の上に乗れてしまう');
  assert.equal(isValidMove(players[1], 4, 5, 1, players, []), true, '飛び越せない');
});

test('飛び越した先がカベで塞がれていれば飛び越せない', () => {
  const players = { 1: { row: 4, col: 3, goalCol: 8 }, 2: { row: 4, col: 4, goalCol: 0 } };
  const walls = [{ row: 3, col: 4, orientation: 'v' }];   // 相手の向こう側
  assert.equal(isValidMove(players[1], 4, 5, 1, players, walls), false);
});

test('カベが1枚も無ければ、どちらにも道がある', () => {
  const players = start();
  assert.equal(pathExists(1, players, [], N), true);
  assert.equal(pathExists(2, players, [], N), true);
});

test('ゴールへの道を完全に塞ぐと道が無くなる（＝そのカベは置かせない）', () => {
  // 青（4段0列・ゴールは8列）の目の前を、盤の上から下まで縦のカベで塞ぐ。
  // 縦のカベは2段ぶんなので、9段を塞ぐには 0,2,4,6 段目 + 7段目 の5枚が要る。
  const players = start();
  const walls = [0, 2, 4, 6].map((row) => ({ row, col: 0, orientation: 'v' }));
  walls.push({ row: 7, col: 0, orientation: 'v' });
  assert.equal(pathExists(1, players, walls, N), false, '塞ぎきったのに道があることになっている');
});

test('1マスでも隙間が残っていれば道はある', () => {
  const players = start();
  // 7段目を抜いておく（6段目のカベが 6・7段を塞ぐので、代わりに 6 も抜く）
  const walls = [0, 2, 4].map((row) => ({ row, col: 0, orientation: 'v' }));
  assert.equal(pathExists(1, players, walls, N), true);
});

test('遠回りしてでも辿り着けるなら道はある', () => {
  const players = { 1: { row: 0, col: 0, goalCol: 8 }, 2: { row: 8, col: 8, goalCol: 0 } };
  // 0段目と1段目の間を左から塞いでいくが、右端を1つ空けておく
  const walls = [0, 2, 4, 6].map((col) => ({ row: 0, col, orientation: 'h' }));
  assert.equal(pathExists(1, players, walls, N), true);
});

test('5x5 の盤でも判定が成り立つ', () => {
  const players = { 1: { row: 2, col: 0, goalCol: 4 }, 2: { row: 2, col: 4, goalCol: 0 } };
  assert.equal(pathExists(1, players, [], 5), true);
  // 0,2 段目 + 3段目の3枚で 5段すべてを塞ぐ
  const walls = [{ row: 0, col: 0, orientation: 'v' }, { row: 2, col: 0, orientation: 'v' },
    { row: 3, col: 0, orientation: 'v' }];
  assert.equal(pathExists(1, players, walls, 5), false);
});
