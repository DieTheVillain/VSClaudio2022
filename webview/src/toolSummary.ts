const MAX = 120;

const FILE_TOOLS = new Set(['Read', 'NotebookRead', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// These tools return the file itself, so a one-line preview of it says nothing useful.
const NO_PREVIEW = new Set(['Read', 'NotebookRead']);

function shorten(value: string): string {
  return value.length > MAX ? value.slice(0, MAX - 1) + '…' : value;
}

export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
  const file = str('file_path') ?? str('notebook_path');

  // Paths are shown in full and wrap in the panel; truncating them hides the part that matters.
  if (FILE_TOOLS.has(name) && file) return file;
  switch (name) {
    case 'Glob':
    case 'Grep': {
      const pattern = str('pattern');
      if (pattern !== undefined) return `pattern: "${shorten(pattern)}"`;
      break;
    }
    case 'WebSearch': {
      const query = str('query');
      if (query !== undefined) return `query: "${shorten(query)}"`;
      break;
    }
  }
  if (file) return file;
  return shorten(str('command') ?? str('url') ?? str('pattern') ?? str('query') ?? str('description') ?? str('path') ?? '');
}

/** The first non-empty line of a tool's result, for the collapsed row. */
export function resultPreview(name: string, result: string | undefined): string | undefined {
  if (result === undefined || NO_PREVIEW.has(name)) return undefined;
  const line = result.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  return line === undefined ? undefined : shorten(line);
}
