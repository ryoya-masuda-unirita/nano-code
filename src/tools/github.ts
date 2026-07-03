import { execCommand } from './execCommand';
// `{ writeFileSync, ... }` のように波括弧で複数の関数を同時にimportできる（名前付きimport）。
// Pythonの `from fs import write_file_sync, unlink_sync, mkdir_sync, exists_sync` に相当。
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const WORKSPACE_ROOT = join(process.cwd(), 'workspace');

// 戻り値が `void` の関数は「何も返さない」ことを表す（Pythonの `-> None` に相当）。
// 検証(validate)系の関数は「問題があれば例外を投げる、問題なければ何も返さず終わる」設計。
function validateBranchName(name: string): void {
    if (!name || name.length > 120) {
        throw new Error('ブランチ名が不正です');
    }
    if (name.startsWith('-') || name.startsWith(':')) {
        throw new Error('ブランチ名の先頭に - や : は使えません');
    }
    if (/\s/.test(name)) {
        throw new Error('ブランチ名に空白は使えません');
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
        throw new Error('ブランチ名に使用できない文字が含まれています');
    }
}

function validateTitle(title: string): void {
    if (!title || title.length > 200) {
        throw new Error('PRタイトルが不正です');
    }
    if (/[\r\n\0]/.test(title)) {
        throw new Error('PRタイトルに改行や制御文字は使えません');
    }
}

function writeTempFile(content: string, prefix: string): string {
    if (!existsSync(WORKSPACE_ROOT)) {
        mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }
    const tempPath = join(WORKSPACE_ROOT, `.${prefix}-${Date.now()}.txt`);
    writeFileSync(tempPath, content, 'utf-8');
    return tempPath;
}

export const createPullRequest = {
    name: 'createPullRequest',
    description: 'GitHub CLI を使って PR を作成する。既存のPRがある場合は更新する。',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'PRのタイトル'
            },
            body: {
                type: 'string',
                description: 'PRの本文'
            },
            head: {
                type: 'string',
                description: "マージ元のブランチ名（例: 'fix/error-handling'）"
            },
            base: {
                type: 'string',
                description: "マージ先のブランチ名（通常は 'main'）"
            }
        },
        required: ['title', 'body', 'head', 'base']
    },
    // オブジェクトのプロパティにアロー関数を直接代入するスタイル。
    // `execute: async (args: {...}) => { ... }` は
    // `async function execute(args: {...}) { ... }` を1つの式として書いたものと同じ。
    execute: async (args: {
        title: string;
        body: string;
        head: string;
        base: string;
    }) => {
        validateTitle(args.title);
        validateBranchName(args.head);
        validateBranchName(args.base);

        const listResult = await execCommand.execute({
            commandName: 'gh',
            commandArgs: ['pr', 'list', '--head', args.head, '--base', args.base, '--state', 'open', '--json', 'number']
        });

        const bodyFile = writeTempFile(args.body, 'pr-body');

        try {
            // `JSON.parse` はPythonの `json.loads` に相当。'[]' をデフォルトにして空配列扱いにしている。
            const existingPRs = JSON.parse(listResult || '[]');
            // `Array.isArray(x)` は「xが配列かどうか」を調べる（Pythonの `isinstance(x, list)` に相当）。
            if (Array.isArray(existingPRs) && existingPRs.length > 0) {
                const prNumber = String(existingPRs[0].number);
                await execCommand.execute({
                    commandName: 'gh',
                    commandArgs: ['pr', 'edit', prNumber, '--body-file', bodyFile]
                });
                return `既存のPR #${prNumber} を更新しました`;
            }
        } catch {
            // JSON パース失敗時は新規作成を試みる
        }

        try {
            const result = await execCommand.execute({
                commandName: 'gh',
                commandArgs: ['pr', 'create', '--title', args.title, '--body-file', bodyFile, '--base', args.base, '--head', args.head]
            });
            return `PRを作成しました: ${result}`;
        } finally {
            // 一時ファイルの削除に失敗しても処理全体は止めたくないので、内側にもtry/catchを入れている。
            try { unlinkSync(bodyFile); } catch { /* ignore */ }
        }
    }
};

export const createIssueComment = {
    name: 'createIssueComment',
    description: 'GitHub CLI を使って指定されたIssueにコメントを投稿する',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            issueNumber: {
                type: 'number',
                description: 'コメントするIssueの番号'
            },
            body: {
                type: 'string',
                description: 'コメントの本文'
            }
        },
        required: ['issueNumber', 'body']
    },
    execute: async (args: {
        issueNumber: number;
        body: string;
    }) => {
        // `Number.isInteger(x)` は「xが整数かどうか」の判定（Pythonの `isinstance(x, int)` に相当）。
        if (!Number.isInteger(args.issueNumber) || args.issueNumber <= 0) {
            throw new Error('issueNumber は正の整数で指定してください');
        }

        const bodyFile = writeTempFile(args.body, 'comment-body');
        try {
            await execCommand.execute({
                commandName: 'gh',
                commandArgs: ['issue', 'comment', String(args.issueNumber), '--body-file', bodyFile]
            });
            return 'コメントを投稿しました';
        } finally {
            try { unlinkSync(bodyFile); } catch { /* ignore */ }
        }
    }
};
