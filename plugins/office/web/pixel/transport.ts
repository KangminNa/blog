// Pixel Agents의 core/src/transport.ts. 화면이 메시지를 받는 자리이고, Cairn에서는 cairn-feed.ts가 이 자리에 들어간다.
// 화면이 서버로 보내는 메시지(ClientMessage)는 쓰지 않아서 send는 인자가 없다.
import type { ServerMessage } from './messages';

/** Connection lifecycle states reported by a MessageTransport. */
export type TransportState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Transport-agnostic message layer between webview and extension/server. */
export interface MessageTransport {
  /** Send a message to the extension/server. */
  send(): void;
  /** Subscribe to messages from the extension/server. Returns unsubscribe function. */
  onMessage(handler: (message: ServerMessage) => void): () => void;
  /** Resolves once the transport has connected for the first time. */
  readonly ready: Promise<void>;
  /** Current connection state (valid from construction). */
  readonly state: TransportState;
  /** Subscribe to connection-state changes. Returns unsubscribe function. */
  onStateChange(handler: (state: TransportState) => void): () => void;
  /** Clean up resources (WebSocket close, etc.). */
  dispose(): void;
}
