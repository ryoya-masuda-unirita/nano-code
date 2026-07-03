import type {
  GenerateParams,
  GenerateTextResult,
  LanguageModel,
  StreamChunk,
  ToolCall,
} from '../types';

export type GenerateStreamTextParams = GenerateParams & {
  model: LanguageModel;
};

// 非同期ジェネレータ関数。Pythonの `async def f(): yield ...` に相当。
export async function* generateStreamText(
  params: GenerateStreamTextParams
): AsyncIterable<StreamChunk> {
  if (!params.model.doStream) {
    throw new Error('このモデルはストリーミングに対応していません');
  }

  // `yield*` は「別のジェネレータが生成する値を、そのまま自分の出力として流す」構文
  // （委譲/delegation）。Pythonの `yield from other_generator()` に相当する。
  yield* params.model.doStream(params);
}

export async function collectStreamResult(
  // 引数の型を交差型（&）でその場拡張している。
  // 「GenerateStreamTextParamsの全プロパティ」＋「onChunkという省略可能なコールバック関数」。
  params: GenerateStreamTextParams & {
    onChunk?: (chunk: StreamChunk) => void;
  }
): Promise<GenerateTextResult> {
  let text = '';
  // `StreamChunk['finishReason']` はインデックスアクセス型。
  // 「StreamChunk型の中の finishReason プロパティの型」だけを取り出して再利用している。
  // Pythonでいう「他のTypedDictの特定フィールドの型注釈だけ流用する」ようなイメージ。
  let finishReason: StreamChunk['finishReason'];
  let usage: StreamChunk['usage'];
  let toolCalls: ToolCall[] | undefined;

  // `for await (const chunk of ...)` は非同期イテラブルを1件ずつ処理する構文。
  // Pythonの `async for chunk in ...:` に相当する。
  for await (const chunk of generateStreamText(params)) {
    if (params.onChunk) {
      params.onChunk(chunk);
    }

    if (chunk.kind === 'delta' && chunk.text) {
      text += chunk.text;
    }

    if (chunk.kind === 'done') {
      finishReason = chunk.finishReason;
      usage = chunk.usage;
      toolCalls = chunk.toolCalls;
    }
  }

  return {
    text,
    // finishReasonが最後まで設定されなかった（undefinedのままだった）場合は'stop'を既定値にする。
    finishReason: finishReason ?? 'stop',
    usage,
    toolCalls,
  };
}
