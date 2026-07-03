import type { GenerateParams, GenerateTextResult, LanguageModel } from '../types';
import { retryWithExponentialBackoff } from '../utils/retry';

// `&` は交差型（インターセクション型）。「AかつB」で、両方のプロパティを併せ持つ型になる。
// Pythonには直接の対応物はないが、2つのTypedDictをマージした新しい型を作るイメージ。
export type GenerateTextParams = GenerateParams & {
    model: LanguageModel;
    maxRetries?: number;
};

// `export async function` はPythonの `async def` に相当。
// 呼び出し側は `await generateText(...)` または `.then()` で結果を受け取る。
export async function generateText(
    params: GenerateTextParams
): Promise<GenerateTextResult> {
    // `() => params.model.doGenerate({...})` は引数なしのアロー関数（無名関数）。
    // ここでは「実行する処理そのもの」を関数として retryWithExponentialBackoff に渡している。
    // Pythonで `functools.partial` やラムダを高階関数に渡すのと同じ発想。
    return retryWithExponentialBackoff(
        () =>
            params.model.doGenerate({
                messages: params.messages,
                temperature: params.temperature,
                maxTokens: params.maxTokens,
                tools: params.tools,
                signal: params.signal,
            }),
        // `??` はNull合体演算子。maxRetriesが未指定(undefined)なら2を使う。
        params.maxRetries ?? 2
    );
}
