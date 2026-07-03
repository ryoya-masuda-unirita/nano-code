// このファイルは各ツールを1か所に集めて再エクスポートする「バレルファイル」と呼ばれるパターン。
// Pythonの `__init__.py` で `from .read_file import read_file` のように
// パッケージの窓口をまとめるのと同じ役割。
export { readFile } from './readFile';
export { writeFile } from './writeFile';
export { editFile } from './editFile';
export { execCommand } from './execCommand';

// 下でも使うので改めてimportしている（上のexportとは別に、この後の配列を作るために必要）。
import { readFile } from './readFile';
import { writeFile } from './writeFile';
import { editFile } from './editFile';
import { execCommand } from './execCommand';

// `const` は再代入しない変数の宣言。配列自体の中身（要素）は書き換え可能だが、
// `allTools` という変数を別の配列に差し替えることはできない。
export const allTools = [readFile, writeFile, editFile, execCommand];
