// JSON-file datastore. open -> mutate -> save (atomic). Single-user local tool.
// Everything is scoped to a Space (e.g. a microservice).

import { dirname } from "./pathutil.ts";
import {
  type Space,
  type SpaceExport,
  type Database,
  type Group,
  type Project,
  type Schema,
  type Variable,
  DB_VERSION,
  emptyDatabase,
} from "./types.ts";
import { parseEnvEntries } from "./dotenv.ts";
import { dbPath } from "./paths.ts";

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/** Bring older database shapes up to the current version. */
function migrate(raw: Record<string, unknown>): Database {
  const version = raw.version as number;
  if (version === DB_VERSION) {
    const db = raw as unknown as Database;
    db.spaces ??= [];
    db.groups ??= [];
    db.variables ??= [];
    db.schemas ??= [];
    db.projects ??= [];
    if (db.spaces.length === 0) {
      const ctx: Space = { id: uid(), name: "default", order: 0, createdAt: now(), updatedAt: now() };
      db.spaces.push(ctx);
      db.activeSpaceId = ctx.id;
    }
    return db;
  }
  // v2 ("contexts") -> v3 ("spaces"): straight rename of the top-level scope.
  if (version === 2) {
    const ren = <T extends Record<string, unknown>>(x: T) => { const { contextId, ...rest } = x as Record<string, unknown>; return { ...rest, spaceId: contextId } as unknown as T; };
    return {
      version: DB_VERSION,
      activeSpaceId: raw.activeContextId as string | undefined,
      spaces: ((raw.contexts as Space[]) ?? []),
      groups: ((raw.groups as Group[]) ?? []).map(ren),
      variables: ((raw.variables as Variable[]) ?? []).map(ren),
      schemas: ((raw.schemas as Schema[]) ?? []).map(ren),
      projects: ((raw.projects as Project[]) ?? []).map(ren),
    };
  }
  // v1 (single global namespace) -> v3: wrap everything in one default space.
  if (version === 1) {
    const ts = now();
    const sp: Space = { id: uid(), name: "default", order: 0, createdAt: ts, updatedAt: ts };
    const stamp = <T extends Record<string, unknown>>(x: T) => ({ ...x, spaceId: sp.id });
    return {
      version: DB_VERSION,
      activeSpaceId: sp.id,
      spaces: [sp],
      groups: ((raw.groups as Group[]) ?? []).map(stamp) as Group[],
      variables: ((raw.variables as Variable[]) ?? []).map(stamp) as Variable[],
      schemas: ((raw.schemas as Schema[]) ?? []).map(stamp) as Schema[],
      projects: ((raw.projects as Project[]) ?? []).map(stamp) as Project[],
    };
  }
  return emptyDatabase();
}

export class Store {
  #path: string;
  #db: Database;

  private constructor(path: string, db: Database) {
    this.#path = path;
    this.#db = db;
  }

  static async open(path: string = dbPath()): Promise<Store> {
    let db: Database;
    let migrated = false;
    let existed = true;
    try {
      const raw = JSON.parse(await Deno.readTextFile(path));
      if (typeof raw.version === "number") {
        migrated = raw.version !== DB_VERSION;
        db = migrate(raw);
      } else {
        db = emptyDatabase();
        existed = false;
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      db = emptyDatabase();
      existed = false;
    }
    const store = new Store(path, db);
    // First run (or an upgraded/seeded db): write it out now so the default
    // space gets a STABLE id, instead of being re-seeded on every read.
    if (!existed || migrated) await store.save();
    return store;
  }

  get data(): Database {
    return this.#db;
  }
  get path(): string {
    return this.#path;
  }

  async save(): Promise<void> {
    await Deno.mkdir(dirname(this.#path), { recursive: true }).catch(() => {});
    this.#db.version = DB_VERSION;
    const tmp = `${this.#path}.${uid()}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(this.#db, null, 2) + "\n");
    await Deno.rename(tmp, this.#path);
  }

  // ----- Spaces ----------------------------------------------------------

  spacesSorted(): Space[] {
    return [...this.#db.spaces].sort((a, b) => a.order - b.order);
  }
  findSpace(ref: string): Space | undefined {
    return this.#db.spaces.find((c) => c.id === ref) ?? this.#db.spaces.find((c) => c.name === ref);
  }
  getSpace(ref: string): Space {
    const c = this.findSpace(ref);
    if (!c) throw new NotFoundError(`No space "${ref}".`);
    return c;
  }
  activeSpaceId(): string {
    const active = this.#db.activeSpaceId && this.findSpace(this.#db.activeSpaceId);
    return (active ?? this.spacesSorted()[0])?.id ?? "";
  }

  addSpace(input: { name: string; description?: string }): Space {
    const name = input.name.trim();
    if (!name) throw new ConflictError("Space name cannot be empty.");
    if (this.findSpace(name)) throw new ConflictError(`A space named "${name}" already exists.`);
    const order = this.#db.spaces.reduce((m, c) => Math.max(m, c.order), -1) + 1;
    const c: Space = { id: uid(), name, description: input.description, order, createdAt: now(), updatedAt: now() };
    this.#db.spaces.push(c);
    this.#db.activeSpaceId ??= c.id;
    return c;
  }
  updateSpace(ref: string, patch: { name?: string; description?: string; order?: number }): Space {
    const c = this.getSpace(ref);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ConflictError("Space name cannot be empty.");
      const clash = this.findSpace(name);
      if (clash && clash.id !== c.id) throw new ConflictError(`A space named "${name}" already exists.`);
      c.name = name;
    }
    if (patch.description !== undefined) c.description = patch.description;
    if (patch.order !== undefined) c.order = patch.order;
    c.updatedAt = now();
    return c;
  }
  setActiveSpace(ref: string): Space {
    const c = this.getSpace(ref);
    this.#db.activeSpaceId = c.id;
    return c;
  }
  removeSpace(ref: string): void {
    const c = this.getSpace(ref);
    if (this.#db.spaces.length <= 1) throw new ConflictError("Cannot remove the only space.");
    this.#db.groups = this.#db.groups.filter((g) => g.spaceId !== c.id);
    this.#db.variables = this.#db.variables.filter((v) => v.spaceId !== c.id);
    this.#db.schemas = this.#db.schemas.filter((s) => s.spaceId !== c.id);
    this.#db.projects = this.#db.projects.filter((p) => p.spaceId !== c.id);
    this.#db.spaces = this.#db.spaces.filter((x) => x.id !== c.id);
    if (this.#db.activeSpaceId === c.id) this.#db.activeSpaceId = this.spacesSorted()[0]?.id;
  }

  // ----- Groups ------------------------------------------------------------

  groupsIn(spaceId: string): Group[] {
    return this.#db.groups.filter((g) => g.spaceId === spaceId).sort((a, b) => a.order - b.order);
  }
  groupById(id: string): Group {
    const g = this.#db.groups.find((x) => x.id === id);
    if (!g) throw new NotFoundError(`No group with id "${id}".`);
    return g;
  }
  findGroup(spaceId: string, ref: string): Group | undefined {
    const inCtx = this.#db.groups.filter((g) => g.spaceId === spaceId);
    return inCtx.find((g) => g.id === ref) ?? inCtx.find((g) => g.name === ref);
  }

  addGroup(input: { spaceId: string; name: string; description?: string }): Group {
    this.getSpace(input.spaceId);
    const name = input.name.trim();
    if (!name) throw new ConflictError("Group name cannot be empty.");
    if (this.findGroup(input.spaceId, name)) throw new ConflictError(`A group named "${name}" already exists in this space.`);
    const order = this.groupsIn(input.spaceId).reduce((m, g) => Math.max(m, g.order), -1) + 1;
    const g: Group = { id: uid(), spaceId: input.spaceId, name, description: input.description, collapsed: false, order, createdAt: now(), updatedAt: now() };
    this.#db.groups.push(g);
    return g;
  }
  updateGroup(id: string, patch: { name?: string; description?: string; collapsed?: boolean; order?: number }): Group {
    const g = this.groupById(id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ConflictError("Group name cannot be empty.");
      const clash = this.findGroup(g.spaceId, name);
      if (clash && clash.id !== g.id) throw new ConflictError(`A group named "${name}" already exists in this space.`);
      g.name = name;
    }
    if (patch.description !== undefined) g.description = patch.description;
    if (patch.collapsed !== undefined) g.collapsed = patch.collapsed;
    if (patch.order !== undefined) g.order = patch.order;
    g.updatedAt = now();
    return g;
  }
  removeGroup(id: string): void {
    const g = this.groupById(id);
    for (const v of this.#db.variables) if (v.groupId === g.id) v.groupId = null;
    for (const s of this.#db.schemas) s.groupIds = s.groupIds.filter((x) => x !== g.id);
    this.#db.groups = this.#db.groups.filter((x) => x.id !== g.id);
  }
  variablesInGroup(spaceId: string, groupId: string | null): Variable[] {
    return this.#db.variables.filter((v) => v.spaceId === spaceId && v.groupId === groupId).sort((a, b) => a.order - b.order);
  }

  // ----- Variables ---------------------------------------------------------

  variablesIn(spaceId: string): Variable[] {
    return this.#db.variables.filter((v) => v.spaceId === spaceId).sort((a, b) => a.order - b.order);
  }
  variableById(id: string): Variable {
    const v = this.#db.variables.find((x) => x.id === id);
    if (!v) throw new NotFoundError(`No variable with id "${id}".`);
    return v;
  }
  findVariable(spaceId: string, ref: string): Variable | undefined {
    const inCtx = this.#db.variables.filter((v) => v.spaceId === spaceId);
    return inCtx.find((v) => v.id === ref) ?? inCtx.find((v) => v.key === ref);
  }
  variableInScope(spaceId: string, groupId: string | null, key: string): Variable | undefined {
    return this.#db.variables.find((v) => v.spaceId === spaceId && v.groupId === groupId && v.key === key);
  }

  addVariable(input: { spaceId: string; key: string; value?: string; groupId?: string | null; secret?: boolean; description?: string; quoted?: boolean }): Variable {
    this.getSpace(input.spaceId);
    const key = input.key.trim();
    if (!KEY_RE.test(key)) throw new ConflictError(`"${key}" is not a valid env var name.`);
    if (input.groupId) {
      const g = this.groupById(input.groupId);
      if (g.spaceId !== input.spaceId) throw new ConflictError("Group belongs to a different space.");
    }
    const groupId = input.groupId ?? null;
    if (this.variableInScope(input.spaceId, groupId, key)) throw new ConflictError(`"${key}" already exists in this group.`);
    const order = this.variablesInGroup(input.spaceId, groupId).reduce((m, v) => Math.max(m, v.order), -1) + 1;
    const v: Variable = {
      id: uid(),
      spaceId: input.spaceId,
      key,
      value: input.value ?? "",
      groupId,
      secret: input.secret ?? false,
      description: input.description,
      quoted: input.quoted || undefined,
      order,
      createdAt: now(),
      updatedAt: now(),
    };
    this.#db.variables.push(v);
    return v;
  }
  updateVariable(id: string, patch: { key?: string; value?: string; secret?: boolean; description?: string; quoted?: boolean }): Variable {
    const v = this.variableById(id);
    if (patch.key !== undefined) {
      const key = patch.key.trim();
      if (!KEY_RE.test(key)) throw new ConflictError(`"${key}" is not a valid env var name.`);
      const clash = this.variableInScope(v.spaceId, v.groupId, key);
      if (clash && clash.id !== v.id) throw new ConflictError(`"${key}" already exists in this group.`);
      v.key = key;
    }
    if (patch.value !== undefined) v.value = patch.value;
    if (patch.secret !== undefined) v.secret = patch.secret;
    if (patch.description !== undefined) v.description = patch.description;
    if (patch.quoted !== undefined) v.quoted = patch.quoted || undefined;
    v.updatedAt = now();
    return v;
  }
  moveVariable(id: string, groupId: string | null, beforeId?: string | null): Variable {
    const v = this.variableById(id);
    if (groupId) {
      const g = this.groupById(groupId);
      if (g.spaceId !== v.spaceId) throw new ConflictError("Group belongs to a different space.");
    }
    const clash = this.variableInScope(v.spaceId, groupId, v.key);
    if (clash && clash.id !== v.id) throw new ConflictError(`"${v.key}" already exists in the destination group.`);
    v.groupId = groupId;
    const siblings = this.variablesInGroup(v.spaceId, groupId).filter((x) => x.id !== v.id);
    let idx = siblings.length;
    if (beforeId) {
      const at = siblings.findIndex((x) => x.id === beforeId);
      if (at !== -1) idx = at;
    }
    [...siblings.slice(0, idx), v, ...siblings.slice(idx)].forEach((x, i) => (x.order = i));
    v.updatedAt = now();
    return v;
  }
  removeVariable(id: string): void {
    const v = this.variableById(id);
    for (const s of this.#db.schemas) s.variableIds = s.variableIds.filter((x) => x !== v.id);
    this.#db.variables = this.#db.variables.filter((x) => x.id !== v.id);
  }

  // ----- Schemas (compositions) -------------------------------------------

  schemasIn(spaceId: string): Schema[] {
    return this.#db.schemas.filter((s) => s.spaceId === spaceId).sort((a, b) => a.order - b.order);
  }
  schemaById(id: string): Schema {
    const s = this.#db.schemas.find((x) => x.id === id);
    if (!s) throw new NotFoundError(`No schema with id "${id}".`);
    return s;
  }
  findSchema(spaceId: string, ref: string): Schema | undefined {
    const inCtx = this.#db.schemas.filter((s) => s.spaceId === spaceId);
    return inCtx.find((s) => s.id === ref) ?? inCtx.find((s) => s.name === ref);
  }

  addSchema(input: { spaceId: string; name: string; description?: string; groupIds?: string[]; variableIds?: string[]; required?: string[] }): Schema {
    this.getSpace(input.spaceId);
    const name = input.name.trim();
    if (!name) throw new ConflictError("Schema name cannot be empty.");
    if (this.findSchema(input.spaceId, name)) throw new ConflictError(`A schema named "${name}" already exists in this space.`);
    for (const id of input.groupIds ?? []) if (this.groupById(id).spaceId !== input.spaceId) throw new ConflictError("Group belongs to a different space.");
    for (const id of input.variableIds ?? []) if (this.variableById(id).spaceId !== input.spaceId) throw new ConflictError("Variable belongs to a different space.");
    const order = this.schemasIn(input.spaceId).reduce((m, s) => Math.max(m, s.order), -1) + 1;
    const s: Schema = { id: uid(), spaceId: input.spaceId, name, description: input.description, groupIds: input.groupIds ?? [], variableIds: input.variableIds ?? [], required: input.required ?? [], order, createdAt: now(), updatedAt: now() };
    this.#db.schemas.push(s);
    return s;
  }
  updateSchema(id: string, patch: { name?: string; description?: string; groupIds?: string[]; variableIds?: string[]; required?: string[] }): Schema {
    const s = this.schemaById(id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ConflictError("Schema name cannot be empty.");
      const clash = this.findSchema(s.spaceId, name);
      if (clash && clash.id !== s.id) throw new ConflictError(`A schema named "${name}" already exists in this space.`);
      s.name = name;
    }
    if (patch.description !== undefined) s.description = patch.description;
    if (patch.groupIds !== undefined) s.groupIds = patch.groupIds;
    if (patch.variableIds !== undefined) s.variableIds = patch.variableIds;
    if (patch.required !== undefined) s.required = patch.required;
    s.updatedAt = now();
    return s;
  }
  toggleSchemaGroup(id: string, groupId: string, on: boolean): Schema {
    const s = this.schemaById(id);
    if (this.groupById(groupId).spaceId !== s.spaceId) throw new ConflictError("Group belongs to a different space.");
    s.groupIds = s.groupIds.filter((x) => x !== groupId);
    if (on) s.groupIds.push(groupId);
    s.updatedAt = now();
    return s;
  }
  toggleSchemaVariable(id: string, variableId: string, on: boolean): Schema {
    const s = this.schemaById(id);
    if (this.variableById(variableId).spaceId !== s.spaceId) throw new ConflictError("Variable belongs to a different space.");
    s.variableIds = s.variableIds.filter((x) => x !== variableId);
    if (on) s.variableIds.push(variableId);
    s.updatedAt = now();
    return s;
  }
  removeSchema(id: string): void {
    const s = this.schemaById(id);
    for (const p of this.#db.projects) if (p.schemaId === s.id) p.schemaId = "";
    this.#db.schemas = this.#db.schemas.filter((x) => x.id !== s.id);
  }

  // ----- Projects ----------------------------------------------------------

  projectsIn(spaceId: string): Project[] {
    return this.#db.projects.filter((p) => p.spaceId === spaceId).sort((a, b) => a.name.localeCompare(b.name));
  }
  projectById(id: string): Project {
    const p = this.#db.projects.find((x) => x.id === id);
    if (!p) throw new NotFoundError(`No project with id "${id}".`);
    return p;
  }
  findProject(spaceId: string, ref: string): Project | undefined {
    const inCtx = this.#db.projects.filter((p) => p.spaceId === spaceId);
    return inCtx.find((p) => p.id === ref) ?? inCtx.find((p) => p.name === ref);
  }

  addProject(input: { spaceId: string; name: string; path: string; schemaId: string }): Project {
    this.getSpace(input.spaceId);
    const name = input.name.trim();
    if (!name) throw new ConflictError("Project name cannot be empty.");
    if (this.findProject(input.spaceId, name)) throw new ConflictError(`A project named "${name}" already exists in this space.`);
    if (!input.path.trim()) throw new ConflictError("Project path cannot be empty.");
    if (this.schemaById(input.schemaId).spaceId !== input.spaceId) throw new ConflictError("Schema belongs to a different space.");
    const p: Project = { id: uid(), spaceId: input.spaceId, name, path: input.path.trim(), schemaId: input.schemaId, createdAt: now(), updatedAt: now() };
    this.#db.projects.push(p);
    return p;
  }
  updateProject(id: string, patch: { name?: string; path?: string; schemaId?: string }): Project {
    const p = this.projectById(id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ConflictError("Project name cannot be empty.");
      const clash = this.findProject(p.spaceId, name);
      if (clash && clash.id !== p.id) throw new ConflictError(`A project named "${name}" already exists in this space.`);
      p.name = name;
    }
    if (patch.path !== undefined) p.path = patch.path.trim();
    if (patch.schemaId !== undefined) { if (this.schemaById(patch.schemaId).spaceId !== p.spaceId) throw new ConflictError("Schema belongs to a different space."); p.schemaId = patch.schemaId; }
    p.updatedAt = now();
    return p;
  }
  removeProject(id: string): void {
    const p = this.projectById(id);
    this.#db.projects = this.#db.projects.filter((x) => x.id !== p.id);
  }

  // ----- Export / Import a whole space ------------------------------------

  /** Bundle one space and everything in it into a portable object. */
  exportSpace(ref: string): SpaceExport {
    const sp = this.getSpace(ref);
    return {
      kind: "defenv.space",
      v: 1,
      exportedAt: now(),
      space: { name: sp.name, description: sp.description },
      groups: this.groupsIn(sp.id),
      variables: this.variablesIn(sp.id),
      schemas: this.schemasIn(sp.id),
      projects: this.projectsIn(sp.id),
    };
  }

  /** Create a new space from an exported bundle, remapping all ids. */
  importSpace(payload: SpaceExport): Space {
    if (!payload || payload.kind !== "defenv.space") throw new ConflictError("Not a defenv space export.");
    const base = (payload.space?.name ?? "imported").trim() || "imported";
    let name = base;
    for (let i = 2; this.findSpace(name); i++) name = `${base} (${i})`;
    const sp = this.addSpace({ name, description: payload.space?.description });

    const gMap = new Map<string, string>();
    for (const g of payload.groups ?? []) {
      const id = uid();
      gMap.set(g.id, id);
      this.#db.groups.push({ id, spaceId: sp.id, name: g.name, description: g.description, collapsed: !!g.collapsed, order: g.order ?? 0, createdAt: now(), updatedAt: now() });
    }
    const vMap = new Map<string, string>();
    for (const v of payload.variables ?? []) {
      const id = uid();
      vMap.set(v.id, id);
      this.#db.variables.push({ id, spaceId: sp.id, key: v.key, value: v.value ?? "", groupId: v.groupId ? (gMap.get(v.groupId) ?? null) : null, secret: !!v.secret, description: v.description, order: v.order ?? 0, createdAt: now(), updatedAt: now() });
    }
    const sMap = new Map<string, string>();
    for (const sc of payload.schemas ?? []) {
      const id = uid();
      sMap.set(sc.id, id);
      this.#db.schemas.push({ id, spaceId: sp.id, name: sc.name, description: sc.description, groupIds: (sc.groupIds ?? []).map((x) => gMap.get(x)).filter((x): x is string => !!x), variableIds: (sc.variableIds ?? []).map((x) => vMap.get(x)).filter((x): x is string => !!x), order: sc.order ?? 0, createdAt: now(), updatedAt: now() });
    }
    for (const pr of payload.projects ?? []) {
      this.#db.projects.push({ id: uid(), spaceId: sp.id, name: pr.name, path: pr.path, schemaId: pr.schemaId ? (sMap.get(pr.schemaId) ?? "") : "", createdAt: now(), updatedAt: now() });
    }
    return sp;
  }

  // ----- Import ------------------------------------------------------------

  importEnv(spaceId: string, text: string, opts: { groupId?: string | null; skipComments?: boolean } = {}): { created: string[]; updated: string[] } {
    this.getSpace(spaceId);
    const scope = opts.groupId ?? null;
    if (scope) this.groupById(scope);
    const created: string[] = [];
    const updated: string[] = [];
    for (const entry of parseEnvEntries(text, { skipComments: opts.skipComments })) {
      const existing = this.variableInScope(spaceId, scope, entry.key);
      if (existing) {
        existing.value = entry.value;
        if (entry.description !== undefined) existing.description = entry.description;
        existing.quoted = entry.quoted || undefined;
        existing.updatedAt = now();
        updated.push(entry.key);
      } else {
        this.addVariable({ spaceId, key: entry.key, value: entry.value, groupId: scope, description: entry.description, quoted: entry.quoted });
        created.push(entry.key);
      }
    }
    return { created, updated };
  }
}
