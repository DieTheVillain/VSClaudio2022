export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export interface EditPreview { path: string; original: string; proposed: string; isNewFile: boolean; tooLarge: boolean }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

// split/join rather than String.replace so "$&" and friends in new_string stay literal.
const replaceAll = (text: string, from: string, to: string): string => text.split(from).join(to);

function applyEdit(original: string, oldStr: string, newStr: string, all: boolean): string | null {
  if (oldStr === '') return null;
  const attempt = (o: string, n: string): string | null => {
    const count = countOf(original, o);
    if (count === 0 || (count > 1 && !all)) return null;
    return replaceAll(original, o, n);
  };
  const direct = attempt(oldStr, newStr);
  if (direct !== null) return direct;
  // Claude emits LF; on CRLF files retry with CRLF so the edit applies and line endings are kept.
  if (original.includes('\r\n') && !countOf(original, oldStr)) {
    return attempt(oldStr.replace(/\r?\n/g, '\r\n'), newStr.replace(/\r?\n/g, '\r\n'));
  }
  return null;
}

/** readFile returns null when the file does not exist. Returns null when the tool is not previewable or the edit cannot be applied. */
export function previewEdit(toolName: string, input: unknown, readFile: (path: string) => string | null): EditPreview | null {
  if (typeof input !== 'object' || input === null) return null;
  const i = input as Record<string, unknown>;
  const path = str(i.file_path);
  if (path === null) return null;

  const existing = readFile(path);
  let original: string;
  let proposed: string;
  let isNewFile = false;

  if (toolName === 'Edit') {
    const oldStr = str(i.old_string);
    const newStr = str(i.new_string);
    if (oldStr === null || newStr === null || existing === null) return null;
    const applied = applyEdit(existing, oldStr, newStr, i.replace_all === true);
    if (applied === null) return null;
    original = existing;
    proposed = applied;
  } else if (toolName === 'Write') {
    const content = str(i.content);
    if (content === null) return null;
    original = existing ?? '';
    proposed = content;
    isNewFile = existing === null;
  } else {
    return null;
  }

  if (Buffer.byteLength(original) > MAX_PREVIEW_BYTES || Buffer.byteLength(proposed) > MAX_PREVIEW_BYTES) {
    return { path, original: '', proposed: '', isNewFile, tooLarge: true };
  }
  return { path, original, proposed, isNewFile, tooLarge: false };
}
