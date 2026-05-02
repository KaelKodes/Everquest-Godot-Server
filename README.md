# ⚙️ Faydark MUD: Game Engine (Server)

The core authority of Faydark MUD. A high-performance, authoritative game engine built in Node.js and WebSockets, designed to handle the complex mathematics and persistent state of a classic MMO.

### 🛠️ Architecture
- **Language:** Node.js (Authoritative Server)
- **Communication:** WebSockets (JSON payloads)
- **Database:** SQLite (Persistent state) + JSON Flat-files (Static data)
- **Systems:**
    - **Threat Engine (Hate):** Authentic EQEmu-style hate list logic. Tracks top-threat, damage-to-hate ratios, and healing aggro.
    - **Spell System:** A data-driven system handling over 1,800 classic spells, complete with duration-based buffs, DOTs, and AE logic.
    - **Combat Math:** 1:1 recreation of classic hit-chance, mitigation, and delay equations.
    - **AI & Spawning:** Dynamic NPC ticking, roaming, and faction-based proximity aggro.

### 🚀 Getting Started
1. **Initialize Data:**
   The master databases are excluded for size. Run the scrapers to build your local world:
   ```bash
   node tools/parse_spells.js
   node tools/parse_items_p99.js
   ```
2. **Configure the Server:**
   You can easily change the server port or database connection settings using the toolkit:
   - Run `Edit_Server.bat` (Windows)
   - Or run `node configure.js`
   - This tool allows you to update settings and test your database connection.

3. **Start the Engine:**
   ```bash
   npm install
   node index.js
   ```

### 📁 Project Structure
- `/systems`: Core logic (Combat, Hate, Spells, AI, Spawning)
- `/data`: Master database files and JSON lookups.
- `/tools`: Scrapers and utility scripts.
- `/quests`: Quest script definitions.
- `/utils`: Helper functions and protocol constants.

### 🧪 Communication Protocol
The server uses a strictly JSON-based WebSocket protocol. 
Example `STATUS` payload:
```json
{
  "type": "STATUS",
  "char": { "name": "Eres", "hp": 100, "maxHp": 100, "level": 1 },
  "extendedTargets": [
    { "id": "mob_skeleton_1", "name": "a skeleton", "hp": 50, "hatePercent": 100 }
  ]
}
```
