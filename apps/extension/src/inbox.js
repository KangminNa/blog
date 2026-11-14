// 기다리는 결재 · 질문 수 (MCP inbox) → 확장 아이콘의 배지. 1분마다(background.js의 알람)와 팝업을 열 때 읽는다.

/** 배지 글자: 0이면 비우고, 100 넘으면 99+ */
export function badgeText(total) {
  if (!(total > 0)) return '';
  return total > 99 ? '99+' : String(total);
}

function count(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export class Inbox {
  /**
   * @param {object} deps
   * @param {import('./mcp.js').Mcp} deps.mcp
   * @param {import('./connection.js').Connection} deps.connection
   * @param {(text: string) => Promise<void>} deps.badge
   */
  constructor({ mcp, connection, badge }) {
    this.mcp = mcp;
    this.connection = connection;
    this.badge = badge;
  }

  /** 서버에 묻고 배지를 고친다. 연결이 없으면 배지를 비우고 null */
  async refresh() {
    if (!(await this.connection.connected())) {
      await this.badge('');
      return null;
    }
    let reply;
    try {
      reply = await this.mcp.call('inbox', {});
    } catch (error) {
      if (error.code === 'lost') await this.badge('');
      throw error;
    }
    const counts = { approvals: count(reply.approvals), questions: count(reply.questions) };
    await this.badge(badgeText(counts.approvals + counts.questions));
    return counts;
  }
}
