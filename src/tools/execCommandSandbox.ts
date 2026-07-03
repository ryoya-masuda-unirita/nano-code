// src/tools/execCommandSandbox.ts
import { spawn } from 'child_process';
import * as path from 'path';
import type { Tool } from '../types';
import { Sandbox } from '../core/sandbox';
import { config } from '../config';
import { parseCommand } from './execCommand';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');
const ALLOWED_COMMANDS = ['bun', 'ls', 'git', 'gh'];
const MAX_OUTPUT_LENGTH = 2000;

// 環境変数はホワイトリスト方式（機密情報の漏洩防止）
const SAFE_ENV = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
};
// 3つのプロパティすべてに `?:` ではなく `?:` かつ型が `unknown` なので、
// 「存在するかもしれないし、あっても中身の型は分からない」という緩い入力を表す型。
// LLMから渡ってくるJSON入力は信頼できないので、あえてunknownにして
// 下の関数内で1つずつ型チェック（バリデーション）してから使っている。
type ExecCommandInput = {
    command?: unknown;
    commandName?: unknown;
    commandArgs?: unknown;
};

async function execCommandSandboxExecute(
    args: Record<string, unknown>
): Promise<string> {
    // `args as ExecCommandInput` は型アサーション。
    // 「argsの中身はExecCommandInputの形をしているはず」とTypeScriptに教えている
    // （実行時に検証してくれるわけではない点に注意）。
    const input = args as ExecCommandInput;
    let commandName = '';
    let commandArgs: string[] = [];
    let commandForCheck = '';

    // `typeof input.command === 'string'` は型ガード。
    // このifブロックの中では `input.command` が自動的にstring型として扱われる。
    // Pythonで `isinstance(command, str)` してから使うのと同じ発想。
    if (typeof input.command === 'string') {
        const command = input.command;
        const dangerousChars = /[;&`$]/;
        if (dangerousChars.test(command)) {
            throw new Error('シェルメタ文字を含むコマンドは実行できません');
        }
        const parts = parseCommand(command);
        commandName = parts[0] || '';
        commandArgs = parts.slice(1);
        commandForCheck = command;
    } else if (typeof input.commandName === 'string') {
        commandName = input.commandName;
        if (Array.isArray(input.commandArgs)) {
            // `.every(...)` は「配列の全要素が条件を満たすか」を調べる（Pythonの `all(...)` に相当）。
            if (!input.commandArgs.every((arg) => typeof arg === 'string')) {
                throw new Error('commandArgs は文字列配列で指定してください');
            }
            commandArgs = input.commandArgs as string[];
        }
        commandForCheck = [commandName, ...commandArgs].join(' ');
    } else {
        throw new Error('command または commandName を指定してください');
    }

    if (!commandName) {
        throw new Error('コマンドが空です');
    }

    if (!ALLOWED_COMMANDS.includes(commandName)) {
        throw new Error(`コマンド ${commandName} は許可されていません`);
    }

    const dangerousPatterns = [/rm\s+-rf/, />\s*\/dev/, /curl.*\|.*sh/, /wget.*\|.*sh/];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(commandForCheck)) {
            throw new Error('危険なコマンドパターンが検出されました');
        }
    }

    for (const arg of commandArgs) {
        if (arg.startsWith('/') || arg.startsWith('.') || arg.includes('/') || arg.includes('\\')) {
            const resolvedPath = path.resolve(WORKSPACE_ROOT, arg);
            const allowedPrefix = WORKSPACE_ROOT + path.sep;
            if (!resolvedPath.startsWith(allowedPrefix) && resolvedPath !== WORKSPACE_ROOT) {
                throw new Error(`アクセス拒否: ${arg} はワークスペース外です`);
            }
        }
    }

    // サンドボックス分岐
    // `process.platform` はNode標準のOS判定用プロパティ（Pythonの `sys.platform` に相当）。
    if (process.platform === 'linux' && config.sandbox) {
        const sandbox = new Sandbox();
        const result = await sandbox.run(commandName, commandArgs, {
            allowNetwork: false,
            env: SAFE_ENV,
        });

        if (result.exitCode !== 0) {
            throw new Error(`Command failed: ${result.stderr}`);
        }
        return result.stdout;
    }

    // 通常実行（第4章と同じ）
    // `new Promise((resolve, reject) => {...})` はコールバックベースのAPI（spawnのイベント）を
    // async/awaitで扱える形に変換する定番パターン。resolveは成功時、rejectは失敗時に呼ぶ。
    return new Promise((resolve, reject) => {
        const child = spawn(commandName, commandArgs, {
            cwd: WORKSPACE_ROOT,
            timeout: 30000,
            shell: false,
        });

        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;

        // イベントハンドラの引数に `(data: Buffer)` と型を明示している。
        // `Buffer` はNode.js標準のバイナリデータ型（Pythonの `bytes` に相当）。
        child.stdout.on('data', (data: Buffer) => {
            if (stdout.length < MAX_OUTPUT_LENGTH) {
                stdout += data.toString();
                if (stdout.length >= MAX_OUTPUT_LENGTH) {
                    stdoutTruncated = true;
                }
            }
        });

        child.stderr.on('data', (data: Buffer) => {
            if (stderr.length < MAX_OUTPUT_LENGTH) {
                stderr += data.toString();
                if (stderr.length >= MAX_OUTPUT_LENGTH) {
                    stderrTruncated = true;
                }
            }
        });

        // `code: number | null` は「終了コードは数値だが、異常時にnullの場合もある」という型。
        child.on('close', (code: number | null) => {
            if (stdoutTruncated) {
                stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... (出力が長いため省略されました)';
            }
            if (stderrTruncated) {
                stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n... (出力が長いため省略されました)';
            }

            if (code === 0) {
                resolve(stdout + (stderr ? `\n(stderr: ${stderr.trim()})` : ''));
            } else {
                reject(new Error(`コマンドが異常終了しました (exit code: ${code})\n${stderr}`));
            }
        });

        child.on('error', (error: Error) => {
            reject(new Error(`コマンド実行エラー: ${error.message}`));
        });
    });
}

export const execCommandSandbox: Tool = {
    name: 'execCommand',
    description: 'ワークスペース内で許可されたコマンドを実行',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: '実行するコマンド' },
        },
        required: ['command'],
    },
    execute: execCommandSandboxExecute,
};
