// Zero-dependency Deno HTTP server: serves the embedded UI and the JSON API.
// Uses only built-in Deno APIs, so `deno run -A` needs no network and no build.

import { Store, NotFoundError, ConflictError } from "../core/store.ts";
import { renderEnv, generateProject } from "../core/generate.ts";
import { ASSETS } from "./assets.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function handle(fn: (s: Store) => Promise<unknown> | unknown, mutating = true): Promise<Response> {
  try {
    const s = await Store.open();
    const result = await fn(s);
    if (mutating) await s.save();
    return json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return json({ error: (e as Error).message }, 404);
    if (e instanceof ConflictError) return json({ error: (e as Error).message }, 409);
    return json({ error: (e as Error).message }, 500);
  }
}

async function api(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const id = () => url.searchParams.get("id") ?? "";

  if (path === "/api/state") return handle((s) => s.data, false);

  if (path === "/api/spaces") {
    if (req.method === "POST") { const b = await body(); return handle((s) => s.addSpace({ name: b.name, description: b.description })); }
    if (req.method === "PATCH") { const b = await body(); return handle((s) => b.activate ? s.setActiveSpace(b.id) : s.updateSpace(b.id, { name: b.name, description: b.description, order: b.order })); }
    if (req.method === "DELETE") return handle((s) => { s.removeSpace(id()); return { ok: true }; });
  }
  if (path === "/api/spaces/export") return handle((s) => s.exportSpace(id()), false);
  if (path === "/api/spaces/import" && req.method === "POST") { const b = await body(); return handle((s) => s.importSpace(b.payload ?? b)); }
  if (path === "/api/groups") {
    if (req.method === "POST") { const b = await body(); return handle((s) => s.addGroup({ spaceId: b.spaceId, name: b.name, description: b.description })); }
    if (req.method === "PATCH") { const b = await body(); return handle((s) => s.updateGroup(b.id, { name: b.name, description: b.description, collapsed: b.collapsed, order: b.order })); }
    if (req.method === "DELETE") return handle((s) => { s.removeGroup(id()); return { ok: true }; });
  }
  if (path === "/api/variables") {
    if (req.method === "POST") { const b = await body(); return handle((s) => s.addVariable({ spaceId: b.spaceId, key: b.key, value: b.value ?? "", groupId: b.groupId ?? null, secret: !!b.secret, description: b.description, quoted: b.quoted })); }
    if (req.method === "PATCH") { const b = await body(); return handle((s) => b.action === "move" ? s.moveVariable(b.id, b.groupId ?? null, b.beforeId ?? null) : s.updateVariable(b.id, { key: b.newKey, value: b.value, secret: b.secret, description: b.description, quoted: b.quoted })); }
    if (req.method === "DELETE") return handle((s) => { s.removeVariable(id()); return { ok: true }; });
  }
  if (path === "/api/schemas") {
    if (req.method === "POST") { const b = await body(); return handle((s) => s.addSchema({ spaceId: b.spaceId, name: b.name, description: b.description, groupIds: b.groupIds ?? [], variableIds: b.variableIds ?? [] })); }
    if (req.method === "PATCH") { const b = await body(); return handle((s) => b.action === "toggleGroup" ? s.toggleSchemaGroup(b.id, b.groupId, b.on) : b.action === "toggleVariable" ? s.toggleSchemaVariable(b.id, b.variableId, b.on) : s.updateSchema(b.id, { name: b.name, description: b.description, groupIds: b.groupIds, variableIds: b.variableIds, required: b.required })); }
    if (req.method === "DELETE") return handle((s) => { s.removeSchema(id()); return { ok: true }; });
  }
  if (path === "/api/projects") {
    if (req.method === "POST") { const b = await body(); return handle((s) => s.addProject({ spaceId: b.spaceId, name: b.name, path: b.path, schemaId: b.schemaId })); }
    if (req.method === "PATCH") { const b = await body(); return handle((s) => s.updateProject(b.id, { name: b.name, path: b.path, schemaId: b.schemaId })); }
    if (req.method === "DELETE") return handle((s) => { s.removeProject(id()); return { ok: true }; });
  }
  if (path === "/api/import" && req.method === "POST") { const b = await body(); return handle((s) => s.importEnv(b.spaceId, b.text ?? "", { groupId: b.groupId ?? null, skipComments: !!b.skipComments })); }
  if (path === "/api/generate" && req.method === "POST") {
    const b = await body();
    return handle(async (s) => {
      if (b.projectId) {
        if (b.write) return await generateProject(s, b.projectId);
        const project = s.projectById(b.projectId);
        return { ...renderEnv(s, s.schemaById(project.schemaId)), path: project.path };
      }
      return renderEnv(s, s.schemaById(b.schemaId));
    }, false);
  }
  return json({ error: "not found" }, 404);
}

function asset(pathname: string): Response | null {
  const key = pathname === "/" ? "/" : pathname;
  const content = ASSETS[key];
  if (content === undefined) return null;
  const type = key.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
  return new Response(content, { headers: { "content-type": type } });
}

export function startServer(port: number): Deno.HttpServer {
  return Deno.serve({ port, onListen: ({ port }) => console.log(`defenv UI → http://localhost:${port}`) }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return await api(req, url);
    return asset(url.pathname) ?? new Response("Not found", { status: 404 });
  });
}

if (import.meta.main) {
  startServer(Number(Deno.env.get("PORT") ?? 8765));
}
