// SSE (Server-Sent Events) は「サーバーからクライアントへ一方向にテキストを流し続ける」規格。
// このファイルはそれをパースして1件ずつ取り出すユーティリティ。
export interface SSEEvent {
  event?: string;
  data: string;
}

// `async function*` は非同期ジェネレータ関数。Pythonの `async def f(): yield ...` に相当し、
// 呼び出し側は `for await (const e of parseSSEStream(...))` のように1件ずつ受け取れる。
// `ReadableStream<Uint8Array>` はブラウザ/Node標準のバイナリストリーム型
// （`Uint8Array` はバイト列＝Pythonの `bytes` に近い）。
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<SSEEvent> {
  // ストリームを読むための「読み取りロック」を取得する。
  const reader = stream.getReader();
  // バイト列を文字列にデコードするための道具（Pythonの `bytes.decode()` に相当）。
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // `while (true)` はPythonの `while True:` と同じ無限ループ。
    while (true) {
      // オブジェクトの分割代入。Pythonのタプルアンパック `done, value = ...` に近いが、
      // ここでは `{ done, value }` という「オブジェクトのプロパティを取り出す」構文。
      const { done, value } = await reader.read();
      if (done) break;

      // `{ stream: true }` は「まだ続きのバイトが来る前提でデコードする」オプション。
      // マルチバイト文字が途中で切れても壊れないようにするため。
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // `.pop()` は配列の末尾を取り除いて返す（Pythonの `list.pop()` と同じ）。
      // 末尾（＝まだ改行で終わっていない可能性がある断片）を次回の読み込みに繰り越す。
      buffer = lines.pop() || '';

      let currentEvent: SSEEvent = { data: '' };
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          // 空行はSSEの「1イベントの区切り」を意味する。
          if (currentEvent.data || currentEvent.event) {
            yield currentEvent;
            currentEvent = { data: '' };
          }
          continue;
        }
        if (trimmed.startsWith('event:')) {
          // `.slice(6)` は先頭6文字（"event:"の長さ）をスキップする＝Pythonの `line[6:]`。
          currentEvent.event = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          currentEvent.data = trimmed.slice(5).trim();
        }
      }
    }
  } finally {
    // Pythonの `finally` と同じく、正常終了・例外どちらの場合でも必ず実行される後始末処理。
    reader.releaseLock();
  }
}
