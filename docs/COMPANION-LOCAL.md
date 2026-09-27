# Local companions: one model, one character of each class

Handoff for a new chat. Kyle asked for this written down so that chat can build it. Do not start by creating fifteen characters. Move Sera onto a local model first, and only then add the other classes.

## What he wants

Sera stays the same person in play: she talks, follows, paths, pulls, shops, trades, hails, logs places, and can be sent to town. The paid Cursor call goes away. A local model that costs nothing replaces it.

That same mind then plays any class. He wants one character of each class. Each one learns that class by playing it. They behave like Sera: same voices, same action lines, same loyalty. They do not all stand in the world at once.

Learning is not a fine-tune. One model is the voice. Each character keeps their own sheet, class routines, spellbook, purse, shop notes, and place catalogue. That is how they get better at the class. The model weights stay shared.

## How Sera works today

Voice is `server/systems/companionMind.js`. `getAgent()` uses `@cursor/sdk` `Agent.create` with `tools: []`, model `composer-2.5` unless `CURSOR_MODEL` is set, key `CURSOR_API_KEY` from `server/.env`. Every heard line is one `agent.send`. The prompt is the user message. `systemPrompt` in the SDK is not relied on.

She answers in labeled lines:

- `OOC:` Grok, plain words, exact numbers from the sheet
- `IC:` Sera to the group. Group chat does not reach NPCs
- `SAY:` words an NPC can hear
- `EM:` a `/em` action, no name in front
- `ACT:` one command: cast, sit, jump, stand, emote, hail, invite, leave group, pull, unequip, give, accept or decline trade, offer, trade with, browse, buy, sell, go to town, log a place

History cap is 16 turns, in memory, one zone process. One reply in flight, one pending.

Wake and despawn are `server/systems/companion.js`. Name `Sera`, partner account `10000` (GMKael, Kuldaien is character 56). She spawns when that account enters, grouped, a few steps away. If she is already up but ungrouped, she is re-invited. She is removed when Kuldaien camps or disconnects. She does not exist while he is offline.

Her body is the Sera cleric plugin in `bots/sera/cleric.js`, loaded by the server plugin host, on `baseBot.js`. Pathing is `server/systems/companionPath.js`: step around zone walls, follow the group, pull, run to the tank in combat, walk an errand to bind or succor and take a zone line. Places persist in `server/data/companion/sera-places.json`. Shop memory and owed copper are still in memory only.

There is no second companion. Do not spawn Autie. Do not expand the hired-student bot system.

## The local voice

Use Ollama on this PC. OpenAI-compatible chat at `http://127.0.0.1:11434/v1/chat/completions`. No tools. The model must not get a shell.

`server/.env` (gitignored, never commit, never print the Cursor key):

```
COMPANION_LLM=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=
```

Leave `COMPANION_LLM=cursor` as the fallback until Kyle says the local voice is good enough. If `COMPANION_LLM=ollama` and Ollama is down, say so on OOC. Do not silently bill Cursor.

Replace `getAgent` / `agent.send` with one function that posts the same prompt text and returns the assistant string. Keep `splitReply`, `perform`, and every ACT. Pictures: a text model cannot see them. Until a vision model is chosen, tell Grok on that turn that a picture arrived and he cannot see it. Do not drop `/show`.

Pick the model with Kyle. A 14B-class model is the floor if she is going to keep the action format. Record the exact name in `.env` and `.env.example`. Do not download a model without him choosing it.

## Sixteen characters

Classes, from `server/data/constants.js`:

| Class | Id |
| --- | --- |
| warrior | 1 |
| cleric | 2 |
| paladin | 3 |
| ranger | 4 |
| shadow_knight | 5 |
| druid | 6 |
| monk | 7 |
| bard | 8 |
| rogue | 9 |
| shaman | 10 |
| necromancer | 11 |
| wizard | 12 |
| magician | 13 |
| enchanter | 14 |
| beastlord | 15 |
| berserker | 16 |

Sera remains the cleric. Do not rename her or move her off account `10001`. The other fifteen are new characters, one account each or one shared account, level 1, in their real start city. Kyle names them, or the chat proposes names and waits. Do not invent a surname for him.

Only one companion is in the world at a time: the one he asked to bring, defaulting to Sera. The others stay despawned. Same rule as now: they exist only while account `10000` is online, and they despawn when he camps or drops.

Each companion record:

- character id, class, name
- bot profile for that class
- own history
- own place file `server/data/companion/<name>-places.json`
- own shop notes and owed copper, persisted the same way as places
- spell list for that class from `spellDatabase`, not a cleric list copied over

`companionMind.js` is hardcoded to one Sera and to cleric bits in a few places (shop filter `1 << 1`, cleric spell forecast, Felwithe personality). Split the shared reply loop from the per-character persona. The cleric persona stays: young, just out of Felwithe, eager, glad of the company, flirtatious only if invited. Other classes get a short persona of the same kind, not a different game. Loyalty stays: do not leave Kuldaien's group because a stranger asked. Do not join a stranger unless he has said she may.

Class play is the bot profile plus the sheet, not a paragraph in the prompt. Cleric already heals. Other profiles should start thin: follow, path, assist, pull when asked, med, and the spells or skills that class actually has. Melee attacks only when the profile is a melee class and he has asked them to fight. A cleric still does not start fights.

## Build order

1. Point Sera's existing mind at Ollama behind `COMPANION_LLM`. Cursor path stays. Prove OOC, IC, SAY, EM, and one ACT (hail or sit) on the local model.
2. Persist shop notes the way places already persist.
3. Add a companion roster file. Sera is the only row. Wake still means Sera until he names someone else.
4. Add class profiles only as he calls for that class. Create that one character, profile, and memory. Do not batch-create fifteen before the second one has been played.
5. A way for him to say who to bring. That companion zones in grouped. The previous one despawns.

## Server facts the next chat needs

- Cluster is `node master.js` from `EQMUD/server`. Login is Mithaniel Marr, `ws://127.0.0.1:4005`. Do not use `docker-compose.yml`.
- Node is not on PATH in a fresh shell. Prefix: `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')`.
- Restarting the cluster kills the live server. He must log in again. Godot replay is only required when a client script changes. This plan is server-side.
- Do not commit `.env`. Do not print passwords or the Cursor key.
- Zone walls used for pathing come from `server/systems/spatial.js`. Lava is avoided only when the map has it as a wall.

## Done when

Sera on the local model still groups, follows, paths, talks in both voices, hails, shops, trades, and logs a place. Switching `COMPANION_LLM` back to `cursor` still works. A second class can be created only after he asks, and only that one wakes with him.
