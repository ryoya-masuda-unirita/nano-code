// `fs/promises` は `fs` のPromiseベース版。`await fs.writeFile(...)` のように使える。
// 通常の `fs` はコールバック形式や同期(Sync)版が中心なのに対し、
// こちらは最初からasync/awaitで書くために用意されたモジュール。
import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

// 引数の型をその場でオブジェクト型として定義している（インライン型注釈）。
// `path: string; content: string;` は「path属性文字列、content属性文字列を持つオブジェクト」。
// Pythonの `def write_file_execute(args: dict[str, str]) -> str:` よりも
// 「どんなキーを持つか」まで厳密に表現できるのがTypeScriptの強み。
async function writeFileExecute(args: {
    path: string;
    content: string;
}): Promise<string> {
    const absolutePath = path.resolve(WORKSPACE_ROOT, args.path);

    // ワークスペース外への書き込みを防ぐガード（パストラバーサル対策）。
    const allowedPrefix = WORKSPACE_ROOT + path.sep;
    if (!absolutePath.startsWith(allowedPrefix) && absolutePath !== WORKSPACE_ROOT) {
        throw new Error(`アクセス拒否: ${args.path} はワークスペース外です`);
    }

    const dir = path.dirname(absolutePath);
    // `{ recursive: true }` はPythonの `os.makedirs(dir, exist_ok=True)` に相当。
    // 親ディレクトリがなければ全部まとめて作る。
    await fs.mkdir(dir, { recursive: true });

    try {
        // `fs.access` はファイルの存在確認・アクセス権チェック用。
        // 存在しなければ例外を投げるので、それをtry/catchで「存在するかどうか」の判定に使っている。
        await fs.access(absolutePath);
        const backupPath = `${absolutePath}.backup`;
        await fs.copyFile(absolutePath, backupPath);
    } catch {
        // ファイルが存在しない場合はバックアップ不要
    }

    await fs.writeFile(absolutePath, args.content, 'utf-8');

    return `ファイルを書き込みました: ${args.path}`;
}

// ここでは明示的に `: Tool` という型注釈を付けていないが、
// `execute: writeFileExecute` の型（引数がpath/contentを持つオブジェクト）が
// Tool型が期待する `(args: Record<string, unknown>) => Promise<string>` と
// 構造的に互換なので、他のファイルでTool型として使う際にも問題なく扱える。
export const writeFile = {
    name: 'writeFile',
    description:
        '指定されたパスにファイルを作成または上書きする。既存ファイルは自動的にバックアップされる。ディレクトリが存在しない場合は自動的に作成される。',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: '書き込むファイルのパス',
            },
            content: {
                type: 'string',
                description: 'ファイルに書き込む内容',
            },
        },
        required: ['path', 'content'],
    },
    execute: writeFileExecute,
};
