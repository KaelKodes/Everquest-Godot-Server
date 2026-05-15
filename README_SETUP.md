# EQMUD server — Setup, database, and hosting

This file lives **in `server/`**, next to **`README.md`**, and is the **full** getting-started guide for the Node game server (database, Redis, env, run commands, expectations).

---

## Open source, hosting, and support expectations

This project is **open source**; you may use and adapt it however you wish within the license and applicable law.

It was built with **one primary server setup in mind**. There is **no in-game server lobby yet**—that is a **future goal**, so players could pick from servers hosted by different operators. **For now**, each **developer** is expected to **configure the client and server** (URLs, `.env`, database, assets) for their own environment. **Ongoing support cannot be promised** while the stack is still in active development; once the project feels **finished and stable**, that picture may change.

---

## Prerequisites

1. **Node.js** 18+ and **npm** (run all commands from **`server/`** — this folder)  
2. **MariaDB or MySQL** with a **PEQ-compatible** (EQEmu) database  
3. **Redis** — required for **`npm run cluster`** (world ↔ zone broker)  
4. **Godot 4.6+** with **.NET / C#** for the client — project folder **`eqmud/`** (sibling of `server/`)  
5. A **legal EverQuest (RoF2)** install path on the **client** machine (Lantern asset extraction)

---

## Database: EQEmu ecosystem and “Akk stack”

EQMUD does **not** ship a full SQL dump (size and licensing). You supply a database like a private EQEmu server would:

- Install or import a standard **EQEmu / PEQ** schema into MariaDB.  
- Many operators use **Akkadius’ installer and Docker resources** (“**Akk stack**”); see **[Akkadius/EQEmuInstall](https://github.com/Akkadius/EQEmuInstall)** and **[EQEmu Server](https://github.com/EQEmu/Server)** for a `peq`-style database.

Then configure **`.env`** in **`server/`** (copy from **`.env.example`**). **`EQEMU_PASSWORD` is mandatory.**

- DB in **Docker**, Node on **Windows host**: often `EQEMU_HOST=host.docker.internal` and host port **`3307` → 3306** in the container.  
- DB connectivity notes also appear in **`eqmud/DEVELOPER_REFERENCE.md`** (*Database Connectivity*).

Overview of this Node stack (systems, ports, env table): **[README.md](./README.md)** in this same folder.

---

## Quick start (from `server/`)

### 1. Database and Redis

Bring up MariaDB (PEQ-style data) and Redis. Confirm credentials with a MySQL client match **`.env`**.

### 2. Install and run

> **Tip:** You can now use the **[EQ.gd Launcher](https://github.com/KaelKodes/Everquest-Godot-Launcher/releases/latest)** to automatically download and unpack the latest server release! Just toggle the launcher into "Server" mode (password-protected).
> If you are installing from source or prefer the manual route, follow the steps below:


```bash
cp .env.example .env
# Edit .env: set EQEMU_PASSWORD and any host/port overrides

npm install
node tools/parse_spells.js
node tools/parse_items_p99.js

npm run cluster
```

Optional: `node configure.js` or `Edit_Server.bat` (Windows) to edit and test DB settings.

**Default client entrypoint:** WebSocket **`ws://localhost:3005`** (login). World **3006**; zone nodes **3010** / **3011** (see `master.js`).

### 3. Client

Open the Godot project in **`eqmud/`** (next to `server/`), set the RoF2 asset path, run the main scene. Client readme: **`eqmud/README.md`**.

---

## Technical reference (coordinates, boot order)

**`eqmud/DEVELOPER_REFERENCE.md`** — EQ ↔ Godot rules, Lantern vs server space, server bootstrap order.

---

## Workspace layout (reminder)

| Path | Role |
|------|------|
| **`server/`** | This folder — Node game server. |
| **`eqmud/`** | Godot client. |
| **`Reference/`** | Reference material; not required to run the game. |
| **`eqemu_source/`** | Upstream EQEmu C++ reference only. |

---

## License / ethics

Open source does **not** grant rights to Daybreak’s client assets or live-service data. Use your **own** EQ installation for client files; use **properly sourced** SQL dumps for the database. Keep the project non-commercial and respectful of the IP owner.

*EverQuest* is a registered trademark of Daybreak Game Company LLC.
