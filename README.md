# Everquest.Godot — Authoritative Server (Node.js)

The EQMUD game engine: WebSockets, JSON protocol, MariaDB (PEQ / EQEmu schema), and Redis for multi-process coordination. This is **not** the legacy EQEmu C++ zone binary; it is a custom Node server that **reads** classic EQEmu-style SQL data.

**Hosting:** There is no built-in **server browser / lobby** yet; you point the client at your WebSocket URL and supply your own MariaDB/Redis stack.

**Full stack install, Akk/PEQ database, hosting expectations, and quick start:** open **`README_SETUP.md`** in the **repository root** (the parent folder of `server/`—same level as `README.md`).

---

## What you need installed

| Dependency | Purpose |
|------------|---------|
| **Node.js** 18+ (LTS recommended) | Runtime |
| **MariaDB or MySQL** | World data: `zone`, `zone_points`, `npc_types`, `items`, `character_data`, spells, factions, etc. (PEQ-compatible dump) |
| **Redis** | Pub/sub between **world** and **zone** processes when using `npm run cluster` |
| **(Optional)** Legal **EverQuest (RoF2)** install path on the **client** machine | Godot client extracts `.s3d` / zone assets via Lantern; not required on the server host unless you run tools that read client files |

---

## Database: EQEmu / “Akk stack” (PEQ)

EQMUD expects a **standard EQEmu content database** (commonly the **PEQ** schema). Many operators use **Akkadius’ tooling and Docker images** to bring up MariaDB + imports — often called the **“Akk stack”** in the community.

1. **Get a database**  
   - Install [EQEmu Server](https://github.com/EQEmu/Server) and follow official docs, **or**  
   - Use installer / container resources such as **[Akkadius / EQEmuInstall](https://github.com/Akkadius/EQEmuInstall)** and community guides to run MariaDB and load **PEQ** (or compatible) SQL.  
   - You need tables the server queries: `account`, `character_data`, `zone`, `zone_points`, spawns, items, spells, factions, etc. Exact list evolves with the codebase; `server/eqemu_db.js` is the source of truth for queries and migrations.

2. **Expose MariaDB to the host**  
   - Typical Docker mapping: host `3307` → container `3306` (matches defaults below).  
   - Create a DB user/password the server can use (defaults assume user `eqemu`, database `peq`).

3. **Configure `server/.env`**  
   - Copy `server/.env.example` to `server/.env`.  
   - **`EQEMU_PASSWORD` is required** — the server will not start without it (`eqemu_db.js`).  
   - If Node runs on **Windows/WSL** and MariaDB is **inside Docker**, set `EQEMU_HOST=host.docker.internal` (or your published host) so `127.0.0.1` does not point at the wrong network namespace.

4. **Test the DB**  
   - `node configure.js` — menu option to test MySQL connection and edit `.env`.  
   - Or any MySQL client using the same host/port/user/database.

---

## Redis

The **cluster** layout starts a **world** process that uses Redis (`server/network/broker.js`). Default: `REDIS_URL=redis://127.0.0.1:6379`.

- Run Redis locally, **or**  
- Add a Redis service to Docker and point `REDIS_URL` at it.

If Redis is unreachable, world/zone coordination will fail — fix Redis before debugging game logic.

---

## Environment variables (reference)

| Variable | Default | Notes |
|----------|---------|--------|
| `EQEMU_HOST` | `127.0.0.1` | DB host |
| `EQEMU_PORT` | `3307` | DB TCP port |
| `EQEMU_USER` | `eqemu` | DB user |
| `EQEMU_PASSWORD` | *(none)* | **Required** |
| `EQEMU_DATABASE` | `peq` | Database name |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis for broker |
| `WORLD_URL` | `ws://localhost:3006` | Used by login to hand off to world (override if you remap ports) |
| `EQMUD_ALLOW_GM_COMMANDS` | unset | Set to `1` to relax some GM checks (dev only) |
| `SCRIBE_CURVE_MAX_LEVEL` | `60` | Scribing tuning |

Per-process **`PORT`** is set by `master.js` for each child (see below); you normally do not set `PORT` in `.env` for the cluster.

---

## Static game data (JSON)

Spell and item binaries are not in git. Generate local caches:

```bash
cd server
npm install
node tools/parse_spells.js
node tools/parse_items_p99.js
```

Other `server/tools/*.js` scripts expect the same `.env` DB credentials.

---

## Running the server

### Recommended: multi-process cluster (`master.js`)

Starts **login**, **world**, and **two zone nodes** (ports are fixed in `master.js` unless you edit it):

| Process | Script | Default port |
|---------|--------|----------------|
| LOGIN | `login_server.js` | **3005** |
| WORLD | `world_server.js` | **3006** |
| Zone node “tunare” | `zone_server.js` | **3010** |
| Zone node “innoruuk” | `zone_server.js` | **3011** |

```bash
cd server
npm install
npm run cluster
```

Windows: `Start_Cluster.bat`.

The Godot client’s default WebSocket URL is **`ws://localhost:3005`** (login). After login, the client is redirected toward **world** / **zone** URLs supplied by the server.

---

## Project layout

- `systems/` — Combat, spells, zones, movement, AI, etc.  
- `data/` — JSON lookups, spell DB output, zone metadata consumers.  
- `tools/` — Parsers and one-off DB utilities.  
- `quests/` — Quest scripts (Perl/Lua/WASM integration as wired in engine).  
- `network/` — Zone routing, Redis broker, tokens.  
- `eqemu_db.js` — MariaDB pool, migrations, zone/character queries.

---

## Documentation elsewhere

- Repo root **`README.md`** and **`README_SETUP.md`** — overview vs full setup/hosting.  
- **`eqmud/DEVELOPER_REFERENCE.md`** — coordinate mapping (EQ ↔ Godot), boot order, DB host notes.  
- **`Reference/`** — upstream or legacy reference code; not required to run the Node cluster.

---

## Legal

EverQuest is a trademark of Daybreak Game Company LLC. EQMUD is a non-commercial fan project; bring your own legally obtained game assets on the client.
