// 기계 검사: 초안(<work>/draft.md)이 노트 규칙의 모양을 지키는지, 사람이 보지 않아도 되는 것만 본다.
//
//   node check.mjs <work>
//
// 보는 것
//   제목과 칸의 한도 · 한 일 · 결정 · 막힌 점의 항목마다 근거표 줄이 있는지 · 근거 번호가 근거 묶음에 있는지
//   인용이 근거 묶음의 원문에 글자 그대로 있는지 (… 앞뒤는 따로) · 남은 비밀값 무늬
// 결과: { ok, problems: [...] } 한 줄. 문제가 있으면 종료 코드 1.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECRET_RULES } from './secrets.mjs';

const work = process.argv[2];
if (!work || !existsSync(join(work, 'draft.md'))) throw new Error('초안이 없어요: <work>/draft.md');
const draft = readFileSync(join(work, 'draft.md'), 'utf8');
const evidenceFile = join(work, 'evidence.json');
const evidence = existsSync(evidenceFile) ? JSON.parse(readFileSync(evidenceFile, 'utf8')) : null;
const byId = new Map((evidence?.items ?? []).map((item) => [item.id, item.text]));
const problems = [];

const SECTIONS = { '한 일': 20_000, 결정: 20_000, '막힌 점': 20_000, 인용: 4_000, 기타: 20_000 };
const sections = new Map();
let current = null;
for (const line of draft.split('\n')) {
  const head = /^## (.+)$/.exec(line);
  if (head) {
    current = head[1].trim();
    sections.set(current, []);
  } else if (current) sections.get(current).push(line);
}
const text = (name) => (sections.get(name) ?? []).join('\n').trim();
const items = (name) => (sections.get(name) ?? []).filter((l) => /^- /.test(l));

// 제목 · 한도
const title = /^# 제목:\s*(.*)$/m.exec(draft)?.[1]?.trim() ?? '';
if (!title) problems.push('제목이 없어요 ("# 제목: …")');
if (title.length > 200) problems.push(`제목이 200자를 넘어요 (${title.length}자)`);
if (!text('한 일')) problems.push('"한 일"은 꼭 써야 해요');
for (const [name, max] of Object.entries(SECTIONS))
  if (text(name).length > max)
    problems.push(
      `${name}이(가) ${max.toLocaleString('en-US')}자를 넘어요 (${text(name).length}자)`,
    );

// 근거표: 항목마다 한 줄, 번호는 근거 묶음에 있어야 한다
const table = new Map();
for (const line of sections.get('근거표') ?? []) {
  const row = /^\|\s*(한 일|결정|막힌 점)\s*(\d+)\s*\|\s*([^|]*)\|/.exec(line);
  if (row) table.set(`${row[1]} ${row[2]}`, row[3].split(/[,\s]+/).filter(Boolean));
}
for (const name of ['한 일', '결정', '막힌 점'])
  items(name).forEach((_, i) => {
    const ids = table.get(`${name} ${i + 1}`);
    if (!ids || ids.length === 0) problems.push(`${name} ${i + 1}: 근거표에 근거가 없어요`);
    else if (evidence)
      for (const id of ids)
        if (!byId.has(id)) problems.push(`${name} ${i + 1}: 근거 묶음에 없는 번호 ${id}`);
  });

// 인용: - 사용자 [U4]: "…" 모양, 원문에 글자 그대로
const squash = (s) => s.replace(/\s+/g, ' ').trim();
for (const line of items('인용')) {
  const quote = /^- (사용자|도구|AI) \[([URA]\d+)\]: "([\s\S]*)"\s*$/.exec(line);
  if (!quote) {
    problems.push(`인용 모양이 달라요: ${line.slice(0, 60)} (- 사용자 [U4]: "…")`);
    continue;
  }
  const [, who, id, said] = quote;
  const expected = { 사용자: 'U', 도구: 'R', AI: 'A' }[who];
  if (!id.startsWith(expected))
    problems.push(`인용 ${id}: ${who}의 말은 ${expected} 번호여야 해요`);
  if (!evidence) continue;
  const source = byId.get(id);
  if (!source) {
    problems.push(`인용 ${id}: 근거 묶음에 없는 번호`);
    continue;
  }
  for (const part of said.split('…').map(squash).filter(Boolean))
    if (!squash(source).includes(part))
      problems.push(`인용 ${id}: 원문과 글자가 달라요 "${part.slice(0, 40)}"`);
}

// 남은 비밀값
for (const [label, pattern] of SECRET_RULES) {
  pattern.lastIndex = 0;
  if (pattern.test(draft)) problems.push(`비밀값이 남았어요: ${label} → [지움: ${label}]로 바꿔요`);
}

console.log(
  JSON.stringify({ ok: problems.length === 0, problems, quotes_checked: Boolean(evidence) }),
);
process.exitCode = problems.length ? 1 : 0;
