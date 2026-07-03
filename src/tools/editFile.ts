import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

// 引数の形をインラインのオブジェクト型で指定。3つの必須プロパティを持つことを表す。
async function editFileExecute(args: {
    path: string;
    oldText: string;
    newText: string;
}): Promise<string> {
    const absolutePath = path.resolve(WORKSPACE_ROOT, args.path);

    const allowedPrefix = WORKSPACE_ROOT + path.sep;
    if (!absolutePath.startsWith(allowedPrefix) && absolutePath !== WORKSPACE_ROOT) {
        throw new Error(`アクセス拒否: ${args.path} はワークスペース外です`);
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    // `content.split(args.oldText).length - 1` は「oldTextの出現回数」を数える定番テクニック。
    // n個の区切り文字で分割するとn+1個の要素になるので、-1すれば出現回数になる。
    const matches = content.split(args.oldText).length - 1;

    if (matches === 0) {
        // `.slice(0, 50)` は先頭50文字を取り出す（Pythonの `s[:50]` に相当）。
        throw new Error(`変更対象が見つかりません: ${args.oldText.slice(0, 50)}...`);
    }
    if (matches > 1) {
        throw new Error(`複数の候補が見つかりました（${matches}箇所）。より具体的な範囲を指定してください`);
    }

    const backupPath = `${absolutePath}.backup`;
    await fs.copyFile(absolutePath, backupPath);

    // `.replace(old, new)` は最初の1件だけを置換する（Pythonの `str.replace(old, new, 1)` に相当）。
    // ここではmatchesが1件であることを事前に確認しているので、全文置換と同じ結果になる。
    const newContent = content.replace(args.oldText, args.newText);
    await fs.writeFile(absolutePath, newContent, 'utf-8');

    return `ファイルを編集しました: ${args.oldText.slice(0, 30)}... → ${args.newText.slice(0, 30)}...`;
}

export const editFile = {
    name: 'editFile',
    description:
        'ファイルの一部を編集する。oldTextで指定した箇所をnewTextに置き換える。oldTextが複数見つかる場合はエラーを返すため、一意に特定できる範囲を指定すること。ファイル全体を読み書きするよりトークン消費が少ない。',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: '編集するファイルのパス' },
            oldText: {
                type: 'string',
                description: '変更前のテキスト（一意に特定できる範囲を指定）',
            },
            newText: { type: 'string', description: '変更後のテキスト' },
        },
        required: ['path', 'oldText', 'newText'],
    },
    execute: editFileExecute,
};
