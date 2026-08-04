import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Info, Play, AlertTriangle, XCircle, CheckCircle, Undo2, Settings2, Minus, Plus, Download, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { applyUpdate } from './src/pwa.js';

// ==========================================
// 1. サウンドエンジン (Web Audio API)
// ==========================================
let audioCtx = null;

const initAudio = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
};

const playSound = (type) => {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  switch (type) {
    case 'move':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;
    case 'wall':
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
      break;
    case 'error':
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.linearRampToValueAtTime(180, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      break;
    case 'undo':
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      break;
    case 'win': {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        o.connect(g);
        g.connect(audioCtx.destination);
        
        const t = now + (i * 0.15);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        
        o.start(t);
        o.stop(t + 0.5);
      });
      break;
    }
  }
};

// ==========================================
// 2. ヘルパーコンポーネント & ロジック
// ==========================================
// ベースライン（文字の底辺）が揃うように最適化したルビコンポーネント
//
// ⚠️ rt に色を当ててはいけない。
//    ここに text-gray-500 を決め打ちしていたため、青や赤のボタンの上に
//    ふりがなが重なると比 1.07〜1.31 になり、ほとんど読めなかった。
//    ふりがなが要るのは低学年の児童なので、いちばん読めなくて困る人が
//    いちばん読めない形になっていた。
//    色は styles.css の `ruby rt { color: inherit }` で親から継がせる。
//    こうすると、どんな面の上でも本文と同じ比が保証される。
const R = ({ t, r }) => (
  <ruby className="align-baseline" style={{ rubyPosition: 'over' }}>
    {t}<rt className="text-[0.6em] font-normal leading-none select-none pointer-events-none">{r}</rt>
  </ruby>
);

const isWallBlocking = (r1, c1, r2, c2, walls) => {
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

const isValidMove = (player, targetR, targetC, pid, players, walls) => {
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
      return !isWallBlocking(player.row, player.col, midR, midC, walls) && 
             !isWallBlocking(midR, midC, targetR, targetC, walls);
    }
  }
  return false;
};

const pathExists = (pid, players, walls, boardSize) => {
  const p = players[pid];
  let queue = [{ r: p.row, c: p.col }];
  let visited = new Set([`${p.row},${p.col}`]);
  const dirs = [{dr: -1, dc: 0}, {dr: 1, dc: 0}, {dr: 0, dc: -1}, {dr: 0, dc: 1}];
  
  while (queue.length > 0) {
    const {r, c} = queue.shift();
    if (c === p.goalCol) return true;
    for (const d of dirs) {
      const nr = r + d.dr, nc = c + d.dc;
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

// メッセージをJSX (spanタグ付き) で返すように変更し、ルビを適用
const validateWall = (r, c, orientation, walls, boardSize, players) => {
  if (orientation === 'v' && r >= boardSize - 1) return <span><R t="下" r="した"/>にはみ<R t="出" r="だ"/>してしまいます。</span>;
  if (orientation === 'v' && c >= boardSize - 1) return <span><R t="外枠" r="そとわく"/>には<R t="置" r="お"/>けません。</span>;
  if (orientation === 'h' && c >= boardSize - 1) return <span><R t="右" r="みぎ"/>にはみ<R t="出" r="だ"/>してしまいます。</span>;
  if (orientation === 'h' && r >= boardSize - 1) return <span><R t="外枠" r="そとわく"/>には<R t="置" r="お"/>けません。</span>;

  for (const w of walls) {
    if (w.row === r && w.col === c && w.orientation === orientation) return <span>そこにカベはあります。</span>;
    if (w.row === r && w.col === c) return <span>カベがクロスしてしまいます。</span>;
    if (orientation === 'h' && w.orientation === 'h' && w.row === r && Math.abs(w.col - c) === 1) return <span>カベが<R t="重" r="かさ"/>なります。</span>;
    if (orientation === 'v' && w.orientation === 'v' && w.col === c && Math.abs(w.row - r) === 1) return <span>カベが<R t="重" r="かさ"/>なります。</span>;
  }

  const tempWalls = [...walls, { row: r, col: c, orientation }];
  if (!pathExists(1, players, tempWalls, boardSize) || !pathExists(2, players, tempWalls, boardSize)) {
    return <span>ゴールへの<R t="道" r="みち"/>がなくなってしまいます！</span>;
  }
  return null;
};

// Appの外で定義することで、再レンダー時の不要な再マウントを防ぐ
const PlayerPanel = ({ player, turn, winner, wallsLeft }) => {
  const isTurn = turn === player && !winner;
  const isP1 = player === 1;
  return (
    <div className={`player-panel p-3 rounded-2xl border-2 transition-all duration-300 ${isTurn ? 'bg-white shadow-xl scale-105 ring-4' : 'bg-white/60 opacity-80 border-transparent'} ${isP1 ? (isTurn ? 'border-blue-400 ring-blue-300' : '') : (isTurn ? 'border-red-400 ring-red-300' : '')}`}>
      <div className={`panel-title font-bold text-center ${isP1 ? 'text-blue-600' : 'text-red-600'}`}>
        <span>{isP1 ? <R t="青" r="あお" /> : <R t="赤" r="あか" />}チーム</span>
      </div>
      <div className="flex items-center justify-center gap-3 my-2">
        <span className="panel-piece filter drop-shadow-md" aria-hidden="true">{isP1 ? '🔵' : '🔴'}</span>
        <div className="leading-none text-left">
          <div className="text-xs text-gray-600 mb-1 font-bold"><span>のこりカベ</span></div>
          <div className="font-black fs-count text-gray-800"
            aria-label={`のこりカベ ${wallsLeft[player]}枚`}>
            <span aria-hidden="true">{wallsLeft[player]}<span className="text-sm font-normal ml-1 text-gray-600"><span><R t="枚" r="まい"/></span></span></span>
          </div>
        </div>
      </div>
      <div className={`panel-hint mt-3 py-2 px-2 rounded-xl text-center font-bold text-sm text-white shadow-sm ${isP1 ? 'bg-blue-600' : 'bg-red-600'}`}>
        {isP1 ? <span><R t="右" r="みぎ"/>へ<R t="進" r="すす"/>め！ 👉</span> : <span>👈 <R t="左" r="ひだり"/>へ<R t="進" r="すす"/>め！</span>}
      </div>
    </div>
  );
};

// ==========================================
// 3. メインアプリケーション
// ==========================================
export default function App() {
  const [screen, setScreen] = useState('setup');
  const [boardSize, setBoardSize] = useState(9);
  
  const [setupWalls, setSetupWalls] = useState({ 1: 10, 2: 10 });
  const [players, setPlayers] = useState({ 1: { row: 4, col: 0, goalCol: 8 }, 2: { row: 4, col: 8, goalCol: 0 } });
  const [walls, setWalls] = useState([]);
  const [turn, setTurn] = useState(1);
  const [wallsLeft, setWallsLeft] = useState({ 1: 10, 2: 10 });
  const [winner, setWinner] = useState(null);
  
  const [mode, setMode] = useState('move');
  const [wallOrientation, setWallOrientation] = useState('v');
  const [hoverCell, setHoverCell] = useState(null);
  const [history, setHistory] = useState([]);
  const [modal, setModal] = useState({ show: false });
  const [presentation, setPresentation] = useState(false);
  // すでにホーム画面から起動している端末には案内しない。
  // 初期値で判定しておくと、描画のあとに setState する必要がなくなる。
  const [installAvailable, setInstallAvailable] = useState(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    return !standalone && !!window.__pwaInstallPrompt;
  });
  const [updateReady, setUpdateReady] = useState(false);

  /*
   * キーボードだけで遊べるようにするための「いま選んでいるマス」。
   *
   * 盤面のマスは <div onClick> で、tabindex も role も無かった。
   * つまりマウスやタッチが使えない児童は、1手も指せない状態だった。
   * 矢印キーで動かし、Enter か Space で決める形にする。
   * グリッド全体で Tab を1回だけ受けたいので、選んでいるマスだけ tabIndex=0 にする
   * （roving tabindex。81マスを Tab で順に辿らせない）。
   */
  const [cursor, setCursor] = useState({ r: 0, c: 0 });
  const cellRefs = useRef({});
  const modalRef = useRef(null);
  const lastFocusRef = useRef(null);

  /*
   * インストールの案内と、更新の案内。
   *
   * インストールボタンは「案内できるときだけ」出す。
   * 出せないボタンを置いておくと「押しても何も起きない」と言われる。
   * 合図（beforeinstallprompt）は install-hook.js が <head> の先頭で受け取っている。
   */
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;

    const onAvailable = () => { if (!standalone) setInstallAvailable(true); };
    const onInstalled = () => setInstallAvailable(false);
    const onUpdate = () => setUpdateReady(true);

    window.addEventListener('pwa-install-available', onAvailable);
    window.addEventListener('pwa-installed', onInstalled);
    window.addEventListener('pwa-update-ready', onUpdate);
    return () => {
      window.removeEventListener('pwa-install-available', onAvailable);
      window.removeEventListener('pwa-installed', onInstalled);
      window.removeEventListener('pwa-update-ready', onUpdate);
    };
  }, []);

  const handleInstall = async () => {
    const prompt = window.__pwaInstallPrompt;
    if (!prompt) return;
    window.__pwaInstallPrompt = null;
    setInstallAvailable(false);
    prompt.prompt();
    await prompt.userChoice;
  };

  // 提示モード（電子黒板・大型提示装置）。
  // 4K を 65〜75インチで教室の後ろから見ると、通常サイズの文字は読めない。
  // 文字の大きさは CSS 変数を .presentation でまとめて上書きしている。
  useEffect(() => {
    document.body.classList.toggle('presentation', presentation);
    return () => document.body.classList.remove('presentation');
  }, [presentation]);

  const togglePresentation = () => {
    const next = !presentation;
    setPresentation(next);
    // 全画面にできる端末では合わせて切り替える（できなくても提示モード自体は効く）
    if (next && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (!next && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const handleBoardSizeChange = (size) => {
    setBoardSize(size);
    const defaultWalls = size === 9 ? 10 : Math.floor((size * size) / 8);
    setSetupWalls({ 1: defaultWalls, 2: defaultWalls });
  };

  useEffect(() => {
    if (modal.show && modal.timer) {
      const t = setTimeout(() => setModal(m => ({ ...m, show: false })), modal.timer);
      return () => clearTimeout(t);
    }
  }, [modal]);

  const showModal = (config) => setModal({ show: true, ...config });

  /*
   * モーダルの作法。
   *
   * これまで role も aria-modal も無く、Esc も効かず、フォーカスも閉じ込めていなかった。
   * 「あそびかた」を開いたまま Tab を押すと、背面の盤面へ抜けていた。
   *
   * ・開いたら中の最初のボタンへフォーカスを移す（読み上げが本文から始まる）
   * ・Tab は中で巡回させる
   * ・Esc で閉じる。閉じ方は自動で消えるときと同じ経路に繋ぐ（挙動を一致させる）
   * ・閉じたら、開く前に居た場所へフォーカスを戻す
   */
  useEffect(() => {
    if (!modal.show) return undefined;
    const node = modalRef.current;
    if (!node) return undefined;
    lastFocusRef.current = document.activeElement;

    const focusables = () => Array.from(node.querySelectorAll(
      'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ));
    (focusables()[0] || node).focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setModal((m) => ({ ...m, show: false }));
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const back = lastFocusRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, [modal.show]);

  const handleStart = () => {
    initAudio();
    const center = Math.floor(boardSize / 2);
    setPlayers({
      1: { row: center, col: 0, goalCol: boardSize - 1 },
      2: { row: center, col: boardSize - 1, goalCol: 0 }
    });
    setWalls([]);
    setTurn(1);
    setWallsLeft({ 1: setupWalls[1], 2: setupWalls[2] });
    setWinner(null);
    setMode('move');
    setHistory([]);
    setCursor({ r: center, c: 0 });   // キーボード操作の起点は先手の駒
    setScreen('game');
  };

  const handleUndo = () => {
    if (history.length === 0 || winner) return;
    playSound('undo');
    const lastState = history[history.length - 1];
    setPlayers(lastState.players);
    setWalls(lastState.walls);
    setTurn(lastState.turn);
    setWallsLeft(lastState.wallsLeft);
    setHistory(prev => prev.slice(0, -1));
  };

  const switchTurn = () => setTurn(t => t === 1 ? 2 : 1);

  const saveHistory = () => {
    setHistory(prev => [...prev, {
      players: JSON.parse(JSON.stringify(players)),
      walls: [...walls],
      turn,
      wallsLeft: { ...wallsLeft }
    }]);
  };

  const handleCellClick = (r, c) => {
    if (winner) return;
    initAudio();

    if (mode === 'move') {
      if (isValidMove(players[turn], r, c, turn, players, walls)) {
        saveHistory();
        playSound('move');
        
        setPlayers(prev => ({
          ...prev,
          [turn]: { ...prev[turn], row: r, col: c }
        }));
        setCursor({ r, c });
        
        if (c === players[turn].goalCol) {
          setWinner(turn);
          playSound('win');
          showModal({
            type: 'success',
            title: <span><R t="勝負" r="しょうぶ" />あり！</span>,
            content: (
              <div className="text-xl font-bold mt-2 animate-bounce">
                <span>🎉 {turn === 1 ? <span className="text-blue-600"><R t="青" r="あお"/>チーム</span> : <span className="text-red-600"><R t="赤" r="あか"/>チーム</span>}の<R t="勝" r="か"/>ち！ 🎉</span>
              </div>
            ),
            confirmText: <span>もう<R t="一回" r="いっかい"/><R t="遊" r="あそ"/>ぶ</span>,
            onConfirm: () => setScreen('setup')
          });
        } else {
          switchTurn();
        }
      }
    } else {
      if (wallsLeft[turn] <= 0) {
        playSound('error');
        showModal({
          type: 'warning',
          title: <span>カベがありません！</span>,
          content: <span>もうカベを<R t="使" r="つか"/>い<R t="切" r="き"/>ってしまいました。<br/><R t="動" r="うご"/>かしてください。</span>,
          timer: 2000
        });
        return;
      }
      const errorMsg = validateWall(r, c, wallOrientation, walls, boardSize, players);
      if (errorMsg) {
        playSound('error');
        showModal({ type: 'error', title: <span><R t="置" r="お"/>けません</span>, content: errorMsg, timer: 1500 });
        return;
      }

      saveHistory();
      playSound('wall');
      setWalls(prev => [...prev, { row: r, col: c, orientation: wallOrientation }]);
      setWallsLeft(prev => ({ ...prev, [turn]: prev[turn] - 1 }));
      switchTurn();
    }
  };

  /*
   * 盤面のキーボード操作。
   * 矢印キーで選ぶマスを動かし、Enter か Space で決める。
   * カベモードでは、選んだマスがそのままカベの置き場所の下見（プレビュー）になる。
   */
  const handleCellKeyDown = (e, r, c) => {
    const DIRS = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    if (DIRS[e.key]) {
      e.preventDefault();
      const nr = Math.min(boardSize - 1, Math.max(0, r + DIRS[e.key][0]));
      const nc = Math.min(boardSize - 1, Math.max(0, c + DIRS[e.key][1]));
      setCursor({ r: nr, c: nc });
      if (mode === 'wall') setHoverCell({ r: nr, c: nc });
      cellRefs.current[`${nr},${nc}`]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCellClick(r, c);
    }
  };

  /*
   * 画面の変化を読み上げてもらうための文言。
   * 目で見て分かること（手番の色・のこりカベ）を、見えない人にも同じだけ伝える。
   */
  const liveMessage = winner
    ? `${winner === 1 ? '青' : '赤'}チームの勝ちです`
    : screen === 'game'
      ? `${turn === 1 ? '青' : '赤'}チームの番です。のこりカベ ${wallsLeft[turn]}枚。`
        + `${mode === 'move' ? 'いまはコマを動かします' : `いまはカベを${wallOrientation === 'v' ? 'タテ' : 'ヨコ'}に置きます`}`
      : '';

  // 現在の手番で移動できるマスを事前計算（毎セルの再計算を避ける）
  const validMoveSet = useMemo(() => {
    const set = new Set();
    if (winner || mode !== 'move') return set;
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (isValidMove(players[turn], r, c, turn, players, walls)) set.add(`${r},${c}`);
      }
    }
    return set;
  }, [players, walls, turn, mode, winner, boardSize]);

  const GAP = 4;
  const getPositionStyle = (r, c) => ({
    left: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize} * ${c} + ${GAP * c}px)`,
    top: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize} * ${r} + ${GAP * r}px)`,
    width: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize})`,
    height: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize})`,
  });

  const showRules = () => {
    showModal({
      type: 'info',
      title: <span>あそびかた</span>,
      content: (
        <div className="space-y-5 text-left font-sans mt-2">
          {/* Rule 1 */}
          <div className="p-4 bg-[#f9fbe7] rounded-xl border-2 border-[#e6ee9c]">
            <div className="font-bold text-[#33691e] text-lg flex items-center mb-3">
              <span className="bg-white rounded-full w-10 h-10 flex items-center justify-center shadow-sm mr-3 text-xl">1</span>
              <span>ゴールを<R t="目指" r="めざ"/>せ！</span>
            </div>
            <div className="text-3xl text-center my-4 tracking-widest leading-tight">🔵 ➡ 🏁 &nbsp; 🏁 ⬅ 🔴</div>
            <div className="text-[15px] leading-relaxed text-gray-700 font-medium">
              <span><R t="青" r="あお"/>は<R t="右" r="みぎ"/>へ、<R t="赤" r="あか"/>は<R t="左" r="ひだり"/>の<R t="端" r="はし"/>まで<R t="進" r="すす"/>めば<R t="勝" r="か"/>ち！</span>
            </div>
          </div>
          {/* Rule 2 */}
          <div className="p-4 bg-[#f9fbe7] rounded-xl border-2 border-[#e6ee9c]">
            <div className="font-bold text-[#33691e] text-lg flex items-center mb-3">
              <span className="bg-white rounded-full w-10 h-10 flex items-center justify-center shadow-sm mr-3 text-xl">2</span>
              <span>どっちか1つ</span>
            </div>
            <div className="text-3xl text-center my-4">🏃 <span className="text-base text-gray-500 mx-2 font-bold">または</span> 🚧</div>
            <div className="text-[15px] leading-relaxed text-gray-700 font-medium">
              <span><R t="自分" r="じぶん"/>の<R t="番" r="ばん"/>に「コマを1マス<R t="動" r="うご"/>かす」か「カベを<R t="置" r="お"/>く」か<R t="選" r="えら"/>ぼう。</span>
            </div>
          </div>
          {/* Rule 3 */}
          <div className="p-4 bg-[#f9fbe7] rounded-xl border-2 border-[#e6ee9c]">
            <div className="font-bold text-[#33691e] text-lg flex items-center mb-3">
              <span className="bg-white rounded-full w-10 h-10 flex items-center justify-center shadow-sm mr-3 text-xl">3</span>
              <span><R t="邪魔" r="じゃま"/>しよう</span>
            </div>
            <div className="text-3xl text-center my-4 leading-tight">
              🚧🏃🚧 &nbsp; 🆗<br/>
              <span className="text-lg text-red-600 font-bold mt-2 inline-block">❌ <R t="閉" r="と"/>じ<R t="込" r="こ"/>めはダメ！</span>
            </div>
            <div className="text-[15px] leading-relaxed text-gray-700 font-medium">
              <span><R t="相手" r="あいて"/>の<R t="道" r="みち"/>をふさごう！でも、ゴールへの<R t="道" r="みち"/>を<R t="完全" r="かんぜん"/>になくすのは<R t="反則" r="はんそく"/>だよ。</span>
            </div>
          </div>
        </div>
      ),
      confirmText: <span>わかった！</span>
    });
  };

  return (
    <div 
      className="app-shell flex flex-col font-sans text-gray-800 selection:bg-yellow-300 overscroll-none"
      style={{
        backgroundColor: '#fff9c4',
        backgroundImage: 'radial-gradient(#ffe082 20%, transparent 20%), radial-gradient(#ffe082 20%, transparent 20%)',
        backgroundPosition: '0 0, 25px 25px', backgroundSize: '50px 50px',
      }}
    >
      <nav className="bg-white/90 backdrop-blur shadow-sm sticky top-0 z-40 border-b-4 border-yellow-300 px-4 py-3 flex justify-between items-center">
        <h1 className="font-black fs-nav text-blue-600 flex items-center gap-2 m-0">
          <span>🚧 カベ<R t="合戦" r="がっせん"/>！</span>
        </h1>
        <div className="flex gap-2">
          {screen === 'game' && (
            <button
              onClick={handleUndo}
              aria-label="一手もどす"
              disabled={history.length === 0 || !!winner}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full font-bold border-2 transition-all ${
                history.length > 0 && !winner 
                ? 'border-indigo-500 text-indigo-600 hover:bg-indigo-50 active:scale-95' 
                : 'border-gray-300 text-gray-400 opacity-50 cursor-not-allowed'
              }`}
            >
              <Undo2 size={18} aria-hidden="true" /> <span className="text-sm hidden sm:inline"><span><R t="待" r="ま"/>った！</span></span>
            </button>
          )}
          {installAvailable && (
            <button
              onClick={handleInstall}
              aria-label="このアプリを端末にインストールする"
              className="flex items-center gap-1 px-3 py-1.5 rounded-full font-bold border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 active:scale-95 transition-all"
            >
              <Download size={18} aria-hidden="true" />
              <span className="text-sm hidden sm:inline">アプリにする</span>
            </button>
          )}
          <button
            onClick={togglePresentation}
            aria-label={presentation ? '大きく表示をやめる' : '大きく表示する（電子黒板むけ）'}
            aria-pressed={presentation}
            className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-transform active:scale-90 ${
              presentation ? 'border-amber-700 bg-amber-100 text-amber-900' : 'border-gray-400 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {presentation ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
          </button>
          <button
            onClick={showRules}
            aria-label="あそびかたを見る"
            className="w-11 h-11 rounded-full border-2 border-blue-600 text-blue-700 flex items-center justify-center hover:bg-blue-50 active:scale-90 transition-transform font-bold"
          >？</button>
        </div>
      </nav>

      {/*
        画面の変化（手番の交代・勝敗）を読み上げる。
        見て分かることを、見えない人にも同じだけ伝えるための領域。
        目には見えないので、置き場所は本文の前でよい。
      */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</p>

      <main className="flex-grow flex flex-col pt-4 pb-32">
        {screen === 'setup' ? (
          <div className="flex-grow flex items-center justify-center p-4">
            <div className="bg-white/95 backdrop-blur-sm p-6 sm:p-8 rounded-3xl shadow-xl w-full max-w-md text-center border-4 border-white">
              <h2 className="fs-title font-black text-blue-600 mb-2 animate-pulse"><span><R t="道" r="みち"/>を<R t="切" r="き"/>り<R t="拓" r="ひら"/>け！</span></h2>
              <p className="text-gray-500 mb-6 font-medium"><span><R t="相手" r="あいて"/>のゴールを<R t="目指" r="めざ"/>す<R t="対戦" r="たいせん"/>パズル</span></p>
              
              <div className="bg-gray-50 p-4 rounded-2xl mb-4 text-left border border-gray-100">
                <label htmlFor="board-size" className="block font-bold text-gray-700 mb-2"><span>ボードの<R t="大" r="おお"/>きさ</span></label>
                <select 
                  id="board-size"
                  value={boardSize} 
                  onChange={e => handleBoardSizeChange(Number(e.target.value))}
                  className="w-full p-3 rounded-xl border-2 border-gray-300 bg-white font-bold text-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value={7}>7x7 (ふつう)</option>
                  <option value={9}>9x9 (むずかしい)</option>
                  <option value={5}>5x5 (かんたん)</option>
                </select>
              </div>

              <div className="bg-orange-50 p-4 rounded-2xl mb-8 text-left border border-orange-100">
                <label className="flex items-center gap-2 font-bold text-orange-800 mb-3">
                  <Settings2 size={18} aria-hidden="true" /> <span>ハンデ<R t="設定" r="せってい"/>（カベの<R t="枚数" r="まいすう"/>）</span>
                </label>
                <div className="flex justify-between items-center mb-3">
                  <span className="font-bold text-blue-600"><span><R t="青" r="あお"/>チーム</span></span>
                  <div className="flex items-center gap-3">
                    <button aria-label="青チームのカベを1まいへらす" onClick={() => setSetupWalls(p => ({...p, 1: Math.max(0, p[1]-1)}))} className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold hover:bg-blue-200 active:scale-90"><Minus size={16} aria-hidden="true" /></button>
                    <span className="w-6 text-center font-bold text-xl">{setupWalls[1]}</span>
                    <button aria-label="青チームのカベを1まいふやす" onClick={() => setSetupWalls(p => ({...p, 1: Math.min(20, p[1]+1)}))} className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold hover:bg-blue-200 active:scale-90"><Plus size={16} aria-hidden="true" /></button>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-red-600"><span><R t="赤" r="あか"/>チーム</span></span>
                  <div className="flex items-center gap-3">
                    <button aria-label="赤チームのカベを1まいへらす" onClick={() => setSetupWalls(p => ({...p, 2: Math.max(0, p[2]-1)}))} className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold hover:bg-red-200 active:scale-90"><Minus size={16} aria-hidden="true" /></button>
                    <span className="w-6 text-center font-bold text-xl">{setupWalls[2]}</span>
                    <button aria-label="赤チームのカベを1まいふやす" onClick={() => setSetupWalls(p => ({...p, 2: Math.min(20, p[2]+1)}))} className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold hover:bg-red-200 active:scale-90"><Plus size={16} aria-hidden="true" /></button>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleStart}
                className="w-full py-4 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all text-white font-black text-xl shadow-lg shadow-blue-600/30 flex justify-center items-center gap-2"
              >
                <Play fill="currentColor" aria-hidden="true" /> <span>ゲーム<R t="開始" r="かいし"/>！</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="game-layout flex flex-col wide:flex-row items-center wide:items-stretch justify-center gap-4 px-4 max-w-5xl mx-auto w-full">
            <div className="hidden wide:flex flex-col justify-center w-56 flex-shrink-0"><PlayerPanel player={1} turn={turn} winner={winner} wallsLeft={wallsLeft} /></div>

            <div className="board-column w-full flex-shrink-0 order-1 wide:order-2">
              <div className="turn-banner text-center mb-4 h-10">
                {!winner && (
                  <div className={`inline-block px-6 py-2 rounded-full fs-turn font-bold shadow-sm border-2 transition-colors ${turn === 1 ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
                    {turn === 1 ? <span><R t="青" r="あお"/>チームの<R t="番" r="ばん"/>です</span> : <span><R t="赤" r="あか"/>チームの<R t="番" r="ばん"/>です</span>}
                  </div>
                )}
              </div>

              <div className="bg-white/80 p-3 md:p-4 rounded-3xl shadow-xl border-4 border-white backdrop-blur-sm relative">
                
                <div className="relative w-full aspect-square touch-manipulation" onMouseLeave={() => setHoverCell(null)}>
                  
                  <div
                    className="absolute inset-0"
                    role="grid"
                    aria-label="ゲームばん。やじるしキーで えらび、Enter か Space できめます"
                    style={{ display: 'grid', gridTemplateColumns: `repeat(${boardSize}, 1fr)`, gridTemplateRows: `repeat(${boardSize}, 1fr)`, gap: `${GAP}px` }}
                  >
                    {Array.from({ length: boardSize * boardSize }).map((_, i) => {
                      const r = Math.floor(i / boardSize);
                      const c = i % boardSize;
                      const isHighlighted = validMoveSet.has(`${r},${c}`);
                      const occupant = players[1].row === r && players[1].col === c ? '青のコマ'
                        : players[2].row === r && players[2].col === c ? '赤のコマ' : '';
                      // roving tabindex。81マスを Tab で順に辿らせないため、
                      // Tab で入れるのは「いま選んでいるマス」1つだけにする。
                      const isCursor = cursor.r === r && cursor.c === c;
                      return (
                        <div key={i}
                          ref={(el) => { cellRefs.current[`${r},${c}`] = el; }}
                          className="board-cell rounded-lg bg-[#f1f3f4] hover:bg-[#e3f2fd] transition-colors cursor-pointer flex items-center justify-center relative"
                          role="gridcell"
                          tabIndex={isCursor ? 0 : -1}
                          aria-label={`${r + 1}だん ${c + 1}れつ`
                            + `${occupant ? `、${occupant}` : ''}`
                            + `${isHighlighted ? '、ここへ うごけます' : ''}`}
                          onMouseEnter={mode === 'wall' ? () => setHoverCell({r, c}) : undefined}
                          onFocus={() => { setCursor({ r, c }); if (mode === 'wall') setHoverCell({ r, c }); }}
                          onClick={() => handleCellClick(r, c)}
                          onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                        >
                          {isHighlighted && <div className="board-cell-hint w-1/3 h-1/3 rounded-full bg-green-600/60 pointer-events-none animate-pulse" />}
                        </div>
                      );
                    })}
                  </div>

                  <div 
                    className="absolute z-10 flex items-center justify-center text-xl sm:text-3xl filter drop-shadow-md"
                    style={{ ...getPositionStyle(players[1].row, players[1].col), transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="pawn-piece w-[80%] h-[80%] rounded-full bg-gradient-to-br from-blue-300 to-blue-600 border-[3px] border-white shadow-lg flex items-center justify-center">🔵</div>
                  </div>
                  <div 
                    className="absolute z-10 flex items-center justify-center text-xl sm:text-3xl filter drop-shadow-md"
                    style={{ ...getPositionStyle(players[2].row, players[2].col), transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="pawn-piece w-[80%] h-[80%] rounded-full bg-gradient-to-br from-red-300 to-red-600 border-[3px] border-white shadow-lg flex items-center justify-center">🔴</div>
                  </div>

                  {walls.map((w, i) => {
                    const style = getPositionStyle(w.row, w.col);
                    const wallStyle = { backgroundColor: '#8d6e63', backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.1), rgba(255,255,255,0.1) 5px, transparent 5px, transparent 10px)' };
                    return w.orientation === 'h' 
                      ? <div key={`w-${i}`} className="wall-piece absolute z-20 shadow-md border border-white/20 rounded-sm" style={{ ...wallStyle, left: style.left, top: `calc(${style.top} + ${style.height} + ${GAP/2}px - 4px)`, width: `calc(${style.width} * 2 + ${GAP}px)`, height: '8px' }} />
                      : <div key={`w-${i}`} className="wall-piece absolute z-20 shadow-md border border-white/20 rounded-sm" style={{ ...wallStyle, left: `calc(${style.left} + ${style.width} + ${GAP/2}px - 4px)`, top: style.top, height: `calc(${style.height} * 2 + ${GAP}px)`, width: '8px' }} />;
                  })}

                  {mode === 'wall' && hoverCell && !winner && (() => {
                    const previewError = validateWall(hoverCell.r, hoverCell.c, wallOrientation, walls, boardSize, players);
                    const style = getPositionStyle(hoverCell.r, hoverCell.c);
                    const color = previewError ? '#ef4444' : '#fbbf24';
                    return wallOrientation === 'h'
                      ? <div className="wall-preview absolute z-30 border-2 border-dashed pointer-events-none opacity-90 rounded-sm" style={{ left: style.left, top: `calc(${style.top} + ${style.height} + ${GAP/2}px - 4px)`, width: `calc(${style.width} * 2 + ${GAP}px)`, height: '8px', backgroundColor: color, borderColor: previewError ? 'white' : '#78350f' }} />
                      : <div className="wall-preview absolute z-30 border-2 border-dashed pointer-events-none opacity-90 rounded-sm" style={{ left: `calc(${style.left} + ${style.width} + ${GAP/2}px - 4px)`, top: style.top, height: `calc(${style.height} * 2 + ${GAP}px)`, width: '8px', backgroundColor: color, borderColor: previewError ? 'white' : '#78350f' }} />;
                  })()}

                </div>
              </div>
            </div>

            <div className="panel-row flex wide:hidden board-column w-full gap-2 order-2 mt-2">
              <div className="flex-1"><PlayerPanel player={1} turn={turn} winner={winner} wallsLeft={wallsLeft} /></div>
              <div className="flex-1"><PlayerPanel player={2} turn={turn} winner={winner} wallsLeft={wallsLeft} /></div>
            </div>
            <div className="hidden wide:flex flex-col justify-center w-56 flex-shrink-0 order-3"><PlayerPanel player={2} turn={turn} winner={winner} wallsLeft={wallsLeft} /></div>
          </div>
        )}
      </main>

      {/*
        あたらしい版が待機していることの案内。
        押されるまで切り替えない（対戦の途中で盤面が消えないようにするため）。
        あとから足した固定要素なので .no-print も付けておく。
      */}
      {updateReady && (
        <div className={`update-toast no-print fixed left-1/2 -translate-x-1/2 z-50 w-[min(28rem,calc(100%-1.5rem))] bg-white border-2 border-indigo-600 rounded-2xl shadow-2xl p-3 flex items-center gap-2 ${screen === 'game' && !winner ? 'above-controls' : ''}`} role="status">
          <RefreshCw size={20} className="text-indigo-700 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-sm font-bold text-gray-800">
            あたらしい ばんが あります
          </span>
          <button
            onClick={() => { setUpdateReady(false); applyUpdate(); }}
            className="px-3 py-2 rounded-full bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-sm"
          >
            さいしんに する
          </button>
          <button
            onClick={() => setUpdateReady(false)}
            aria-label="あとにする"
            className="w-11 h-11 rounded-full text-gray-600 hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* フッター */}
      <footer className="text-center text-gray-600 py-3 mt-auto border-t border-yellow-300/50 bg-white/40 backdrop-blur-sm">
        <small>© 2026 カベカベ合戦！ <a href="https://note.com/cute_borage86" target="_blank" rel="noopener noreferrer" className="tap-44 no-underline text-gray-600 hover:text-gray-800 transition-colors">GIGA山</a></small>
      </footer>

      {screen === 'game' && !winner && (
        <div className="controls-bar fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-200 p-3 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-40 pb-safe">
          <div className="controls-inner max-w-3xl mx-auto flex gap-3 h-16">
            <button className={`flex-1 rounded-2xl font-bold flex flex-col items-center justify-center transition-all duration-200 ${mode === 'move' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => { setMode('move'); setHoverCell(null); }}>
              <span className="text-2xl leading-none mb-1">🏃</span><span className="text-[10px] tracking-wider"><span><R t="歩" r="ある"/>く</span></span>
            </button>
            <button className={`flex-1 rounded-2xl font-bold flex flex-col items-center justify-center transition-all duration-200 ${mode === 'wall' ? 'bg-amber-400 text-amber-900 shadow-lg shadow-amber-400/40 scale-105' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => setMode('wall')}>
              <span className="text-2xl leading-none mb-1">🚧</span><span className="text-[10px] tracking-wider">カベ</span>
            </button>
            <div className="flex-[1.2] flex items-center justify-center">
              {mode === 'move' ? (
                <div className="w-full h-full bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center text-sm font-bold text-gray-600 text-center leading-tight">
                  <span><R t="光" r="ひか"/>るマスを<br/>タップ！</span>
                </div>
              ) : (
                <button onClick={() => setWallOrientation(o => o === 'v' ? 'h' : 'v')} className="w-full h-full bg-yellow-50 hover:bg-yellow-100 border-2 border-amber-300 rounded-2xl font-bold text-amber-900 flex flex-col items-center justify-center transition-all active:scale-95">
                  <span className="text-sm"><span><R t="今" r="いま"/>は <b className="text-base">{wallOrientation === 'v' ? 'タテ' : 'ヨコ'}</b></span></span>
                  <span className="text-[10px] text-amber-700 mt-0.5"><span><R t="押" r="お"/>すと{wallOrientation === 'v' ? 'ヨコ' : 'タテ'}</span></span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            ref={modalRef}
            /* エラーと注意は「いま起きたこと」なので alertdialog にして、開いた時点で読み上げてもらう */
            role={modal.type === 'error' || modal.type === 'warning' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="modal-title"
            tabIndex={-1}
            className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl scale-100 transition-transform focus:outline-none"
          >
            <div className={`flex justify-center mb-4 ${modal.type === 'success' ? 'text-green-700' : modal.type === 'error' ? 'text-red-600' : modal.type === 'warning' ? 'text-amber-700' : 'text-blue-600'}`}>
              {modal.type === 'success' ? <CheckCircle size={56} strokeWidth={2.5} /> : modal.type === 'error' ? <XCircle size={56} strokeWidth={2.5} /> : modal.type === 'warning' ? <AlertTriangle size={56} strokeWidth={2.5} /> : <Info size={56} strokeWidth={2.5} />}
            </div>
            <h2 id="modal-title" className="text-2xl font-black text-center mb-3 text-gray-800"><span>{modal.title}</span></h2>
            <div className="text-center text-gray-600 mb-6 font-medium leading-relaxed">{modal.content}</div>
            {modal.onConfirm && (
              <button onClick={() => { modal.onConfirm(); setModal(m => ({ ...m, show: false })); }} className={`w-full py-3.5 rounded-full font-bold text-lg text-white shadow-md active:scale-95 transition-all ${modal.type === 'success' ? 'bg-green-700 hover:bg-green-800' : modal.type === 'error' ? 'bg-red-600 hover:bg-red-700' : modal.type === 'warning' ? 'bg-amber-700 hover:bg-amber-800' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {modal.confirmText}
              </button>
            )}
            {!modal.onConfirm && !modal.timer && <button onClick={() => setModal(m => ({ ...m, show: false }))} className="w-full py-2 rounded-full font-bold text-gray-600 bg-gray-100 hover:bg-gray-200"><span><R t="閉" r="と"/>じる</span></button>}
          </div>
        </div>
      )}
    </div>
  );
}
