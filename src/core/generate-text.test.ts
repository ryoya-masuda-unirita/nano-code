// `bun:test` はBunランタイム標準のテストフレームワーク。
// Pythonの `pytest` の `describe/it/expect` がまとまったもの、とイメージすると分かりやすい。
// describe = テストのグループ化、it = 1つのテストケース、expect = アサーション。
import { describe, expect, it } from 'bun:test';
import { generateText } from './generate-text';
import type { GenerateParams, LanguageModel, Message } from '../types';
import { LLMApiError } from '../types';

describe('generateText', () => {
	    it('passes GenerateParams through to model.doGenerate', async () => {
	        // `GenerateParams | null` は「GenerateParams型 または null」のユニオン型。
	        // 最初はnullで、後で実際の値が入る変数の型を先に宣言している。
	        let received: GenerateParams | null = null;
	        // `LanguageModel` インタフェースを満たす「テスト用の偽実装（モック）」をその場で作成。
	        // Pythonで `unittest.mock.Mock(spec=LanguageModel)` を使う代わりに、
	        // TypeScriptでは実際にインタフェースの形をしたオブジェクトを直接書くことが多い。
	        const model: LanguageModel = {
	            async doGenerate(params) {
	                received = params;
	                return { text: 'ok', finishReason: 'stop' };
	            },
	        };

        const messages: Message[] = [{ role: 'user', content: 'hello' }];
        const result = await generateText({
            model,
            messages,
            temperature: 0.25,
            maxTokens: 123,
            maxRetries: 0,
	        });

	        expect(result.text).toBe('ok');
	        expect(received).not.toBeNull();
	        // `received!` の `!` は非nullアサーション演算子。
	        // 「ここでは絶対にnullではない」とTypeScriptに伝え、型チェックのエラーを抑える記法。
	        // 直前で `not.toBeNull()` を確認しているので安全だが、実行時のチェックにはならない点に注意。
	        expect(received!).toEqual({
	            messages,
	            temperature: 0.25,
	            maxTokens: 123,
	            tools: undefined,
	            signal: undefined,
	        });
	    });

    it('retries transient LLMApiError failures', async () => {
        let calls = 0;
        const model: LanguageModel = {
            async doGenerate() {
                calls += 1;
                if (calls < 3) {
                    // 最初の2回はリトライ可能なエラー（429=レート制限）を投げて、
                    // retryWithExponentialBackoffが再試行することを検証している。
                    throw new LLMApiError(
                        429,
                        'test-provider',
                        'rate_limit',
                        'rate limited',
                        undefined,
                        { 'retry-after-ms': '0' }
                    );
                }
                return { text: 'ok', finishReason: 'stop' };
            },
        };

        const messages: Message[] = [{ role: 'user', content: 'hello' }];
        const result = await generateText({ model, messages, maxRetries: 2 });

        expect(result.text).toBe('ok');
        expect(calls).toBe(3);
    });
});
