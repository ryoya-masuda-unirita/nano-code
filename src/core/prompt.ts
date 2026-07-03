// `import * as fs from 'fs'` はモジュール全体を `fs` という名前でまとめてimportする書き方。
// Pythonの `import os` のように、`fs.readFileSync(...)` の形で使う。
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM（ES Modules）環境には Python の `__file__` に相当する変数が標準では無いため、
// `import.meta.url` から自前で `__filename` / `__dirname` を作っている。
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ベースプロンプト（prompt.md）とプロジェクト固有の指示（AGENTS.md）を読み込む。
 *
 * - prompt.md は必須。存在しない場合はエラーを投げる。
 * - workspaceRoot 配下に AGENTS.md があれば連結して返す。
 */
// 引数 `workspaceRoot: string`、戻り値 `string` という型注釈。
// Pythonの `def load_instructions(workspace_root: str) -> str:` に相当。
export function loadInstructions(workspaceRoot: string): string {
  const basePath = path.resolve(path.join(__dirname, 'prompt.md'));
  // `fs.readFileSync` は同期的（ブロッキング）にファイルを読む関数。
  // Pythonの `open(path).read()` に近い。末尾の `Sync` は「非同期版もある」ことの目印。
  const base = fs.readFileSync(basePath, 'utf-8');

  const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const agents = fs.readFileSync(agentsPath, 'utf-8');
    // バッククォート `` ` `` で囲むのはテンプレートリテラル。`${式}` で値を埋め込める。
    // Pythonのf-string `f"{base}\n\n..."` に相当する。
    return `${base}\n\n# プロジェクト固有の指示\n\n${agents}`;
  }

  return base;
}
