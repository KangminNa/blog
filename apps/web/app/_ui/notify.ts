'use client';

import { createContext, useContext } from 'react';

/** 콘솔 아래쪽의 한 줄 알림을 띄우는 길. 콘솔 틀(AdminShell)이 채우고, 틀 밖에서는 아무 일도 하지 않는다 */
export const NotifyContext = createContext<(text: string) => void>(() => {});

/** 콘솔 아래쪽의 한 줄 알림 */
export function useNotify(): (text: string) => void {
  return useContext(NotifyContext);
}
