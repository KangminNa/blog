// 돌탑 표식. 작게는 브랜드, 크게는 빈 그래프·설치 화면 가운데에 쌓이며 나타난다.
export function CairnMark({ size = 24, stack = false }: { size?: number; stack?: boolean }) {
  const st = (i: number) =>
    stack ? { className: 'st', style: { animationDelay: `${0.05 + i * 0.18}s` } } : {};
  return (
    <svg
      className={stack ? 'mark' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <ellipse {...st(0)} cx="12" cy="19.5" rx="8" ry="2.8" fill="#ECE7DD" />
      <ellipse {...st(1)} cx="12" cy="13.8" rx="5.6" ry="2.5" fill="#8E887D" />
      <ellipse {...st(2)} cx="12" cy="8.6" rx="3.4" ry="2" fill="#ECE7DD" />
      <circle {...st(3)} cx="12" cy="4.2" r="1.5" fill="#E8A93B" />
    </svg>
  );
}
