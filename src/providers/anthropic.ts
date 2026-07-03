// TypeScriptでは `import type` を使うと「型情報だけ」をインポートできる。
// 実行時（コンパイル後のJS）にはこの行が消えるため、実行コストがゼロになる。
// Pythonで言えば `if TYPE_CHECKING:` の中で import するのに近いイメージ。
import type {
    GenerateParams,
    GenerateTextResult,
    LanguageModel,
    Provider,
    ToolCall,
    StreamChunk,
} from '../types';
// こちらは `LLMApiError` が実際に使う「クラス（値）」なので type なしで通常のimport。
import { LLMApiError } from '../types';
import Anthropic from '@anthropic-ai/sdk';

// `type` はPythonの型エイリアス（`ProviderConfig = dict[...]`のようなもの）に近い。
// `?` が付いたプロパティは「あってもなくてもよい」= Pythonの `Optional` に相当する。
export type ProviderConfig = {
    apiKey?: string;
    baseURL?: string;
    maxRetries?: number;
};

// 引数や戻り値に型を書けるのがTypeScriptの大きな特徴。
// `string | null | undefined` は「string型 または null または undefined」という
// ユニオン型（Pythonの `str | None` に近いが、undefinedもある点がPythonと違う）。
function mapAnthropicFinishReason(
    stopReason: string | null | undefined
): GenerateTextResult['finishReason'] {
    // `switch` はPythonの `match` 文に近い分岐構文。
    switch (stopReason) {
        case 'end_turn':
        case 'stop_sequence':
            return 'stop';
        case 'max_tokens':
            return 'length';
        case 'tool_use':
            return 'tool_calls';
        default:
            return 'stop';
	}
}

// `Exclude<A, B>` はユーティリティ型で「A型からBに当てはまる型を除外する」もの。
// ここでは messages の配列要素の型から role が 'system' のものを除いた型を作っている。
// Pythonには直接対応する構文はないが、TypedDictの一部を除いたUnionを手作りするイメージに近い。
type NonSystemMessage = Exclude<
    GenerateParams['messages'][number],
    { role: 'system' }
>;

// 引数 `messages` はNonSystemMessageの配列、戻り値はAnthropic.MessageParamの配列、という型注釈。
function mapMessages(messages: NonSystemMessage[]): Anthropic.MessageParam[] {
    // `.map()` はPythonのリスト内包表記に近い（`[f(m) for m in messages]`）。
    // アロー関数 `(message): 型 => {...}` はPythonの `lambda` を拡張したようなもの。
    return messages.map((message): Anthropic.MessageParam => {
        // TypeScriptは `message.role === 'assistant'` の分岐に入ると、
        // その中では自動的に message の型が絞り込まれる（型ガード／narrowing）。
        // Pythonの型チェッカー(mypy)にも似た仕組みがある。
        if (message.role === 'assistant') {
            const content: Anthropic.ContentBlockParam[] = [];
            if (message.content) {
                content.push({ type: 'text', text: message.content });
            }
            if (message.toolCalls) {
                for (const tc of message.toolCalls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.toolCallId,
                        name: tc.name,
                        input: tc.args,
                    });
                }
            }
            return { role: 'assistant', content };
        }

        if (message.role === 'tool') {
            return {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: message.toolCallId,
                        content: message.content,
                    },
                ],
            };
        }

        return { role: 'user', content: message.content };
    });
}

// `config: ProviderConfig = {}` はPythonの `config: ProviderConfig = {}` という
// デフォルト引数の書き方とほぼ同じ発想。
// 戻り値の型 `Provider` はこの関数が「Providerという型に合う値」を返す約束をしている。
export function createAnthropic(config: ProviderConfig = {}): Provider {
    // `??` はNull合体演算子。左側が null/undefined のときだけ右側を使う。
    // Pythonの `config.apiKey or os.environ.get("ANTHROPIC_API_KEY")` に近いが、
    // `or` と違って空文字列 `""` や `0` は「値あり」として扱われる点が異なる。
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    // 正規表現で末尾の `/v1` や `/v1/` を取り除いている（Pythonの re.sub に相当）。
    const baseURL = (config.baseURL ?? 'https://api.anthropic.com').replace(
        /\/v1\/?$/,
        ''
    );

    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY 環境変数が設定されていません');
    }

    // Anthropic SDKのクライアントを1回だけ生成し、以降のクロージャで使い回す。
    const client = new Anthropic({
        apiKey,
        baseURL,
        maxRetries: config.maxRetries ?? 0,
    });

    // この関数はさらに「関数を返す関数」になっている（クロージャ）。
    // `(modelId: string): LanguageModel => ({...})` は、modelIdを受け取って
    // LanguageModel型のオブジェクトを返すアロー関数。
    // 返しているオブジェクトの中で `client` や `modelId` を参照できるのは、
    // クロージャが外側のスコープの変数を覚えているため（Pythonのクロージャと同じ仕組み）。
	return (modelId: string): LanguageModel => ({
	        // `async` が付いたメソッドはPythonの `async def` と同じで、
	        // 戻り値は自動的に Promise（Pythonの Future/Coroutine に相当）でラップされる。
	        async doGenerate(params: GenerateParams): Promise<GenerateTextResult> {
	            const systemMessages = params.messages.filter((m) => m.role === 'system');
	            const messages = params.messages.filter(
	                // `(m): m is NonSystemMessage =>` はユーザー定義型ガード。
	                // filterした後の配列の型を NonSystemMessage[] だとTypeScriptに教えている。
	                (m): m is NonSystemMessage => m.role !== 'system'
	            );
	            const maxTokens = params.maxTokens ?? 1024;
	            // 三項演算子 `条件 ? A : B` はPythonの `A if 条件 else B` と同じ意味。
	            const system =
	                systemMessages.length > 0
	                    ? systemMessages.map((m) => ({
	                          type: 'text' as const,
	                          text: m.content,
	                      }))
	                    : undefined;

	            const tools =
	                params.tools && params.tools.length > 0
	                    ? params.tools.map((tool) => ({
	                          name: tool.name,
	                          description: tool.description,
	                          input_schema:
	                              tool.parameters as Anthropic.Tool.InputSchema,
	                      }))
	                    : undefined;

	            try {
	                // `await` はPythonの `await` と同じく、Promiseの完了を待つ。
	                const response = await client.messages.create(
	                    {
	                        model: modelId,
                        max_tokens: maxTokens,
                        // `...(system && { system })` はスプレッド構文＋条件式の組み合わせ。
                        // systemが真値のときだけ `{ system }` オブジェクトを展開して
                        // 上位のオブジェクトにマージする（キーごと存在させないためのテクニック）。
                        ...(system && { system }),
                        messages: mapMessages(messages),
                        temperature: params.temperature,
                        ...(tools && { tools }),
                    },
                    { signal: params.signal }
                );

                const textBlocks = response.content.filter(
                    (block: any) => block.type === 'text'
                );
                const text = textBlocks.map((block: any) => block.text).join('');

                const toolUseBlocks = response.content.filter(
                    (block: any) => block.type === 'tool_use'
                );

	                const toolCalls: ToolCall[] | undefined =
	                    toolUseBlocks.length > 0
	                        ? toolUseBlocks.map((block: any) => ({
	                              toolCallId: block.id,
	                              name: block.name,
	                              args: block.input,
	                          }))
	                        : undefined;

	                // `?.` はオプショナルチェイニング。左側がnull/undefinedなら
	                // エラーにならずそのままundefinedを返す（Pythonにはこの演算子はない）。
	                const promptTokens =
	                    response.usage?.input_tokens ?? undefined;
	                const completionTokens =
	                    response.usage?.output_tokens ?? undefined;

	                return {
	                    text,
	                    finishReason: mapAnthropicFinishReason(response.stop_reason),
	                    usage: response.usage
	                        ? {
	                              promptTokens,
	                              completionTokens,
	                              totalTokens:
	                                  (promptTokens ?? 0) +
	                                  (completionTokens ?? 0),
	                          }
	                        : undefined,
	                    toolCalls,
	                };
	            } catch (error) {
                // `error instanceof Anthropic.APIError` はPythonの
                // `isinstance(error, AnthropicAPIError)` に相当する型チェック。
                if (error instanceof Anthropic.APIError) {
                    const headers = error.headers
                        ? Object.fromEntries(error.headers.entries())
                        : undefined;
                    throw new LLMApiError(
                        error.status ?? 500,
                        'anthropic',
                        undefined,
                        error.message,
                        error.error,
                        headers
                    );
                }
                // ここでの `throw error` は「想定外のエラーはそのまま外側に投げ直す」＝
                // Pythonで言う `raise` （引数なしで再送出）と同じ考え方。
                throw error;
            }
	        },
	        // `async *doStream(...)` は非同期ジェネレータ。
	        // Pythonの `async def doStream(...): yield ...` にあたる、
	        // 「複数回に分けて値を返す非同期関数」。呼び出し側は `for await...of` で回す。
	        async *doStream(params: GenerateParams) {
	            const systemMessages = params.messages.filter((m) => m.role === 'system');
	            const messages = params.messages.filter(
	                (m): m is NonSystemMessage => m.role !== 'system'
	            );
	            const system =
	                systemMessages.length > 0
	                    ? systemMessages.map((m) => ({
	                          type: 'text' as const,
	                          text: m.content,
	                      }))
	                    : undefined;

            const tools =
                params.tools && params.tools.length > 0
                    ? params.tools.map((tool) => ({
                          name: tool.name,
                          description: tool.description,
                          input_schema: tool.parameters as Anthropic.Tool.InputSchema,
                      }))
                    : undefined;

            try {
                // `stream: true` を渡すと、レスポンス全体ではなく
                // 逐次イベントのストリームが返ってくる。
                const stream = await client.messages.create(
                    {
                        model: modelId,
                        max_tokens: params.maxTokens ?? 4096,
                        ...(system && { system }),
                        messages: mapMessages(messages),
                        temperature: params.temperature,
                        stream: true,
                        ...(tools && tools.length > 0 && { tools }),
                    },
                    { signal: params.signal }
                );

                // `Record<string, ToolCall>` はPythonの `dict[str, ToolCall]` に相当する型。
                const toolCalls: Record<string, ToolCall> = {};
                const partialJsonBuffers: Record<string, string> = {};
                const indexToId: Record<number, string> = {};
                let finishReason: StreamChunk['finishReason'];
                let usage: StreamChunk['usage'];

                // `for await (const event of stream)` はPythonの
                // `async for event in stream:` と同じく、非同期イテラブルを1件ずつ処理する。
                for await (const event of stream) {
                    switch (event.type) {
                        case 'content_block_start':
                            if (event.content_block?.type === 'tool_use') {
                                const id = event.content_block.id;
                                indexToId[event.index] = id;
                                toolCalls[id] = {
                                    toolCallId: id,
                                    name: event.content_block.name,
                                    args: {},
                                };
                                partialJsonBuffers[id] = '';
                            }
                            break;

                        case 'content_block_delta':
                            if (event.delta?.type === 'text_delta') {
                                // `yield` はPythonのyieldと同じ。呼び出し元に1個ずつ値を渡す。
                                yield { kind: 'delta', text: event.delta.text };
                            }
                            if (event.delta?.type === 'input_json_delta') {
                                const id = indexToId[event.index];
                                const toolCall = id ? toolCalls[id] : undefined;
                                if (id && toolCall) {
                                    const buffer = (partialJsonBuffers[id] ?? '') + event.delta.partial_json;
                                    partialJsonBuffers[id] = buffer;
                                    try {
                                        toolCall.args = JSON.parse(buffer);
                                    } catch {
                                        // JSONが不完全な場合は次のデルタを待つ
                                    }
                                }
                            }
                            break;

	                        case 'message_delta': {
	                            if (event.delta?.stop_reason) {
	                                finishReason = mapAnthropicFinishReason(
	                                    event.delta.stop_reason
	                                );
	                            }
	                            if (event.usage) {
	                                usage = {
	                                    promptTokens:
	                                        event.usage.input_tokens ?? undefined,
	                                    completionTokens: event.usage.output_tokens,
	                                    totalTokens:
	                                        (event.usage.input_tokens || 0) +
	                                        (event.usage.output_tokens || 0),
	                                };
	                            }
	                            break;
	                        }

                        case 'message_stop': {
                            const toolCallList = Object.values(toolCalls);
                            yield {
                                kind: 'done',
                                finishReason,
                                usage,
                                toolCalls:
                                    toolCallList.length > 0
                                        ? toolCallList
                                        : undefined,
                            };
                            // ジェネレータの中での `return` はPythonと同様、
                            // それ以上値を生成せずにイテレーションを終了させる。
                            return;
                        }
                        default:
                            break;
                    }
                }
            } catch (error) {
                if (error instanceof Anthropic.APIError) {
                    const headers = error.headers
                        ? Object.fromEntries(error.headers.entries())
                        : undefined;
                    throw new LLMApiError(
                        error.status ?? 500,
                        'anthropic',
                        undefined,
                        error.message,
                        error.error,
                        headers
                    );
                }
                throw error;
            }
        },
    });
}
