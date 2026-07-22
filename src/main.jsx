import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 開発中はViteのモジュールをキャッシュすると更新が反映されなくなるため、本番のみ登録する
// 相対パスで登録し、サブパス配信（GitHub Pages等）でも正しいスコープになるようにする
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', window.location.href)).catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}
