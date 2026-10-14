import type { SidecarEvent } from '../../protocol/src/index';

export const MAX_TOOL_RESULT_CHARS = 20_000;

export function flatten(content: unknown): { text: string; truncated: boolean } {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : c?.type === 'image' ? '[image]' : ''))
      .join('\n');
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) return { text: text.slice(0, MAX_TOOL_RESULT_CHARS), truncated: true };
  return { text, truncated: false };
}

export function isLoginError(text: string): boolean {
  return /\/login|log ?in|logged in|authenticat|unauthori[sz]ed|api key/i.test(text);
}

export class Translator {
  private streamed = new Set<string>();
  private currentMessageId: string | null = null;
  private interruptRequested = false;

  markInterrupt(): void {
    this.interruptRequested = true;
  }

  translate(msg: any): SidecarEvent[] {
    if (!msg || msg.parent_tool_use_id) return [];
    switch (msg.type) {
      case 'system':
        return msg.subtype === 'init' ? [{ t: 'session', sessionId: msg.session_id, model: msg.model, cwd: msg.cwd }] : [];
      case 'stream_event':
        return this.stream(msg.event);
      case 'assistant':
        return this.assistant(msg.message);
      case 'user':
        return this.user(msg.message);
      case 'result':
        return this.result(msg);
      default:
        return [];
    }
  }

  private stream(ev: any): SidecarEvent[] {
    switch (ev?.type) {
      case 'message_start':
        this.currentMessageId = ev.message.id;
        this.streamed.add(ev.message.id);
        return [];
      case 'content_block_start': {
        const key = `${this.currentMessageId}:${ev.index}`;
        const b = ev.content_block;
        if (b.type === 'text' || b.type === 'thinking') return [{ t: 'block_start', key, kind: b.type }];
        if (b.type === 'tool_use') return [{ t: 'block_start', key, kind: 'tool_use', toolUseId: b.id, name: b.name }];
        return [];
      }
      case 'content_block_delta': {
        const key = `${this.currentMessageId}:${ev.index}`;
        const d = ev.delta;
        if (d.type === 'text_delta') return [{ t: 'block_delta', key, text: d.text }];
        if (d.type === 'thinking_delta') return [{ t: 'block_delta', key, text: d.thinking }];
        return [];
      }
      default:
        return [];
    }
  }

  private assistant(m: any): SidecarEvent[] {
    const out: SidecarEvent[] = [];
    const wasStreamed = this.streamed.has(m?.id);
    (m?.content ?? []).forEach((b: any, i: number) => {
      if (b.type === 'tool_use') {
        if (!wasStreamed) out.push({ t: 'block_start', key: `${m.id}:tool:${b.id}`, kind: 'tool_use', toolUseId: b.id, name: b.name });
        out.push({ t: 'tool_input', toolUseId: b.id, name: b.name, input: b.input });
      } else if (!wasStreamed && (b.type === 'text' || b.type === 'thinking')) {
        const key = `${m.id}:full:${i}`;
        out.push({ t: 'block_start', key, kind: b.type }, { t: 'block_delta', key, text: b.type === 'text' ? b.text : b.thinking });
      }
    });
    return out;
  }

  private user(m: any): SidecarEvent[] {
    if (!Array.isArray(m?.content)) return [];
    return m.content
      .filter((b: any) => b.type === 'tool_result')
      .map((b: any) => {
        const { text, truncated } = flatten(b.content);
        return { t: 'tool_result', toolUseId: b.tool_use_id, content: text, isError: !!b.is_error, truncated } as SidecarEvent;
      });
  }

  private result(r: any): SidecarEvent[] {
    const interrupted = this.interruptRequested;
    this.interruptRequested = false;
    if (r.subtype === 'success' && !r.is_error) {
      return [{ t: 'turn_end', status: 'success', durationMs: r.duration_ms, costUsd: r.total_cost_usd }];
    }
    if (interrupted) return [{ t: 'turn_end', status: 'interrupted', durationMs: r.duration_ms }];
    const error = describeError(r);
    const out: SidecarEvent[] = [{ t: 'turn_end', status: 'error', error, durationMs: r.duration_ms }];
    if (isLoginError(error)) out.push({ t: 'error', code: 'not_logged_in', message: error });
    return out;
  }
}

function describeError(r: any): string {
  if (Array.isArray(r.errors) && r.errors.length) return r.errors.join('\n');
  if (typeof r.result === 'string' && r.result) return r.result;
  return `Turn failed (${r.subtype})`;
}
