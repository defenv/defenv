#!/usr/bin/env -S deno run -A
// defenv CLI — same core as the web UI, zero external dependencies.
// Everything is scoped to a space (override the active one with --space).

import { Store, NotFoundError, ConflictError } from "./src/core/store.ts";
import { envFileFor, generateProject, renderEnv } from "./src/core/generate.ts";
import { startServer } from "./src/server/server.ts";

// ---- tiny arg parser (no deps) ----
const BOOLS = new Set(["secret", "print", "help", "h", "ungroup", "skip-comments"]);
const MULTI = new Set(["group", "var"]);
interface Args { _: string[]; [k: string]: unknown; }
function parse(argv: string[]): Args {
  const a: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      if (BOOLS.has(key)) { a[key] = true; continue; }
      const val = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : "";
      if (MULTI.has(key)) { (a[key] ??= [] as string[]); (a[key] as string[]).push(val); }
      else a[key] = val;
    } else if (tok.startsWith("-") && tok.length === 2) {
      a[{ h: "help" }[tok[1]] ?? tok[1]] = true;
    } else a._.push(tok);
  }
  return a;
}
const args = parse(Deno.args);
if (args.h) args.help = true;
const [cmd, sub, ...rest] = args._;
const groupArgs = (args.group as string[] | undefined) ?? [];
const varArgs = (args.var as string[] | undefined) ?? [];
const str = (k: string) => (typeof args[k] === "string" ? args[k] as string : undefined);

// ---- minimal color ----
const c = (n: number) => (s: string) => `\x1b[${n}m${s}\x1b[0m`;
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), cyan = c(36);

function fail(msg: string): never { console.error(red(`error: ${msg}`)); Deno.exit(1); }
const need = (v: string | undefined, usage: string): string => (v != null && v !== "" ? v : fail(`usage: ${usage}`));
const mask = (v: string) => (v.length <= 4 ? "****" : v.slice(0, 2) + "…" + v.slice(-2));

async function withStore<T>(fn: (s: Store) => Promise<T> | T): Promise<T> {
  const s = await Store.open();
  try { return await fn(s); }
  catch (e) { if (e instanceof NotFoundError || e instanceof ConflictError) fail((e as Error).message); throw e; }
}
// resolve the space to operate in: --space NAME, else the active one
const spaceIdOf = (s: Store): string => (str("space") ? s.getSpace(str("space")!).id : s.activeSpaceId());

function help() {
  console.log(`${bold("defenv")} — space-scoped env vars: group, compose schemas, generate .env files

${bold("SPACES")}   (a top-level scope, e.g. a microservice)
  defenv space add NAME | use NAME | rename OLD NEW | rm NAME | ls
  defenv space export [NAME] [--out FILE]   |   defenv space import FILE

Everything below operates on the active space (override with --space NAME).

${bold("VARIABLES")}   (KEY is unique within a (space, group) scope)
  defenv var add KEY [VALUE] [--group G] [--secret] [--desc D]
  defenv var set KEY VALUE | rm KEY | ls [--group G]
  defenv var mv KEY (--group G | --ungroup)

${bold("GROUPS")}
  defenv group add NAME [--desc D] | rename OLD NEW | rm NAME | ls

${bold("SCHEMAS")}     (a schema = chosen groups + loose vars)
  defenv schema add NAME [--group A --group B ...] [--var K --var L ...]
  defenv schema add-group NAME GROUP | rm-group NAME GROUP
  defenv schema add-var NAME KEY    | rm-var NAME KEY
  defenv schema show NAME | ls | rm NAME

${bold("PROJECTS")}    (link a path to a schema, then generate)
  defenv project add NAME --path P --schema S
  defenv project set NAME [--path P] [--schema S] | rm NAME | ls
  defenv project gen NAME

${bold("LOAD / GENERATE")}
  defenv import FILE [--group G] [--skip-comments]
  defenv gen SCHEMA [--out FILE | --print]

${bold("MISC")}
  defenv ui [--port 8765]   ·   defenv where`);
}

async function spaces() {
  await withStore(async (s) => {
    if (sub === "add") { const c2 = s.addSpace({ name: need(rest[0], "space add NAME"), description: str("desc") }); s.setActiveSpace(c2.id); await s.save(); console.log(green(`+ space ${c2.name} (now active)`)); }
    else if (sub === "use") { const c2 = s.setActiveSpace(need(rest[0], "space use NAME")); await s.save(); console.log(green(`active space: ${c2.name}`)); }
    else if (sub === "rename") { s.updateSpace(need(rest[0], "space rename OLD NEW"), { name: need(rest[1], "space rename OLD NEW") }); await s.save(); console.log(green("renamed")); }
    else if (sub === "rm") { s.removeSpace(need(rest[0], "space rm NAME")); await s.save(); console.log(green("removed (with everything in it)")); }
    else if (sub === "export") { const ref = rest[0] ? s.getSpace(rest[0]).id : s.activeSpaceId(); const data = s.exportSpace(ref); const out = str("out"); if (out) { await Deno.writeTextFile(out, JSON.stringify(data, null, 2)); console.log(green(`wrote ${out}`)); } else console.log(JSON.stringify(data, null, 2)); }
    else if (sub === "import") { const payload = JSON.parse(await Deno.readTextFile(need(rest[0], "space import FILE"))); const sp = s.importSpace(payload); s.setActiveSpace(sp.id); await s.save(); console.log(green(`+ space ${sp.name} (imported, now active)`)); }
    else { const active = s.activeSpaceId(); for (const ct of s.spacesSorted()) console.log(`${ct.id === active ? green("● ") : "  "}${bold(ct.name)}  ${dim(`${s.groupsIn(ct.id).length} groups, ${s.variablesIn(ct.id).length} vars, ${s.schemasIn(ct.id).length} schemas, ${s.projectsIn(ct.id).length} projects`)}`); }
  });
}

async function groups() {
  await withStore(async (s) => {
    const cid = spaceIdOf(s);
    if (sub === "add") { s.addGroup({ spaceId: cid, name: need(rest[0], "group add NAME"), description: str("desc") }); await s.save(); console.log(green(`+ group ${rest[0]}`)); }
    else if (sub === "rename") { const g = s.findGroup(cid, need(rest[0], "group rename OLD NEW")); if (!g) fail(`no group "${rest[0]}"`); s.updateGroup(g.id, { name: need(rest[1], "group rename OLD NEW") }); await s.save(); console.log(green("renamed")); }
    else if (sub === "rm") { const g = s.findGroup(cid, need(rest[0], "group rm NAME")); if (!g) fail(`no group "${rest[0]}"`); s.removeGroup(g.id); await s.save(); console.log(green("removed (vars ungrouped)")); }
    else { for (const g of s.groupsIn(cid)) console.log(`${bold(g.name)}  ${dim(`${s.variablesInGroup(cid, g.id).length} vars`)}`); const loose = s.variablesInGroup(cid, null); if (loose.length) console.log(dim(`(ungrouped: ${loose.length})`)); }
  });
}

async function vars() {
  await withStore(async (s) => {
    const cid = spaceIdOf(s);
    const findVar = (ref: string) => { const v = s.findVariable(cid, ref); if (!v) fail(`no variable "${ref}"`); return v; };
    if (sub === "add") {
      const key = need(rest[0], "var add KEY [VALUE]");
      const group = groupArgs[0] ? s.findGroup(cid, groupArgs[0]) : null;
      if (groupArgs[0] && !group) fail(`no group "${groupArgs[0]}"`);
      s.addVariable({ spaceId: cid, key, value: rest[1] ?? "", groupId: group?.id ?? null, secret: !!args.secret, description: str("desc") });
      await s.save(); console.log(green(`+ ${key}`));
    } else if (sub === "set") { const v = findVar(need(rest[0], "var set KEY VALUE")); s.updateVariable(v.id, { value: need(rest[1], "var set KEY VALUE") }); await s.save(); console.log(green(`set ${v.key}`)); }
    else if (sub === "mv") {
      const v = findVar(need(rest[0], "var mv KEY"));
      const gid = args.ungroup ? null : (s.findGroup(cid, need(groupArgs[0], "var mv KEY --group G"))?.id ?? fail(`no group "${groupArgs[0]}"`));
      s.moveVariable(v.id, gid, null); await s.save(); console.log(green(`moved ${v.key}`));
    } else if (sub === "rm") { s.removeVariable(findVar(need(rest[0], "var rm KEY")).id); await s.save(); console.log(green("removed")); }
    else {
      const only = groupArgs[0] ? (s.findGroup(cid, groupArgs[0])?.id ?? fail(`no group "${groupArgs[0]}"`)) : undefined;
      let any = false;
      for (const g of s.groupsIn(cid)) {
        if (only !== undefined && g.id !== only) continue;
        const gv = s.variablesInGroup(cid, g.id); if (!gv.length) continue;
        any = true; console.log(cyan(`# ${g.name}`));
        for (const v of gv) console.log(`  ${bold(v.key.padEnd(24))} ${v.secret ? yellow(mask(v.value)) : v.value}`);
      }
      if (only === undefined) { const loose = s.variablesInGroup(cid, null); if (loose.length) { any = true; console.log(dim("# ungrouped")); for (const v of loose) console.log(`  ${bold(v.key.padEnd(24))} ${v.secret ? yellow(mask(v.value)) : v.value}`); } }
      if (!any) console.log(dim("(no variables)"));
    }
  });
}

async function schemas() {
  await withStore(async (s) => {
    const cid = spaceIdOf(s);
    const findSc = (ref: string) => { const sc = s.findSchema(cid, ref); if (!sc) fail(`no schema "${ref}"`); return sc; };
    const findGr = (ref: string) => { const g = s.findGroup(cid, ref); if (!g) fail(`no group "${ref}"`); return g; };
    const findV = (ref: string) => { const v = s.findVariable(cid, ref); if (!v) fail(`no variable "${ref}"`); return v; };
    if (sub === "add") {
      const name = need(rest[0], "schema add NAME");
      s.addSchema({ spaceId: cid, name, description: str("desc"), groupIds: groupArgs.map((g) => findGr(g).id), variableIds: varArgs.map((k) => findV(k).id) });
      await s.save(); console.log(green(`+ schema ${name}`));
    } else if (sub === "add-group") { s.toggleSchemaGroup(findSc(need(rest[0], "schema add-group NAME GROUP")).id, findGr(need(rest[1], "schema add-group NAME GROUP")).id, true); await s.save(); console.log(green("added")); }
    else if (sub === "rm-group") { s.toggleSchemaGroup(findSc(need(rest[0], "schema rm-group NAME GROUP")).id, findGr(need(rest[1], "schema rm-group NAME GROUP")).id, false); await s.save(); console.log(green("removed")); }
    else if (sub === "add-var") { s.toggleSchemaVariable(findSc(need(rest[0], "schema add-var NAME KEY")).id, findV(need(rest[1], "schema add-var NAME KEY")).id, true); await s.save(); console.log(green("added")); }
    else if (sub === "rm-var") { s.toggleSchemaVariable(findSc(need(rest[0], "schema rm-var NAME KEY")).id, findV(need(rest[1], "schema rm-var NAME KEY")).id, false); await s.save(); console.log(green("removed")); }
    else if (sub === "rm") { s.removeSchema(findSc(need(rest[0], "schema rm NAME")).id); await s.save(); console.log(green("removed")); }
    else if (sub === "show") {
      const sc = findSc(need(rest[0], "schema show NAME"));
      console.log(bold(sc.name));
      console.log(dim("groups: ") + (sc.groupIds.map((id) => { try { return s.groupById(id).name; } catch { return "?"; } }).join(", ") || "(none)"));
      console.log(dim("vars:   ") + (sc.variableIds.map((id) => { try { return s.variableById(id).key; } catch { return "?"; } }).join(", ") || "(none)"));
    } else { for (const sc of s.schemasIn(cid)) console.log(`${bold(sc.name)}  ${dim(`${sc.groupIds.length} groups, ${sc.variableIds.length} loose vars`)}`); if (!s.schemasIn(cid).length) console.log(dim("(no schemas)")); }
  });
}

async function projects() {
  await withStore(async (s) => {
    const cid = spaceIdOf(s);
    const findP = (ref: string) => { const p = s.findProject(cid, ref); if (!p) fail(`no project "${ref}"`); return p; };
    if (sub === "add") {
      const name = need(rest[0], "project add NAME --path P --schema S");
      const sc = s.findSchema(cid, need(str("schema"), "project add NAME --schema S")); if (!sc) fail(`no schema "${str("schema")}"`);
      s.addProject({ spaceId: cid, name, path: need(str("path"), "project add NAME --path P"), schemaId: sc.id });
      await s.save(); console.log(green(`+ project ${name}`));
    } else if (sub === "set") {
      const p = findP(need(rest[0], "project set NAME"));
      const schemaId = str("schema") ? (s.findSchema(cid, str("schema")!)?.id ?? fail(`no schema "${str("schema")}"`)) : undefined;
      s.updateProject(p.id, { path: str("path"), schemaId }); await s.save(); console.log(green("updated"));
    } else if (sub === "rm") { s.removeProject(findP(need(rest[0], "project rm NAME")).id); await s.save(); console.log(green("removed")); }
    else if (sub === "gen") { const res = await generateProject(s, findP(need(rest[0], "project gen NAME")).id); console.log(green(`wrote ${res.path}`), dim(`(${res.count} vars)`)); }
    else { for (const p of s.projectsIn(cid)) { let sn = "(no schema)"; try { sn = s.schemaById(p.schemaId).name; } catch { /* */ } console.log(`${bold(p.name)}  ${dim(p.path)}  ${cyan("→ " + sn)}`); } if (!s.projectsIn(cid).length) console.log(dim("(no projects)")); }
  });
}

async function importEnv() {
  const file = need(sub, "import FILE");
  await withStore(async (s) => {
    const cid = spaceIdOf(s);
    const group = groupArgs[0] ? s.findGroup(cid, groupArgs[0]) : null;
    if (groupArgs[0] && !group) fail(`no group "${groupArgs[0]}"`);
    const rep = s.importEnv(cid, await Deno.readTextFile(file), { groupId: group?.id ?? null, skipComments: !!args["skip-comments"] });
    await s.save();
    console.log(green(`imported: ${rep.created.length} new, ${rep.updated.length} updated`));
    if (rep.created.length) console.log(dim("  new: " + rep.created.join(", ")));
  });
}

async function gen() {
  await withStore(async (s) => {
    const cid = spaceIdOf(s);
    const schema = s.findSchema(cid, need(sub, "gen SCHEMA")); if (!schema) fail(`no schema "${sub}"`);
    const res = renderEnv(s, schema);
    if (str("out")) { const path = envFileFor(str("out")!); await Deno.writeTextFile(path, res.content); console.log(green(`wrote ${path}`), dim(`(${res.count} vars)`)); }
    else console.log(res.content);
  });
}

async function ui() {
  const port = Number(str("port") ?? "8765") || 8765;
  await startServer(port).finished;
}

if (args.help || !cmd || cmd === "help") help();
else if (cmd === "space" || cmd === "spaces") await spaces();
else if (cmd === "group" || cmd === "groups") await groups();
else if (cmd === "var" || cmd === "vars") await vars();
else if (cmd === "schema" || cmd === "schemas") await schemas();
else if (cmd === "project" || cmd === "projects") await projects();
else if (cmd === "import") await importEnv();
else if (cmd === "gen" || cmd === "generate") await gen();
else if (cmd === "ui") await ui();
else if (cmd === "where") await withStore((s) => console.log(s.path));
else fail(`unknown command "${cmd}" — run \`defenv help\``);
