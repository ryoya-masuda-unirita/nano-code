import { generateText } from './generate-text';
import { collectStreamResult } from './generate-stream';
import type { Message, Tool, LanguageModel } from '../types';
import { LLMApiError } from '../types';
import { requestApproval } from './approval';

// このAgentクラスのコンストラクタに渡す設定の形。
interface AgentConfig {
    name: string;
    model: LanguageModel;
    instructions: string;
    tools: Record<string, any>;
    maxSteps?: number;
    // 関数型のプロパティ。「ツール名とその引数を受け取り、承認するかどうかを非同期で返す関数」。
    approvalFunc?: (name: string, args: any) => Promise<boolean>;
    verbose?: boolean;
    useStreaming?: boolean;
}

// TypeScriptのクラスはPythonのクラスとほぼ同じ形で書ける。
export class Agent {
    // クラスのプロパティ（フィールド）は、Pythonのように `__init__` の中で
    // `self.xxx = xxx` するのではなく、クラス本体の先頭でまとめて宣言するのが一般的。
    // `private` はTypeScript独自のアクセス修飾子で、「このクラスの外からは参照できない」ことを示す。
    // Pythonでは慣習的に `_name`（アンダースコア始まり）で私的扱いを表すのに近い。
    private name: string;
    private model: LanguageModel;
    private instructions: string;
    private tools: Tool[];
    private maxSteps: number;
    private approvalFunc: (name: string, args: any) => Promise<boolean>;
    private verbose?: boolean;
    private useStreaming?: boolean;

    // `constructor` はPythonの `__init__` に相当する初期化メソッド。
    constructor(config: AgentConfig) {
        this.name = config.name;
        this.model = config.model;
        this.instructions = config.instructions;
        // `Object.values(config.tools)` は辞書の値だけを配列にする（Pythonの `dict.values()` に相当）。
        this.tools = Object.values(config.tools);
        this.maxSteps = config.maxSteps || 10;
        this.approvalFunc = config.approvalFunc || requestApproval;
        this.verbose = config.verbose || false;
        this.useStreaming = config.useStreaming || false;
    }

    /**
     * コンテキストサイズを管理し、制限を超えそうな場合に履歴を圧縮する
     */
    // クラスの「メソッド」にも `private` を付けられる。外部から `agent.manageContext(...)` は呼べない。
    private manageContext(messages: Message[]): Message[] {
        // 簡易的な制限：文字数で判定（例: 30,000文字 ≈ 10k~15kトークン程度と仮定）
        const CHAR_LIMIT = 30000;

        // `.reduce((sum, m) => sum + ..., 0)` は配列を1つの値に集約する。
        // Pythonの `sum(len(m.get("content", "")) for m in messages)` に相当。
        // `m.content?.length || 0` は「contentがあればその長さ、なければ0」というフォールバック。
        let totalLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

        // 制限内なら何もしない
        if (totalLength < CHAR_LIMIT) {
            return messages;
        }

        console.log(`\n[Context] 会話履歴を圧縮します (現在: ${totalLength}文字)`);

        // 1. 守るべきメッセージを確保
        const systemMessage = messages[0];
        if (!systemMessage) {
            return messages;
        }
        // `.slice(-4)` は末尾4件を取り出す（Pythonの `messages[-4:]` に相当）。
        const recentMessages = messages.slice(-4);
        // `.slice(1, -4)` は先頭1件と末尾4件を除いた「中間部分」（Pythonの `messages[1:-4]`）。
        let middleMessages = messages.slice(1, -4);

        // 2. 戦略A: 古いツール実行結果を「省略」に置換
        // `.map(...)` は各要素を変換して新しい配列を作る（Pythonのリスト内包表記に相当）。
        middleMessages = middleMessages.map(msg => {
            if (msg.role === 'tool' && msg.content && msg.content.length > 200) {
                return {
                    // `...msg` はスプレイド構文。既存のプロパティをコピーしつつ、
                    // 続けて書いた `content` だけを上書きした新しいオブジェクトを作る。
                    // Pythonの `{**msg, "content": "..."}` に相当（イミュータブルな更新パターン）。
                    ...msg,
                    content: `(以前のツール実行結果は省略されました: ${msg.content.length}文字)`
                };
            }
            return msg;
        });

        // 3. 戦略B: それでも溢れるなら、古い順に削除
        totalLength = (systemMessage.content?.length || 0) +
                      middleMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) +
                      recentMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

        while (totalLength > CHAR_LIMIT && middleMessages.length > 0) {
            // `.shift()` は配列の先頭を取り除いて返す（Pythonの `list.pop(0)` に相当。ただしO(n)）。
            const removed = middleMessages.shift();
            if (removed) {
                totalLength -= (removed.content?.length || 0);
            }
        }

        return [systemMessage, ...middleMessages, ...recentMessages];
    }

    // 戻り値の型をその場でオブジェクト型として定義。
    // `finishReason` は決められた文字列リテラルのどれかしか入らないユニオン型。
    async generate(userPrompt: string): Promise<{
        text: string;
        finishReason: 'stop' | 'max_steps' | 'length' | 'content_filter' | 'error';
        usage?: { totalTokens: number };
    }> {
        // let に変更（manageContextの戻り値で再代入するため）
        let messages: Message[] = [
            { role: 'system', content: this.instructions },
            { role: 'user', content: userPrompt },
        ];

        let currentStep = 0;
        let finalText = '';
        let totalTokens = 0;
        let finishReason: 'stop' | 'max_steps' | 'length' | 'content_filter' | 'error' = 'max_steps';

        while (currentStep < this.maxSteps) {
            currentStep++;
            console.log(`\nStep ${currentStep}/${this.maxSteps}\n`);

            // コンテキスト管理
            messages = this.manageContext(messages);

            // `(async () => { ... })()` は「即時実行される非同期の無名関数（IIFE）」。
            // if/elseで結果の作り方が分かれる処理を1つの式にまとめてawaitするためのテクニック。
            // Pythonには構文としての対応物はないが、同じ処理を書くなら
            // 通常はヘルパー関数を先に定義してから呼び出す形になる。
            const response = await (async () => {
                if (this.useStreaming) {
                    if (this.model.doStream) {
                        const streamResult = await collectStreamResult({
                            model: this.model,
                            messages,
                            tools: this.tools,
                            maxTokens: 4096,
                            onChunk: (chunk) => {
                                if (chunk.kind === 'delta' && chunk.text) {
                                    // `process.stdout.write` は改行なしで標準出力に書く（Pythonの
                                    // `print(text, end="")` に相当）。ストリーミング表示に使う。
                                    process.stdout.write(chunk.text);
                                }
                            },
                        });
                        console.log();
                        return streamResult;
                    }
                    console.warn('[Streaming] モデルがストリーミングに未対応のため通常APIを使用します。');
                }

                return generateText({
                    model: this.model,
                    messages,
                    tools: this.tools,
                    maxTokens: 4096,
                });
            })();

            // トークン数の累積
            totalTokens += response.usage?.totalTokens ?? 0;

            if (response.text) {
                console.log(response.text);
                finalText += response.text;
            }

            if (response.toolCalls && response.toolCalls.length > 0) {
                messages.push({
                    role: 'assistant',
                    content: response.text || '',
                    toolCalls: response.toolCalls,
                });

                for (const toolCall of response.toolCalls) {
                    // `.find(...)` は条件を満たす最初の要素を返す（見つからなければundefined）。
                    // Pythonの `next((t for t in tools if t.name == name), None)` に相当。
                    const tool = this.tools.find(t => t.name === toolCall.name);
                    if (tool) {
                        console.log(`[ツール] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

                        if (tool.needsApproval) {
                            const approved = await this.approvalFunc(toolCall.name, toolCall.args);
                            if (!approved) {
                                messages.push({
                                    role: 'tool',
                                    toolCallId: toolCall.toolCallId,
                                    name: toolCall.name,
                                    content: 'ユーザーによってキャンセルされました。別の方法を検討してください。'
                                });
                                // `continue` はPythonと同じくループの次周回に進む。
                                continue;
                            }
                        }

                        try {
                            const result = await tool.execute(toolCall.args);
                            console.log(`[結果] 成功: ${result.slice(0, 100)}...`);
                            messages.push({
                                role: 'tool',
                                content: result,
                                toolCallId: toolCall.toolCallId,
                                name: toolCall.name,
                            });
                        } catch (error: any) {
                            const errorMessage = error.message || 'Unknown error';
                            const errorDetails = error instanceof LLMApiError && error.raw
                                ? `\n詳細: ${JSON.stringify(error.raw, null, 2)}`
                                : '';
                            console.log(`[結果] エラー: ${errorMessage}${errorDetails}`);
                            messages.push({
                                role: 'tool',
                                content: `エラー: ${errorMessage}`,
                                toolCallId: toolCall.toolCallId,
                                name: toolCall.name,
                            });
                        }
                    } else {
                        console.error(`不明なツール: ${toolCall.name}`);
                        messages.push({
                            role: 'tool',
                            toolCallId: toolCall.toolCallId,
                            name: toolCall.name,
                            content: `エラー: ツール ${toolCall.name} が見つかりません`
                        });
                    }
                }
                continue;
            }

            if (response.text) {
                messages.push({ role: 'assistant', content: response.text });
            }

            // 正常終了: LLMが応答を完了した
            if (response.finishReason === 'stop') {
                finishReason = 'stop';
                break;
            }
            // 出力トークン上限: 応答が途中で切れた可能性があるが、次のステップに進む
            if (response.finishReason === 'length') {
                console.warn('[警告] 出力トークン上限に達しました。次のステップに進みます。');
                continue;
            }
            // コンテンツフィルタ: 安全上の理由で中断
            if (response.finishReason === 'content_filter') {
                finishReason = 'content_filter';
                break;
            }
        }

        if (currentStep >= this.maxSteps) {
            console.warn('警告: 最大ステップ数に達しました');
        }

        // 完了時のサマリ出力
        if (this.verbose) {
            console.log(`\n[完了] ステップ数: ${currentStep}, 総トークン: ${totalTokens}`);
        }

        return {
            text: finalText,
            finishReason,
            usage: { totalTokens },
        };
    }
}
