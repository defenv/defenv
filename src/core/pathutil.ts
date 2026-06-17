// Minimal path helpers so the whole tool has zero external dependencies.
// Deno accepts forward slashes on every OS, so we normalize to "/".

export function isAbsolute(p: string): boolean {
  return /^[/\\]/.test(p) || /^[A-Za-z]:[/\\]/.test(p);
}

export function join(...parts: string[]): string {
  const joined = parts.filter((p) => p && p.length).join("/");
  return joined.replace(/(?<!^)\/{2,}/g, "/");
}

export function dirname(p: string): string {
  const norm = p.replace(/[/\\]+$/, "");
  const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  if (i < 0) return ".";
  if (i === 0) return "/";
  return norm.slice(0, i);
}
