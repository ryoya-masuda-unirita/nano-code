// このファイルは「型だけ」を定義している。実行時のロジックは一切含まれず、
// コンパイル後には（一部を除き）跡形もなく消える。
// Pythonで言えば TypedDict / dataclass / Protocol をまとめて書いたファイルに近い。

// 第3章で定義： LLMが理解するツール定義（JSONスキーマ + 実行関数）
// `type` はオブジェクトの形を定義するエイリアス。Pythonの `TypedDict` に近い。
export type Tool = {
  name: string;
  description: string;
  // `Record<string, unknown>` はキーがstring、値の型が分からない（unknown=何でもあり得るが
  // 使う前に型チェックが必要）辞書型。Pythonの `dict[str, Any]` に近いが、
  // `unknown` は `any` と違って使う前に型を確認しないとエラーになる、より安全な型。
  parameters: Record<string, unknown>;
  // 関数を値として持つプロパティ。`(args: X) => Promise<string>` は
  // 「Xを受け取り、Promise<string>（非同期でstringを返す）関数」という型。
  // Pythonなら `Callable[[dict], Awaitable[str]]` に相当。
  execute: (args: Record<string, unknown>) => Promise<string>;
  // `?` はオプショナルプロパティ。Pythonの `Optional[bool]` かつデフォルトNoneに近い。
  needsApproval?: boolean; // 第5章で定義
};

// 第3章で定義：LLMが発行するツール呼び出し
export type ToolCall = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

// 第3章で定義：会話に追加されるツール実行結果
export type ToolResult = {
  toolCallId: string;
  result: string;
};

// 第3章で定義：モデルとやりとりするメッセージ構造
// `|` はユニオン型。「AまたはBまたはC」を表す。
// これは「判別可能なユニオン（discriminated union）」と呼ばれるパターンで、
// `role` プロパティの値（'user'などのリテラル文字列）によって、
// そのオブジェクトが持つ他のプロパティが変わることをTypeScriptに伝えている。
// Pythonでは複数のdataclass/TypedDictを `Union[...]` でまとめるのに近い。
export type Message =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

// 使用量メタデータ（プロバイダ依存）
export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

// ストリーミングレスポンスの読み取り時に発行されるチャンク
// `type` の代わりに `interface` でも同じようにオブジェクトの形を定義できる。
// 基本的な違いは、interfaceは後から `interface StreamChunk { ... }` を
// 再度書くことでプロパティを追加できる（宣言のマージ）点。typeにはこれができない。
export interface StreamChunk {
  // 文字列リテラル型のユニオン。Pythonの `Literal["delta", "event", "done"]` に相当し、
  // 取り得る値が3つのどれかに限定される。
  kind: 'delta' | 'event' | 'done';
  text?: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error';
  usage?: Usage;
  toolCalls?: ToolCall[];
  // `unknown` は「型はわからないが、any（何でもあり）よりは安全」という型。
  error?: unknown;
}

// 統一されたLLMレスポンス
export type GenerateTextResult = {
  text: string;
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error';
  toolCalls?: ToolCall[];
  usage?: Usage;
};

// generateTextに渡すパラメータ
export type GenerateParams = {
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  // `AbortSignal` はブラウザ/Node標準のAPIで、処理を中断するための合図オブジェクト。
  // Pythonにはこれに直接対応する標準機能はなく、`asyncio` のキャンセルに近い役割。
  signal?: AbortSignal;
};

// 各プロバイダが実装する言語モデルのインタフェース
// interfaceはクラスや関数の「守るべき形」を定義するのによく使う。
// Pythonの `Protocol`（構造的部分型）に近い考え方で、
// 「この形を満たしていれば、明示的に継承しなくてもLanguageModelとして扱える」。
export interface LanguageModel {
  doGenerate(params: GenerateParams): Promise<GenerateTextResult>;
  // メソッド自体も `?` を付けるとオプショナルにできる。
  // `AsyncIterable<StreamChunk>` はPythonの `AsyncIterator[StreamChunk]` に相当し、
  // `for await...of` で1つずつ取り出せるものを表す。
  doStream?(params: GenerateParams): AsyncIterable<StreamChunk>;
}

// モデルIDに紐づいた言語モデルを返すプロバイダファクトリ
// これは「関数の型」を定義している。`(modelId: string) => LanguageModel` は
// 「文字列を受け取ってLanguageModelを返す関数」という型。
// Pythonの `Callable[[str], LanguageModel]` に相当する。
export type Provider = (modelId: string) => LanguageModel;

// プロバイダ固有のエラーを公開する統一APIエラー
// TypeScriptでも `class` を使ってPythonと同じようにクラスを定義できる。
// `extends Error` はPythonの `class LLMApiError(Exception):` に相当する継承。
export class LLMApiError extends Error {
  // コンストラクタの引数に `public` を付けると、「引数を受け取る」と「同名の
  // インスタンスプロパティに代入する」を同時に行ってくれる（TypeScript独自の省略記法）。
  // Pythonで書くと `self.status = status` を毎回書く手間を省略しているイメージ。
  constructor(
    public status: number,
    public provider: string,
    public code?: string,
    message?: string,
    public raw?: unknown,
    public headers?: Record<string, string>
  ) {
    // `super(...)` は親クラス（Error）のコンストラクタ呼び出し。Pythonの `super().__init__()`。
    super(message || `LLM API Error: ${provider} returned ${status}`);
    this.name = 'LLMApiError';
  }
}
