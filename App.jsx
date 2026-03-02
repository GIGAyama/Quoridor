import React, { useState, useEffect } from 'react';
import { Info, Play, AlertTriangle, XCircle, CheckCircle, Undo2, Settings2, Minus, Plus } from 'lucide-react';

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
    case 'win':
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
};

// ==========================================
// 2. ヘルパーコンポーネント & ロジック
// ==========================================
// ベースライン（文字の底辺）が揃うように最適化したルビコンポーネント
const R = ({ t, r }) => (
  <ruby className="align-baseline" style={{ rubyPosition: 'over' }}>
    {t}<rt className="text-[0.6em] text-gray-500 font-normal leading-none select-none pointer-events-none">{r}</rt>
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

  // ファビコンとタイトルの設定
  useEffect(() => {
    const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = './favicon.png';
    document.head.appendChild(link);
    document.title = 'カベカベ合戦！';
  }, []);

  useEffect(() => {
    const defaultWalls = boardSize === 9 ? 10 : Math.floor((boardSize * boardSize) / 8);
    setSetupWalls({ 1: defaultWalls, 2: defaultWalls });
  }, [boardSize]);

  useEffect(() => {
    if (modal.show && modal.timer) {
      const t = setTimeout(() => setModal(m => ({ ...m, show: false })), modal.timer);
      return () => clearTimeout(t);
    }
  }, [modal]);

  const showModal = (config) => setModal({ show: true, ...config });

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
      const errorMsg = validateWall(r, c, wallOrientation, walls, boardSize, players);
      if (errorMsg) {
        playSound('error');
        showModal({ type: 'error', title: <span><R t="置" r="お"/>けません</span>, content: errorMsg, timer: 1500 });
        return;
      }
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
      
      saveHistory();
      playSound('wall');
      setWalls(prev => [...prev, { row: r, col: c, orientation: wallOrientation }]);
      setWallsLeft(prev => ({ ...prev, [turn]: prev[turn] - 1 }));
      switchTurn();
    }
  };

  const GAP = 4;
  const getPositionStyle = (r, c) => ({
    left: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize} * ${c} + ${GAP * c}px)`,
    top: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize} * ${r} + ${GAP * r}px)`,
    width: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize})`,
    height: `calc((100% - ${GAP * (boardSize - 1)}px) / ${boardSize})`,
  });

  const PlayerPanel = ({ player }) => {
    const isTurn = turn === player && !winner;
    const isP1 = player === 1;
    return (
      <div className={`p-3 rounded-2xl border-2 transition-all duration-300 ${isTurn ? 'bg-white shadow-xl scale-105 ring-4' : 'bg-white/60 opacity-80 border-transparent'} ${isP1 ? (isTurn ? 'border-blue-400 ring-blue-300' : '') : (isTurn ? 'border-red-400 ring-red-300' : '')}`}>
        <div className={`font-bold text-center text-lg ${isP1 ? 'text-blue-600' : 'text-red-600'}`}>
          <span>{isP1 ? <R t="青" r="あお" /> : <R t="赤" r="あか" />}チーム</span>
        </div>
        <div className="flex items-center justify-center gap-3 my-2">
          <span className="text-4xl filter drop-shadow-md">{isP1 ? '🔵' : '🔴'}</span>
          <div className="leading-none text-left">
            <div className="text-xs text-gray-500 mb-1 font-bold"><span>のこりカベ</span></div>
            <div className="font-black text-4xl text-gray-800">
              {wallsLeft[player]}<span className="text-sm font-normal ml-1 text-gray-500"><span><R t="枚" r="まい"/></span></span>
            </div>
          </div>
        </div>
        <div className={`mt-3 py-2 px-2 rounded-xl text-center font-bold text-sm text-white shadow-sm ${isP1 ? 'bg-blue-500' : 'bg-red-500'}`}>
          {isP1 ? <span><R t="右" r="みぎ"/>へ<R t="進" r="すす"/>め！ 👉</span> : <span>👈 <R t="左" r="ひだり"/>へ<R t="進" r="すす"/>め！</span>}
        </div>
      </div>
    );
  };

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
      className="min-h-screen flex flex-col font-sans text-gray-800 selection:bg-yellow-300 overscroll-none"
      style={{
        backgroundColor: '#fff9c4',
        backgroundImage: 'radial-gradient(#ffe082 20%, transparent 20%), radial-gradient(#ffe082 20%, transparent 20%)',
        backgroundPosition: '0 0, 25px 25px', backgroundSize: '50px 50px',
      }}
    >
      <nav className="bg-white/90 backdrop-blur shadow-sm sticky top-0 z-40 border-b-4 border-yellow-300 px-4 py-3 flex justify-between items-center">
        <div className="font-black text-xl text-blue-600 flex items-center gap-2">
          <span>🚧 カベ<R t="合戦" r="がっせん"/>！</span>
        </div>
        <div className="flex gap-2">
          {screen === 'game' && (
            <button 
              onClick={handleUndo}
              disabled={history.length === 0 || winner}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full font-bold border-2 transition-all ${
                history.length > 0 && !winner 
                ? 'border-indigo-500 text-indigo-600 hover:bg-indigo-50 active:scale-95' 
                : 'border-gray-300 text-gray-400 opacity-50 cursor-not-allowed'
              }`}
            >
              <Undo2 size={18} /> <span className="text-sm hidden sm:inline"><span><R t="待" r="ま"/>った！</span></span>
            </button>
          )}
          <button 
            onClick={showRules}
            className="w-10 h-10 rounded-full border-2 border-blue-500 text-blue-600 flex items-center justify-center hover:bg-blue-50 active:scale-90 transition-transform font-bold"
          >？</button>
        </div>
      </nav>

      <main className="flex-grow flex flex-col pt-4 pb-32">
        {screen === 'setup' ? (
          <div className="flex-grow flex items-center justify-center p-4">
            <div className="bg-white/95 backdrop-blur-sm p-6 sm:p-8 rounded-3xl shadow-xl w-full max-w-md text-center border-4 border-white">
              <h1 className="text-3xl font-black text-blue-600 mb-2 animate-pulse"><span><R t="道" r="みち"/>を<R t="切" r="き"/>り<R t="拓" r="ひら"/>け！</span></h1>
              <p className="text-gray-500 mb-6 font-medium"><span><R t="相手" r="あいて"/>のゴールを<R t="目指" r="めざ"/>す<R t="対戦" r="たいせん"/>パズル</span></p>
              
              <div className="bg-gray-50 p-4 rounded-2xl mb-4 text-left border border-gray-100">
                <label className="block font-bold text-gray-700 mb-2"><span>ボードの<R t="大" r="おお"/>きさ</span></label>
                <select 
                  value={boardSize} 
                  onChange={e => setBoardSize(Number(e.target.value))}
                  className="w-full p-3 rounded-xl border-2 border-gray-300 bg-white font-bold text-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value={7}>7x7 (ふつう)</option>
                  <option value={9}>9x9 (むずかしい)</option>
                  <option value={5}>5x5 (かんたん)</option>
                </select>
              </div>

              <div className="bg-orange-50 p-4 rounded-2xl mb-8 text-left border border-orange-100">
                <label className="flex items-center gap-2 font-bold text-orange-800 mb-3">
                  <Settings2 size={18} /> <span>ハンデ<R t="設定" r="せってい"/>（カベの<R t="枚数" r="まいすう"/>）</span>
                </label>
                <div className="flex justify-between items-center mb-3">
                  <span className="font-bold text-blue-600"><span><R t="青" r="あお"/>チーム</span></span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSetupWalls(p => ({...p, 1: Math.max(0, p[1]-1)}))} className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold hover:bg-blue-200 active:scale-90"><Minus size={16}/></button>
                    <span className="w-6 text-center font-bold text-xl">{setupWalls[1]}</span>
                    <button onClick={() => setSetupWalls(p => ({...p, 1: Math.min(20, p[1]+1)}))} className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold hover:bg-blue-200 active:scale-90"><Plus size={16}/></button>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-red-600"><span><R t="赤" r="あか"/>チーム</span></span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSetupWalls(p => ({...p, 2: Math.max(0, p[2]-1)}))} className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold hover:bg-red-200 active:scale-90"><Minus size={16}/></button>
                    <span className="w-6 text-center font-bold text-xl">{setupWalls[2]}</span>
                    <button onClick={() => setSetupWalls(p => ({...p, 2: Math.min(20, p[2]+1)}))} className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold hover:bg-red-200 active:scale-90"><Plus size={16}/></button>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleStart}
                className="w-full py-4 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all text-white font-black text-xl shadow-lg shadow-blue-600/30 flex justify-center items-center gap-2"
              >
                <Play fill="currentColor" /> <span>ゲーム<R t="開始" r="かいし"/>！</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-center md:items-stretch justify-center gap-4 px-4 max-w-5xl mx-auto w-full">
            <div className="hidden md:flex flex-col justify-center w-56 flex-shrink-0"><PlayerPanel player={1} /></div>

            <div className="w-full max-w-[600px] flex-shrink-0 order-1 md:order-2">
              <div className="text-center mb-4 h-10">
                {!winner && (
                  <div className={`inline-block px-6 py-2 rounded-full font-bold shadow-sm border-2 transition-colors ${turn === 1 ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
                    {turn === 1 ? <span><R t="青" r="あお"/>チームの<R t="番" r="ばん"/>です</span> : <span><R t="赤" r="あか"/>チームの<R t="番" r="ばん"/>です</span>}
                  </div>
                )}
              </div>

              <div className="bg-white/80 p-3 md:p-4 rounded-3xl shadow-xl border-4 border-white backdrop-blur-sm relative">
                
                <div className="relative w-full aspect-square touch-manipulation" onMouseLeave={() => setHoverCell(null)}>
                  
                  <div className="absolute inset-0" style={{ display: 'grid', gridTemplateColumns: `repeat(${boardSize}, 1fr)`, gridTemplateRows: `repeat(${boardSize}, 1fr)`, gap: `${GAP}px` }}>
                    {Array.from({ length: boardSize * boardSize }).map((_, i) => {
                      const r = Math.floor(i / boardSize);
                      const c = i % boardSize;
                      const isHighlighted = mode === 'move' && !winner && isValidMove(players[turn], r, c, turn, players, walls);
                      return (
                        <div key={i} className="rounded-lg bg-[#f1f3f4] hover:bg-[#e3f2fd] transition-colors cursor-pointer flex items-center justify-center relative"
                          onMouseEnter={() => setHoverCell({r, c})}
                          onClick={() => handleCellClick(r, c)}
                        >
                          {isHighlighted && <div className="w-1/3 h-1/3 rounded-full bg-green-500/50 pointer-events-none animate-pulse" />}
                        </div>
                      );
                    })}
                  </div>

                  <div 
                    className="absolute z-10 flex items-center justify-center text-xl sm:text-3xl filter drop-shadow-md"
                    style={{ ...getPositionStyle(players[1].row, players[1].col), transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="w-[80%] h-[80%] rounded-full bg-gradient-to-br from-blue-300 to-blue-600 border-[3px] border-white shadow-lg flex items-center justify-center">🔵</div>
                  </div>
                  <div 
                    className="absolute z-10 flex items-center justify-center text-xl sm:text-3xl filter drop-shadow-md"
                    style={{ ...getPositionStyle(players[2].row, players[2].col), transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  >
                    <div className="w-[80%] h-[80%] rounded-full bg-gradient-to-br from-red-300 to-red-600 border-[3px] border-white shadow-lg flex items-center justify-center">🔴</div>
                  </div>

                  {walls.map((w, i) => {
                    const style = getPositionStyle(w.row, w.col);
                    const wallStyle = { backgroundColor: '#8d6e63', backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.1), rgba(255,255,255,0.1) 5px, transparent 5px, transparent 10px)' };
                    return w.orientation === 'h' 
                      ? <div key={`w-${i}`} className="absolute z-20 shadow-md border border-white/20 rounded-sm" style={{ ...wallStyle, left: style.left, top: `calc(${style.top} + ${style.height} + ${GAP/2}px - 4px)`, width: `calc(${style.width} * 2 + ${GAP}px)`, height: '8px' }} />
                      : <div key={`w-${i}`} className="absolute z-20 shadow-md border border-white/20 rounded-sm" style={{ ...wallStyle, left: `calc(${style.left} + ${style.width} + ${GAP/2}px - 4px)`, top: style.top, height: `calc(${style.height} * 2 + ${GAP}px)`, width: '8px' }} />;
                  })}

                  {mode === 'wall' && hoverCell && !winner && (() => {
                    const previewError = validateWall(hoverCell.r, hoverCell.c, wallOrientation, walls, boardSize, players);
                    const style = getPositionStyle(hoverCell.r, hoverCell.c);
                    const color = previewError ? '#ef4444' : '#fbbf24';
                    return wallOrientation === 'h'
                      ? <div className="absolute z-30 border-2 border-dashed pointer-events-none opacity-90 rounded-sm" style={{ left: style.left, top: `calc(${style.top} + ${style.height} + ${GAP/2}px - 4px)`, width: `calc(${style.width} * 2 + ${GAP}px)`, height: '8px', backgroundColor: color, borderColor: previewError ? 'white' : '#78350f' }} />
                      : <div className="absolute z-30 border-2 border-dashed pointer-events-none opacity-90 rounded-sm" style={{ left: `calc(${style.left} + ${style.width} + ${GAP/2}px - 4px)`, top: style.top, height: `calc(${style.height} * 2 + ${GAP}px)`, width: '8px', backgroundColor: color, borderColor: previewError ? 'white' : '#78350f' }} />;
                  })()}

                </div>
              </div>
            </div>

            <div className="flex md:hidden w-full max-w-[600px] gap-2 order-2 mt-2">
              <div className="flex-1"><PlayerPanel player={1} /></div>
              <div className="flex-1"><PlayerPanel player={2} /></div>
            </div>
            <div className="hidden md:flex flex-col justify-center w-56 flex-shrink-0 order-3"><PlayerPanel player={2} /></div>
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="text-center text-gray-500 py-3 mt-auto border-t border-yellow-300/50 bg-white/40 backdrop-blur-sm">
        <small>© 2026 カベカベ合戦！ <a href="https://note.com/cute_borage86" target="_blank" rel="noopener noreferrer" className="no-underline text-gray-500 hover:text-gray-700 transition-colors">GIGA山</a></small>
      </footer>

      {screen === 'game' && !winner && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-200 p-3 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-40 pb-safe">
          <div className="max-w-3xl mx-auto flex gap-3 h-16">
            <button className={`flex-1 rounded-2xl font-bold flex flex-col items-center justify-center transition-all duration-200 ${mode === 'move' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} onClick={() => setMode('move')}>
              <span className="text-2xl leading-none mb-1">🏃</span><span className="text-[10px] tracking-wider"><span><R t="歩" r="ある"/>く</span></span>
            </button>
            <button className={`flex-1 rounded-2xl font-bold flex flex-col items-center justify-center transition-all duration-200 ${mode === 'wall' ? 'bg-amber-400 text-amber-900 shadow-lg shadow-amber-400/40 scale-105' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`} onClick={() => setMode('wall')}>
              <span className="text-2xl leading-none mb-1">🚧</span><span className="text-[10px] tracking-wider">カベ</span>
            </button>
            <div className="flex-[1.2] flex items-center justify-center">
              {mode === 'move' ? (
                <div className="w-full h-full bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center text-sm font-bold text-gray-400 text-center leading-tight">
                  <span><R t="光" r="ひか"/>るマスを<br/>タップ！</span>
                </div>
              ) : (
                <button onClick={() => setWallOrientation(o => o === 'v' ? 'h' : 'v')} className="w-full h-full bg-yellow-50 hover:bg-yellow-100 border-2 border-amber-300 rounded-2xl font-bold text-amber-900 flex flex-col items-center justify-center transition-all active:scale-95">
                  <span className="text-sm"><span><R t="今" r="いま"/>は <b className="text-base">{wallOrientation === 'v' ? 'タテ' : 'ヨコ'}</b></span></span>
                  <span className="text-[10px] text-amber-600 opacity-80 mt-0.5"><span><R t="押" r="お"/>すと{wallOrientation === 'v' ? 'ヨコ' : 'タテ'}</span></span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl scale-100 transition-transform">
            <div className={`flex justify-center mb-4 ${modal.type === 'success' ? 'text-green-500' : modal.type === 'error' ? 'text-red-500' : modal.type === 'warning' ? 'text-amber-500' : 'text-blue-500'}`}>
              {modal.type === 'success' ? <CheckCircle size={56} strokeWidth={2.5} /> : modal.type === 'error' ? <XCircle size={56} strokeWidth={2.5} /> : modal.type === 'warning' ? <AlertTriangle size={56} strokeWidth={2.5} /> : <Info size={56} strokeWidth={2.5} />}
            </div>
            <h3 className="text-2xl font-black text-center mb-3 text-gray-800"><span>{modal.title}</span></h3>
            <div className="text-center text-gray-600 mb-6 font-medium leading-relaxed">{modal.content}</div>
            {modal.onConfirm && (
              <button onClick={() => { modal.onConfirm(); setModal(m => ({ ...m, show: false })); }} className={`w-full py-3.5 rounded-full font-bold text-lg text-white shadow-md active:scale-95 transition-all ${modal.type === 'success' ? 'bg-green-500 hover:bg-green-600' : modal.type === 'error' ? 'bg-red-500 hover:bg-red-600' : modal.type === 'warning' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-500 hover:bg-blue-600'}`}>
                {modal.confirmText}
              </button>
            )}
            {!modal.onConfirm && !modal.timer && <button onClick={() => setModal(m => ({ ...m, show: false }))} className="w-full py-2 rounded-full font-bold text-gray-500 bg-gray-100 hover:bg-gray-200"><span><R t="閉" r="と"/>じる</span></button>}
          </div>
        </div>
      )}
      <style dangerouslySetInnerHTML={{__html: `.pb-safe { padding-bottom: env(safe-area-inset-bottom, 12px); }`}} />
    </div>
  );
}
