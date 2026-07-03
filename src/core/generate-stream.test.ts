import { describe, expect, it } from 'bun:test';
import { collectStreamResult, generateStreamText } from './generate-stream';
import type { LanguageModel, StreamChunk, ToolCall } from '../types';

describe('generateStreamText', () => {
    it('throws when model does not support streaming', async () => {
        // doStreamを持たないモックを使い、「doStream未実装ならエラーになる」ことを確認するテスト。
        const model: LanguageModel = {
            async doGenerate() {
                return { text: 'ok', finishReason: 'stop' };
            },
        };

        const iter = generateStreamText({
            model,
            messages: [{ role: 'user', content: 'hello' }],
        });

        // `expect(async () => {...}).toThrow(...)` は「非同期関数を実行した結果、
        // 例外がスローされること」を検証するアサーション。
        await expect(async () => {
            // `for await (const _ of iter)` の `_` は「使わない変数」を示す慣習的な名前。
            for await (const _ of iter) {
                // no-op
            }
        }).toThrow('Model does not support streaming');
    });
});

describe('collectStreamResult', () => {
    it('accumulates deltas and returns done payload', async () => {
        const toolCalls: ToolCall[] = [
            {
                toolCallId: 'call_0',
                name: 'readFile',
                args: { path: 'hello.txt' },
            },
        ];

        // テストで使う一連のストリームチャンクを配列としてあらかじめ用意している。
        const chunks: StreamChunk[] = [
            { kind: 'event' },
            { kind: 'delta', text: 'Hel' },
            { kind: 'delta', text: 'lo' },
            {
                kind: 'done',
                finishReason: 'tool_calls',
                usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
                toolCalls,
            },
        ];

        // doStreamを非同期ジェネレータとして実装したモック。
        // 呼び出されると `chunks` の中身を1つずつyieldする「偽のストリーミングモデル」。
        const model: LanguageModel = {
            async doGenerate() {
                return { text: 'ok', finishReason: 'stop' };
            },
            async *doStream() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            },
        };

        const seenKinds: string[] = [];
        const result = await collectStreamResult({
            model,
            messages: [{ role: 'user', content: 'hello' }],
            // アロー関数をそのままコールバックとして渡している。
            // Pythonの `lambda chunk: seen_kinds.append(chunk["kind"])` に相当。
            onChunk: (chunk) => seenKinds.push(chunk.kind),
        });

        expect(seenKinds).toEqual(['event', 'delta', 'delta', 'done']);
        expect(result).toEqual({
            text: 'Hello',
            finishReason: 'tool_calls',
            usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
            toolCalls,
        });
    });
});
