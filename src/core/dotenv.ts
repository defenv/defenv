// Parse and serialize .env text, with correct double-quote handling.
//
// Round-trip contract: the value stored in the database is always the RAW,
// decoded string (no surrounding quotes, no escape sequences). Quoting and
// escaping happen only at serialize time; unquoting/decoding only at parse time.

// Characters that never need quoting when written out (covers typical URLs,
// connection strings, paths). Anything else (spaces, '#', quotes, backslash,
// parentheses, control chars, ...) forces a double-quoted, escaped value.
const SAFE = /^[A-Za-z0-9_.\-/:@+=?&,%~]*$/;

/** Quote/escape a value following common dotenv conventions. */
export function serializeValue(value: string, forceQuote = false): string {
  if (!forceQuote) {
    if (value === "") return "";
    if (SAFE.test(value)) return value;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Decode the right-hand side of a KEY=VALUE line into its raw string. */
function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    // double-quoted: process escapes in a single left-to-right pass
    return v.slice(1, -1).replace(/\\([nrt"\\])/g, (_m, c) =>
      ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" } as Record<string, string>)[c]
    );
  }
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
    // single-quoted: literal, no escape processing
    return v.slice(1, -1);
  }
  // unquoted: strip a trailing " # comment" only when not quoted
  const hash = v.indexOf(" #");
  return (hash !== -1 ? v.slice(0, hash) : v).trim();
}

const KEY_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvEntry {
  key: string;
  value: string;
  description?: string;
  quoted?: boolean; // the source wrapped this value in quotes
}

/**
 * Parse a .env body into ordered entries. A comment line (or contiguous block)
 * immediately above a KEY=VALUE is captured as that entry's description, unless
 * `skipComments` is set, in which case all comments are ignored.
 */
export function parseEnvEntries(text: string, opts: { skipComments?: boolean } = {}): EnvEntry[] {
  const out: EnvEntry[] = [];
  let comment: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "") { comment = null; continue; }
    if (trimmed.startsWith("#")) {
      if (!opts.skipComments) {
        const c = trimmed.replace(/^#+\s?/, "").trim();
        if (c) comment = comment ? `${comment} ${c}` : c;
      }
      continue;
    }
    let line = trimmed;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq === -1) { comment = null; continue; }
    const key = line.slice(0, eq).trim();
    if (!KEY_OK.test(key)) { comment = null; continue; }
    const rawVal = line.slice(eq + 1).trim();
    const quoted = rawVal.length >= 2 &&
      ((rawVal[0] === '"' && rawVal[rawVal.length - 1] === '"') ||
       (rawVal[0] === "'" && rawVal[rawVal.length - 1] === "'"));
    out.push({ key, value: unquote(rawVal), description: comment ?? undefined, quoted: quoted || undefined });
    comment = null;
  }
  return out;
}

/** Parse a .env body into a flat KEY -> value map (values fully decoded). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of parseEnvEntries(text, { skipComments: true })) out[e.key] = e.value;
  return out;
}
