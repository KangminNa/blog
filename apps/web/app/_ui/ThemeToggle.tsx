'use client';

import { useEffect, useState } from 'react';

// 화이트·블랙 전환. 고른 값은 이 브라우저에만 남고, 고르지 않으면 기기 설정을 따른다.
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const mode = getComputedStyle(document.documentElement).getPropertyValue('--mode');
    setDark(mode.trim() === 'dark');
  }, []);

  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cairn-theme', next);
    } catch {
      // 저장이 막힌 브라우저에서는 지금 화면에만 적용한다
    }
    setDark(!dark);
  }

  return (
    <button type="button" className="ghost" onClick={toggle} disabled={dark === null}>
      {dark ? '화이트' : '블랙'}
    </button>
  );
}
