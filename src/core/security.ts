import * as path from 'path';

// 機密ファイルのパターン
// `/pattern/` はJavaScript/TypeScript標準の正規表現リテラル。
// Pythonの `re.compile(r"pattern")` に相当するが、コンパイル済みオブジェクトを直接書ける。
const SENSITIVE_FILE_PATTERNS = [
    /\.env$/,
    /\.env\./,
    /credentials\.json$/,
    /\.ssh\/id_rsa$/,
    /\.pgpass$/,
    /\.kube\/config$/,
    /\.aws\/credentials$/,
];

// `boolean` はPythonの `bool` に相当。戻り値の型注釈で「必ずtrue/falseを返す」ことを保証する。
export function isSensitiveFile(filePath: string): boolean {
    // `.some(...)` は配列内に条件を満たす要素があるかを調べる（Pythonの `any()` に相当）。
    // `pattern.test(str)` は正規表現がマッチするかどうかを返すメソッド
    // （Pythonの `bool(pattern.search(str))` に近い）。
    return SENSITIVE_FILE_PATTERNS.some(pattern =>
        pattern.test(path.normalize(filePath))
    );
}

// 危険なコマンドパターン
const DANGEROUS_PATTERNS = [
    /[^\\]>/,                // リダイレクト（>、>>）
    /\$\(/,                  // コマンド置換 $()
    /`/,                     // バッククォート置換
    /\beval\b/,              // eval
    /\$\{[^}]*##/,          // 変数難読化
];

// 戻り値の型 `{ dangerous: boolean; reason?: string }` はその場で定義した無名のオブジェクト型。
// 「dangerousキーは必須のbool、reasonキーは省略可能なstring」という意味。
// Pythonなら `dict` を返す代わりに `TypedDict` を即席で定義しているようなイメージ。
export function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
    if (/\bsudo\b/.test(command)) {
        return { dangerous: true, reason: 'sudo による権限昇格は禁止されています' };
    }
    if (DANGEROUS_PATTERNS.some(pattern => pattern.test(command))) {
        return { dangerous: true, reason: '危険なパターンが検出されました' };
    }
    return { dangerous: false };
}

const ALLOWED_ENV_VARS = [
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'NODE_ENV',
    'BUN_ENV',
];

// `NodeJS.ProcessEnv` はNode.jsが提供するグローバルな型で、環境変数の辞書
// （`Record<string, string | undefined>` に近い）を表す。
export function filterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    // `Object.entries(env)` はPythonの `env.items()` に相当し、[key, value]の配列に変換する。
    // `.filter(([key]) => ...)` は分割代入で最初の要素（key）だけを取り出して条件判定している。
    // `Object.fromEntries(...)` は逆に [key, value] の配列を辞書オブジェクトに戻す
    // （Pythonの `dict(items)` に相当）。
    return Object.fromEntries(
        Object.entries(env).filter(([key]) => ALLOWED_ENV_VARS.includes(key))
    );
}
