// 표 이름 → 표 인터페이스 이름 (task_events → TaskEvent, categories → Category, wiki_aliases → WikiAlias).
// pnpm db:rows(db-rows.mjs)가 만드는 이름과 묶음 생성기(new-bundle.mjs)가 미리 쓰는 이름이 같아야 해서 한 곳에 둔다.
export function rowTypeOf(table) {
  const words = table.split('_');
  words[words.length - 1] = singular(words.at(-1));
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

function singular(word) {
  if (word === 'series') return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ases')) return word.slice(0, -2);
  return word.endsWith('s') ? word.slice(0, -1) : word;
}
