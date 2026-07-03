// src/core/sandbox.ts
// `spawn` はNode標準の子プロセス起動関数。Pythonの `subprocess.Popen` に相当する。
import { spawn } from 'child_process';

// interfaceでオプションの形を定義。行末の `//` コメントはPythonの `# ` コメントと同じ扱い。
export interface SandboxOptions {
  cwd?: string;                 // 作業ディレクトリ
  allowNetwork?: boolean;       // ネットワークアクセスの許可
  env?: Record<string, string>; // 環境変数
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// TypeScriptでもPythonと同じように `class` でクラスを定義できる。
// メソッド名の前に `async` を付けるのはメソッド定義でも通常の関数と同じ。
export class Sandbox {
  async run(
    command: string,
    args: string[],
    // `options: SandboxOptions = {}` はデフォルト引数（Pythonの `options: SandboxOptions = {}`）。
    options: SandboxOptions = {}
  ): Promise<SandboxResult> {
    const cwd = options.cwd || process.cwd();

    // bwrapの引数を構築
    // `string[]` は「string型の配列」を表す型注釈（Pythonの `list[str]` に相当）。
    const bwrapArgs: string[] = [
      // 1. ファイルシステムの隔離
      // ルートを読み取り専用でバインド（システム破壊の防止）
      '--ro-bind', '/', '/',

      // デバイスファイルと一時ディレクトリを新規作成
      '--dev', '/dev',
      '--tmpfs', '/tmp',

      // 作業ディレクトリのみ書き込み許可でバインド
      '--bind', cwd, cwd,
      '--chdir', cwd,

      // 親プロセス(Node)が終了したらサンドボックスも終了（ゾンビ防止）
      '--die-with-parent',

      // 環境変数をクリア
      '--clearenv',
    ];

    // 環境変数の再設定（PATHなどを引き継ぐ）
    // `...options.env` はスプレッド構文。オブジェクトの中身を展開して合成する。
    // Pythonの `{**base, **options.get("env", {})}` に相当する書き方。
    // 後ろに書いたキーが同名の前のキーを上書きする点も辞書のマージと同じ。
    const envVars = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      ...options.env,
    };
    for (const [key, value] of Object.entries(envVars)) {
      if (value !== undefined) {
        bwrapArgs.push('--setenv', key, value);
      }
    }

    // 2. ネットワーク制御
    if (!options.allowNetwork) {
      bwrapArgs.push('--unshare-net'); // ネットワーク名前空間を分離（通信遮断）
    }

    // 実行するコマンド
    // `...args` は配列の展開。`push('--', command, ...args)` は
    // Pythonの `bwrap_args.extend(['--', command, *args])` に相当。
    bwrapArgs.push('--', command, ...args);

    // プロセス生成と結果取得
    // コールバック形式のイベントAPI（`spawn`）をPromiseに包んでawait可能にしている。
    return new Promise((resolve) => {
      const child = spawn('bwrap', bwrapArgs, {
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      // `.on('data', ...)` はNode.jsのイベントリスナー登録（Pythonにはない仕組みで、
      // データが届くたびに指定したコールバック関数が呼ばれる）。
      // `d.toString()` はバイト列(Buffer)を文字列に変換している。
      child.stdout.on('data', d => stdout += d.toString());
      child.stderr.on('data', d => stderr += d.toString());

      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          // `code` はnullの可能性があるので `??` でその場合は-1にフォールバックしている。
          exitCode: code ?? -1
        });
      });

      // bwrap自体の起動失敗をハンドリング
      child.on('error', (err) => {
        resolve({
          stdout: '',
          stderr: `Sandbox Error: ${err.message}\n` +
            '(Hint: docker run の --cap-add=SYS_ADMIN オプションを確認してください)',
          exitCode: 126
        });
      });
    });
  }
}
