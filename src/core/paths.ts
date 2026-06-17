// Where defenv keeps its data and installed binary on this machine.
//   ~/.defenv/        (hidden home; override with $DEFENV_HOME)
//     db.json
//     bin/defenv

import { join } from "./pathutil.ts";

function home(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
}
export function configDir(): string {
  return Deno.env.get("DEFENV_HOME") ?? join(home(), ".defenv");
}
export function dbPath(): string {
  return join(configDir(), "db.json");
}
export function binDir(): string {
  return join(configDir(), "bin");
}
