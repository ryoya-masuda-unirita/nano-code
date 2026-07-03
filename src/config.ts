// src/config.ts
// `export` を付けると他のファイルから `import { config } from './config'` で使えるようになる。
// Pythonで言う「モジュールのトップレベル変数をそのまま公開する」のと同じ感覚。
// `let` は再代入可能な変数（Pythonの通常の変数に相当）。再代入しないなら `const` を使うのが基本。
export let config = {
    // Layer 2: プロセス隔離（bubblewrap）
    sandbox: false,
    // Layer 3: アプリケーション層の設定
    allowedDomains: ['api.github.com', 'github.com'],
};
