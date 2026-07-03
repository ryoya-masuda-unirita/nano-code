import * as readline from 'readline';

// `args: any` は「型チェックを放棄する」特殊な型。何を渡してもエラーにならない代わりに
// TypeScriptの恩恵（補完・型安全）を失う。Pythonで型ヒントを付けないのと同じ状態に近い。
// 可能であれば `any` より `unknown` や具体的な型を使う方が安全。
export async function requestApproval(
    toolName: string,
    args: any
): Promise<boolean> {
    // `new Promise((resolve) => {...})` はコールバック形式のAPI（readlineの `question`）を
    // async/awaitで使えるPromiseに変換するための定番パターン。
    // Pythonの `asyncio.Future` を手動でresolveするのに近いイメージ。
    return new Promise((resolve) => {
        // 標準入力から1行読み取るためのインターフェースを作成。
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n--- 承認が必要です ---');
        console.log(`ツール: ${toolName}`);
        // `JSON.stringify(args, null, 2)` はPythonの `json.dumps(args, indent=2)` に相当。
        console.log(`引数: ${JSON.stringify(args, null, 2)}`);

        // `rl.question(...)` はユーザーの入力を待ち、入力されたらコールバック関数を呼ぶ。
        // このコールバックの中で `resolve(true/false)` を呼ぶことで、
        // 外側の Promise（＝この関数のawait先）に結果を渡している。
        rl.question('このツールを実行しますか？ (y/n): ', (answer) => {
            rl.close();

            if (answer.toLowerCase() === 'y') {
                console.log('承認されました。実行します...\n');
                resolve(true);
            } else {
                console.log('キャンセルされました。\n');
                resolve(false);
            }
        });
    });
}
