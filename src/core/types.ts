// defenv domain model.
//
//   Space      a top-level scope (e.g. a microservice) that owns everything below
//    ├─ Variable   a global env var within the space: KEY = value, optional group
//    ├─ Group      a named bundle of variables within the space
//    ├─ Schema     a composition: "this .env = group A + group B + vars G, H, E"
//    └─ Project    links a filesystem path to a Schema; generation writes the .env
//
// Each space is isolated: microservice1 and microservice2 have their own
// variables, groups, schemas, and projects. Keys are unique within a (space,
// group) scope, so the same KEY may appear in different groups or spaces.

export interface Space {
  id: string;
  name: string;
  description?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Variable {
  id: string;
  spaceId: string;
  key: string;
  value: string;
  groupId: string | null;
  secret: boolean;
  description?: string;
  quoted?: boolean; // always wrap in double quotes on export (preserves intent / handles '#')
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  spaceId: string;
  name: string;
  description?: string;
  collapsed: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Schema {
  id: string;
  spaceId: string;
  name: string;
  description?: string;
  groupIds: string[];
  variableIds: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  spaceId: string;
  name: string;
  path: string;
  schemaId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Database {
  version: number;
  activeSpaceId?: string;
  spaces: Space[];
  groups: Group[];
  variables: Variable[];
  schemas: Schema[];
  projects: Project[];
}

/** Portable single-space bundle for export / import. */
export interface SpaceExport {
  kind: "defenv.space";
  v: 1;
  exportedAt: string;
  space: { name: string; description?: string };
  groups: Group[];
  variables: Variable[];
  schemas: Schema[];
  projects: Project[];
}

export const DB_VERSION = 3;

export function emptyDatabase(): Database {
  const ts = new Date().toISOString();
  const space: Space = { id: crypto.randomUUID(), name: "default", order: 0, createdAt: ts, updatedAt: ts };
  return { version: DB_VERSION, activeSpaceId: space.id, spaces: [space], groups: [], variables: [], schemas: [], projects: [] };
}
