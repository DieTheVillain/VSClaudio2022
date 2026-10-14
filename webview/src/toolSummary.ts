const MAX = 120;

export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
  const file = str('file_path') ?? str('notebook_path');
  const value = file ? file.split(/[\\/]/).pop()! : str('pattern') ?? str('command') ?? str('url') ?? str('query') ?? str('description') ?? str('path') ?? '';
  return value.length > MAX ? value.slice(0, MAX - 1) + '…' : value;
}
