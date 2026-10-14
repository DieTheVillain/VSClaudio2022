import type { HostToWebview, WebviewCommand } from '../../protocol/src/index';
import { createMockHost } from './mockHost';

export interface HostApi {
  post(cmd: WebviewCommand): void;
  subscribe(fn: (msg: HostToWebview) => void): () => void;
}

export function getHost(): HostApi {
  const webview = (window as any).chrome?.webview;
  if (!webview) return createMockHost();
  return {
    post: (cmd) => webview.postMessage(JSON.stringify(cmd)),
    subscribe: (fn) => {
      // The host posts with PostWebMessageAsJson, so data arrives already parsed.
      const handler = (e: MessageEvent) => fn(typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
      webview.addEventListener('message', handler);
      return () => webview.removeEventListener('message', handler);
    },
  };
}
