import { LLMApiError } from '../types';

const MAX_BACKOFF_MS = 60000;

// LLM APIの一時的なエラーに対する指数バックオフ再試行ヘルパー
// `<T>` は関数のジェネリクス（型引数）。Pythonの `TypeVar` に近い仕組みで、
// 「fnが返すPromiseの中身の型が何であれ、そのまま同じ型で返す」ことを表現している。
// 例えば `fn: () => Promise<string>` を渡せば戻り値は `Promise<string>` になる。
export async function retryWithExponentialBackoff<T>(
  // 引数なしでPromise<T>を返す関数、という型。「呼び出したい処理そのもの」を渡してもらう。
  fn: () => Promise<T>,
  // `maxRetries = 2` は関数のデフォルト引数（Pythonの `maxRetries: int = 2` と同じ）。
  maxRetries = 2
): Promise<T> {
  let lastError: LLMApiError | null = null;

  // `for (let attempt = 0; attempt <= maxRetries; attempt++)` はC言語風のfor文。
  // Pythonでは `for attempt in range(maxRetries + 1):` に相当する。
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // `error instanceof LLMApiError` で型を絞り込むと、
      // 以降のブロックでは自動的に `error` がLLMApiError型として扱われる（型ガード）。
      if (!(error instanceof LLMApiError)) {
        throw error;
      }

      // レート制限とサーバーエラーのみリトライする
      if (error.status !== 429 && error.status < 500) {
        throw error;
      }

      lastError = error;
      if (attempt === maxRetries) {
        break;
      }

      // `Math.pow(2, attempt)` は2のattempt乗＝指数バックオフの基本計算（Pythonの `2 ** attempt`）。
      // `Math.min(..., MAX_BACKOFF_MS)` で上限を設けている。
      const baseBackoff = Math.min(Math.pow(2, attempt) * 1000, MAX_BACKOFF_MS);
      let waitMs = baseBackoff;

      // ヘッダー名の大文字小文字表記ゆれを吸収するため、全部小文字キーの辞書に作り直している。
      const headerMap = error.headers
        ? Object.fromEntries(
            Object.entries(error.headers).map(([k, v]) => [k.toLowerCase(), v])
          )
        : null;

      if (headerMap) {
        // サーバーが明示的に「あと何ミリ秒待って」と指定してきた場合はそれを優先する。
        const retryAfterMs = headerMap['retry-after-ms'];
        if (retryAfterMs) {
          const parsed = parseFloat(retryAfterMs);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed < MAX_BACKOFF_MS) {
            waitMs = parsed;
          }
        }

        if (waitMs === baseBackoff) {
          const retryAfter = headerMap['retry-after'];
          if (retryAfter) {
            const seconds = parseFloat(retryAfter);
            // `number | null` はPythonの `float | None` に相当するユニオン型。
            let parsed: number | null = null;
            if (!Number.isNaN(seconds)) {
              parsed = seconds * 1000;
            } else {
              // 数値でなければ日時文字列として解釈を試みる（HTTPの Retry-After ヘッダー仕様）。
              const date = new Date(retryAfter);
              if (!Number.isNaN(date.getTime())) {
                parsed = date.getTime() - Date.now();
              }
            }
            if (parsed !== null && parsed >= 0 && parsed < MAX_BACKOFF_MS) {
              waitMs = parsed;
            }
          }
        }
      }

      // `setTimeout` をPromiseで包むことで `await` できるようにする「sleep」の定番パターン。
      // Pythonの `await asyncio.sleep(waitMs / 1000)` に相当する。
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError ?? new Error('Retry failed with unknown error');
}
