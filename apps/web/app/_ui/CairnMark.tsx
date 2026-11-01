// 돌탑 표식. 글자색을 따라가서 화이트·블랙 어디서나 같게 보인다.
export function CairnMark({ size = 22, stack = false }: { size?: number; stack?: boolean }) {
  const st = (i: number) =>
    stack ? { className: 'st', style: { animationDelay: `${0.05 + i * 0.18}s` } } : {};
  return (
    <svg
      className={stack ? 'mark' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <ellipse {...st(0)} cx="12" cy="19.5" rx="8" ry="2.8" />
      <ellipse {...st(1)} cx="12" cy="13.8" rx="5.6" ry="2.5" />
      <ellipse {...st(2)} cx="12" cy="8.6" rx="3.4" ry="2" />
    </svg>
  );
}
