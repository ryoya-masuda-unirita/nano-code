// src/tools/webFetch.ts
import type { Tool } from '../types';
import { config } from '../config';

async function webFetchExecute(args: Record<string, unknown>): Promise<string> {
    // `args.url` の型は `unknown` なので、`as string` で「これはstring型のはず」と
    // TypeScriptに明示している（型アサーション）。Pythonの `cast(str, args["url"])` に近いが、
    // 実行時のチェックは行われない＝間違っていても実行時までエラーにならない点に注意。
    const url = args.url as string;

    // URLのパース（バリデーション含む）
    // `let targetUrl: URL;` は「後で必ず代入するが、今はまだ値がない」変数の型だけ先に宣言する書き方。
    let targetUrl: URL;
    try {
        // 組み込みの `URL` クラス。不正な文字列を渡すと例外を投げてくれる＝簡易バリデーションに使える。
        targetUrl = new URL(url);
    } catch {
        // Pythonの `except:`（型を指定しないcatch）と同じ。ここでは元の例外情報を使わず握りつぶし、
        // 分かりやすいメッセージのエラーに変換して投げ直している。
        throw new Error('無効なURL形式です');
    }

    // ガードレール: 許可リストのチェック
    // `.some(...)` は配列の中に条件を満たす要素が1つでもあればtrueを返す。
    // Pythonの `any(...)` に相当する。
    const isAllowed = config.allowedDomains.some(domain =>
        targetUrl.hostname === domain || targetUrl.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
        throw new Error(
            `セキュリティエラー: ドメイン '${targetUrl.hostname}' へのアクセスは許可されていません。\n` +
            `許可リスト: ${config.allowedDomains.join(', ')}`
        );
    }

    // 実際のフェッチ処理
    // `fetch` はブラウザ/Node標準のHTTPクライアント。Pythonの `requests.get` に近い。
    // `redirect: 'error'` はリダイレクトが発生したら自動で追わず例外にする設定。
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

// `Tool` 型（`../types` で定義）の形に合わせてオブジェクトを作っている。
// TypeScriptはこの変数の中身がTool型の条件（name, description, parametersなど）を
// 満たしているかをコンパイル時にチェックしてくれる。
export const webFetch: Tool = {
    name: 'webFetch',
    description: '指定されたURLのWebページを取得します',
    needsApproval: true,
    // LLMに渡すJSONスキーマ。ここは実行時に読まれるプレーンなオブジェクトなので型は緩め。
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '取得したいURL' },
        },
        required: ['url'],
    },
    execute: webFetchExecute,
};
