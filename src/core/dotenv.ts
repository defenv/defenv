// Parse and serialize .env text, preserving each value's QUOTE STYLE so that
// imports round-trip exactly:
//
//   • double-quoted  "x"   -> escaped on the way in, escaped again on the way out
//   • single-quoted  'x'   -> literal in and out (great for JSON: no escaping)
//   • unquoted        x    -> kept raw / unquoted (JSON stays JSON, not escaped)
//
// The value stored in the database is always the RAW, decoded string. The quote
// style is remembered separately and applied only at serialize time.

export type QuoteStyle = "single" | "double" | "none";

// Characters safe to write unquoted when no explicit style is set (auto mode).
const SAFE = /^[A-Za-z0-9_.\-/:@+=?&,%~]*$/;

function escapeDouble(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Serialize a value for a .env line, honoring an explicit quote style:
 *   - "single": wrap in single quotes, literal (no escaping)
 *   - "double": wrap in double quotes, with escaping
 *   - "none":   keep raw/unquoted (only protected if it would break the file)
 *   - undefined (auto): unquoted when safe, else double-quoted+escaped
 */
export function serializeValue(value: string, quote?: QuoteStyle): string {
  if (quote === "single") {
    if (!value.includes("'") && !/[\n\r]/.test(value)) return `'${value}'`;
    return `"${escapeDouble(value)}"`; // can't single-quote this; fall back
  }
  if (quote === "double") {
    return `"${escapeDouble(value)}"`;
  }
  if (quote === "none") {
    if (/[\n\r]/.test(value)) return `"${escapeDouble(value)}"`;          // can't be unquoted
    if (value.includes(" #")) return value.includes("'") ? `"${escapeDouble(value)}"` : `'${value}'`; // protect from comment, without escaping
    return value;
  }
  // auto
  if (value === "") return "";
  if (SAFE.test(value)) return value;
  return `"${escapeDouble(value)}"`;
}

/** Decode the right-hand side of a KEY=VALUE line into its raw string. */
function decode(rawVal: string): string {
  const v = rawVal.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\([nrt"\\])/g, (_m, c) =>
      ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" } as Record<string, string>)[c]
    );
  }
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
    return v.slice(1, -1); // literal
  }
  const hash = v.indexOf(" #"); // unquoted: strip a trailing " # comment"
  return (hash !== -1 ? v.slice(0, hash) : v).trim();
}

/** Detect the quote style used for a raw RHS. */
function quoteStyleOf(rawVal: string): QuoteStyle {
  const v = rawVal.trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') return "double";
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return "single";
  return "none";
}

const KEY_OK = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvEntry {
  key: string;
  value: string;
  description?: string;
  quote?: QuoteStyle;
}

/**
 * Parse a .env body into ordered entries. A comment line (or contiguous block)
 * immediately above a KEY=VALUE is captured as that entry's description, unless
 * `skipComments` is set.
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
    const rawVal = line.slice(eq + 1);
    out.push({ key, value: decode(rawVal), quote: quoteStyleOf(rawVal), description: comment ?? undefined });
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
