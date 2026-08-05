import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App.jsx';
import './styles.css';
import { registerServiceWorker } from './pwa.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 開発中はViteのモジュールをキャッシュすると更新が反映されなくなるため、本番のみ登録する。
//
// 登録は React の中に置かない。effect は描画のあとに走るため、
// そのとき load はもう終わっており、'load' のリスナーが二度と呼ばれなくなる。
// （登録されたかどうかは navigator.serviceWorker.getRegistration() でしか確かめられない）
if (import.meta.env.PROD) {
  registerServiceWorker();
}
