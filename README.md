# defenv

Organize environment variables by **space** (e.g. one per microservice), group
them, compose **schemas**, link a schema to a **project**, and generate that
project's `.env` — from a local web UI or a global CLI.

> A schema says *"project X's `.env` = group A + group B + variables G, H, E"*.
> A project links a filesystem path to a schema. Generating writes the resolved
> `.env` to that path.

Built entirely on **Deno** with **zero dependencies** — no Node, no npm, no
build step, no `node_modules`. The web UI is a single self-contained page served
by a tiny built-in HTTP server, so `defenv ui` just runs. MIT-licensed.

```
Space  (e.g. microservice1 — isolated from microservice2)
  Variable ──grouped into──▶ Group ─┐
                                    ├──composed into──▶ Schema ──linked by──▶ Project ──gen──▶ .env
  loose Variables ──────────────────┘   (whole groups + loose vars)        (path ↔ schema)
```

---

## Install

The only requirement is [Deno](https://deno.land) 2.x. Pick whichever fits:

**From source** (clone the repo):

```sh
git clone https://github.com/defenv/defenv
cd defenv
sh install.sh        # or, equivalently: deno task install
```

**Remote one-liner** (downloads the source over HTTPS — never asks for a login):

```sh
curl -fsSL https://raw.githubusercontent.com/defenv/defenv/HEAD/install.sh | sh
```

All three install a global `defenv` command. Then:

```sh
defenv help
defenv ui          # launch the web UI at http://localhost:8765
```

Notes:

- The remote one-liner pulls from [`defenv/defenv`](https://github.com/defenv/defenv)
  via a tarball download (curl/wget), so it **never prompts for a GitHub username or
  password**. `HEAD` follows the repo's default branch automatically (no need to know
  if it is `master` or `main`); pin a branch/tag/SHA with `DEFENV_REF=…`, or install
  from a fork with `DEFENV_REPO=you/defenv`.
- Point the installer at any local copy with `DEFENV_SRC=/path/to/defenv sh install.sh`.
- `defenv install` puts the binary shim in Deno's bin dir (usually `~/.deno/bin`).
  If that isn't on your `PATH`, add `export PATH="$HOME/.deno/bin:$PATH"`.

No global install needed to try it — from the source dir you can just run:

```sh
deno task ui       # same as `defenv ui`
deno task cli help # same as `defenv help`
```

---

## The model

- **Space** — the top-level scope (e.g. a microservice). Each space owns its
  own variables, groups, schemas, and projects, fully isolated from other
  spaces. Switch the active space from the header (UI) or with `--space`
  (CLI). A fresh database starts with one space named `default`.
- **Variable** — an env var: `KEY = value`, with an optional **note**. Keys are
  unique *within a (space, group) scope* — the same `KEY` may exist in different
  groups, ungrouped, and in other spaces (e.g. `DATABASE_URL` in `group1`, in
  `group2`, and in `microservice2`). A `secret` flag masks the value in the UI.
- **Group** — a named bundle of variables (e.g. `database`, `auth`). A variable
  belongs to one group, or none.
- **Schema** — a composition: the whole of some groups **plus** any number of
  loose individual variables. This is the shape of one `.env`. Example:
  `project-x = group database + group auth + FEATURE_G, FEATURE_H, FEATURE_E`.
- **Project** — links a filesystem path to a schema. Generating resolves the
  schema and writes the `.env` to the path (a directory gets `/.env`; an explicit
  file path is written as-is).

Resolution renders included groups first (in the schema's order), then an
`# ---- ungrouped ----` section for the loose variables. A variable's note is
emitted as a `# comment` above its line. Awkward/secret values are quoted per
dotenv conventions.

---

## Quick start (CLI)

```sh
defenv space add microservice1     # create + switch to a space
defenv group add database
defenv group add auth
defenv var add DATABASE_URL postgres://localhost/app --group database
defenv var add DB_POOL 10 --group database
defenv var add JWT_SECRET s3cr3t --group auth --secret
defenv var add FEATURE_G on                       # loose (ungrouped)

defenv schema add project-x --group database --group auth --var FEATURE_G
defenv schema show project-x

defenv project add my-app --path ~/code/my-app --schema project-x
defenv project gen my-app                          # writes ~/code/my-app/.env

defenv gen project-x --print                       # or just preview/emit a schema
defenv import ./.env --group database              # load an existing file in
```

---

## The web UI

`defenv ui` serves a single page. **Light theme is the default**; a richer dark
theme is one click away (toggle top-right, remembered). A **space switcher** in
the header creates, renames, deletes, switches, and **exports / imports** spaces
(export downloads a self-contained JSON; import recreates the space with fresh
ids) — the three tabs below always show the active space. Same core as the CLI:

- **Variables** — add a variable or group inline; **collapsible group cards**
  with a count and inline rename; each row edits key/value, carries an optional
  **note**, and reassigns the group. Secret values are **hidden by default** with
  per-row **eye** (show/hide) and **copy** icons that colour green when active, a
  **lock** icon to mark/unmark secret, a **quote** icon that cycles the export
  quote style — *auto* (quote only when needed), *none* (raw), *single* (`'…'`,
  literal), *double* (`"…"`, escaped). Importing preserves the input style, so a
  JSON value stays unescaped (kept single-quoted or raw) while a double-quoted
  value round-trips escaped. The **copy** icon copies the value in that style.
  Plus **Show all / Hide all**.
  **Deleting is select-then-confirm**: tick one or more rows (or click a row) and a
  **Delete N** button appears, so nothing is removed by a single misclick. Groups **collapse/expand** individually or via **Collapse all / Expand all**. Live
  **search** over keys, values, and notes (with a clear button); a **Paste .env** popup bulk-imports
  `KEY=VALUE` text — or a flat **JSON** object `{ "key": "value" }` — into a chosen group, with a **skip comments** toggle (off by
  default, so a `#` line directly above a variable is kept as its note).
- **Schemas** — green **group chips** + mono **loose-var chips** per schema.
  **Compose** opens a popup with checkbox lists of every group and loose variable
  and a **live count** of the resolved `.env`. Rename, **preview .env**, delete.
- **Projects** — each shows its path and linked-schema chip. **Preview** the
  resolved `.env`, **edit** the link, **Generate .env** with one click (a toast
  confirms `Generated N vars → /path/.env`), export a committable
  **.env.example** (keys only, no values — secrets never leak), or copy a plain
  **keys** list to paste straight into a schema's required-keys contract.

Popups animate in over a dimmed overlay; toasts slide in after loads, creates,
and generates.

---

## CLI reference

```
SPACES    defenv space add NAME | use NAME | rename OLD NEW | rm NAME | ls
          defenv space export [NAME] [--out FILE] | import FILE
VARIABLES   defenv var add KEY [VALUE] [--group G] [--secret] [--quote] [--desc D]
            defenv var set KEY VALUE | rm KEY | ls [--group G]
            defenv var mv KEY (--group G | --ungroup)
GROUPS      defenv group add NAME [--desc D] | rename OLD NEW | rm NAME | ls
SCHEMAS     defenv schema add NAME [--group A --group B ...] [--var K --var L ...]
            defenv schema add-group NAME GROUP | rm-group NAME GROUP
            defenv schema add-var NAME KEY     | rm-var NAME KEY
            defenv schema show NAME | ls | rm NAME
PROJECTS    defenv project add NAME --path P --schema S
            defenv project set NAME [--path P] [--schema S] | rm NAME | ls
            defenv project gen NAME
LOAD/GEN    defenv import FILE [--group G] [--json] [--skip-comments]
            defenv gen SCHEMA [--out FILE | --print]
MISC        defenv ui [--port 8765]   ·   defenv where
```

`--group` and `--var` are repeatable (for `schema add`). All non-space commands
accept `--space NAME` to act on a space other than the active one.

---

## Where data lives

A single human-readable JSON file in a hidden home dir:

```
~/.defenv/           ($DEFENV_HOME overrides the whole dir)
  db.json            the database
  src/               the source, when installed via the remote one-liner
```

`defenv where` prints the database path. Writes are atomic (temp file + rename).

---

## Project layout

```
defenv/
  cli.ts                 the global command (all subcommands + `ui`)
  deno.json              tasks: ui / cli / serve / check / install
  install.sh             local-or-remote installer (no GitHub auth)
  src/
    core/                pure TypeScript, no imports — shared by CLI and server
      types.ts store.ts dotenv.ts generate.ts paths.ts pathutil.ts
    server/
      server.ts          built-in Deno HTTP server: JSON API + serves the UI
      assets.ts          the UI, embedded (generated from static/)
  static/
    index.html app.js    the UI source (edit here, then re-embed)
  scripts/embed.cjs       re-embeds static/ into src/server/assets.ts
```

The runtime imports nothing external, so the first `defenv ui` needs no network
and no build — it starts immediately.

### Developing the UI

Edit `static/index.html` / `static/app.js`, then re-embed and run:

```sh
node scripts/embed.cjs   # regenerate src/server/assets.ts from static/
deno task ui
```

---

## Caveats

- **Secrets are stored in plaintext** in `~/.defenv/db.json` — the same threat
  model as the `.env` files defenv produces. The `secret` flag only controls UI
  masking, not encryption at rest.
- **Generated `.env` files are overwritten**; they carry a "do not edit by hand"
  header. Manage variables in defenv and regenerate.
- Feeding `.env` from a **central server** is intentionally out of scope here.
