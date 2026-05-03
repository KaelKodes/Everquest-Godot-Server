const fs = require('fs');
const path = require('path');
const ZONES = require('./data/zones');
const SpellDB = require('./data/spellDatabase');
const SPELLS = SpellDB.createLegacyProxy(); // Legacy proxy for backwards compatibility
const { Skills, RACIAL_STARTING_SKILLS } = require('./data/skills');
const { STARTER_GEAR, SUMMON_ITEM_MAP } = require('./data/items');
const ItemDB = require('./data/itemDatabase');
const ITEMS = ItemDB.createLegacyProxy(); // Legacy proxy for backwards compatibility
const DB = require('./db');
const combat = require('./combat');
const { NPC_TYPES, HAIL_RANGE } = require('./data/npcTypes');
const MERCHANT_INVENTORIES = require('./data/npcs/merchants');
const QuestDialogs = require('./data/npcs/quests');
const MiningData = require('./data/miningNodes');
const { PET_SPELLS, PET_SKILL_TIERS, PET_NAMES } = require('./data/petData');
const { VISION_MODES, RACE_VISION, SPELL_VISION_MODES, AMBIENT_LIGHT } = require('./data/visionModes');
const Calendar = require('./data/calendar');
const WorldAtlas = require('./data/worldAtlas');
const { send, getDistance, getDistanceSq } = require('./utils');
const VisionSystem = require('./systems/vision');
const AISystem = require('./systems/ai');
const EnvironmentSystem = require('./systems/environment');
const SpellSystem = require('./systems/spells');
const ChatSystem = require('./systems/chat');
const InventorySystem = require('./systems/inventory');
const GroupManager = require('./systems/groups');

const MovementSystem = require('./systems/movement');
const StatsSystem = require('./systems/stats');
const SpawningSystem = require('./systems/spawning');
const MiningSystem = require('./systems/mining');
const ZoneSystem = require('./systems/zones');
const CombatSystem = require('./systems/combat');
const SurvivalSystem = require('./systems/survival');
const ClericBot = require('./systems/botAI/profiles/cleric');
const { mapEqemuClassToNpcType, GUILD_MASTER_CLASS } = require('./utils/npcUtils');

// Bind stat calculation for spells and systems
setTimeout(() => {
  SpellSystem.setCalcEffectiveStatsFn(StatsSystem.calcEffectiveStats);
  SpellSystem.setDBFn(DB);
  SpellSystem.setItemsFn(ITEMS);
  SpellSystem.setSummonItemMapFn(SUMMON_ITEM_MAP);
  SpellSystem.setSendInventoryFn(sendInventory);
  SpellSystem.setZoneInstancesFn(State.zoneInstances);
  InventorySystem.setCalcEffectiveStatsFn(StatsSystem.calcEffectiveStats);
  InventorySystem.setSendCombatLogFn(sendCombatLog);
  InventorySystem.setSendInventoryFn(sendInventory);
  InventorySystem.setSendStatusFn(sendStatus);
  InventorySystem.setProcessQuestActionsFn(processQuestActions);

  ChatSystem.setSendCombatLogFn(sendCombatLog);
  ChatSystem.setProcessQuestActionsFn(processQuestActions);
  ChatSystem.setHandleHailFn(handleHail);
  
  MovementSystem.setGetZoneDefFn(ZoneSystem.getZoneDef);
  MovementSystem.setHandleStopCombatFn(handleStopCombat);
  MovementSystem.setDespawnPetFn(despawnPet);
  MovementSystem.setSendCombatLogFn(sendCombatLog);
  MovementSystem.setBroadcastEntityStateFn(broadcastEntityState);
  MovementSystem.setEnsureZoneLoadedFn((zoneKey) => ZoneSystem.ensureZoneLoaded(zoneKey, SpawningSystem.spawnMob, MiningSystem.spawnMiningNodes, MiningSystem.spawnMiningNPCs));
  MovementSystem.setSendStatusFn(sendStatus);
  MovementSystem.setFlushSkillUpsFn(flushSkillUps);
  MovementSystem.setInterruptCastingFn(tryInterruptCasting);

  CombatSystem.setDependencies({ 
    handleMobDeath, sendCombatLog, sendStatus, despawnPet, combat, 
    zoneInstances, SpellDB, SpellSystem, ITEMS, DB, sendFullState, 
    calcEffectiveStats: StatsSystem.calcEffectiveStats 
  });
  SpellSystem.setDependencies({ 
    combat, handleMobDeath, sendStatus, sendCombatLog, 
    handleStopCombat: CombatSystem.handleStopCombat,
    handleSuccor: MovementSystem.handleSuccor,
    ensureZoneLoaded: ZoneSystem.ensureZoneLoaded,
    resolveZoneKey: ZoneSystem.resolveZoneKey,
    getZoneDef: ZoneSystem.getZoneDef
  });
  StatsSystem.setDependencies({ combat, sendCombatLog, SpellSystem });
  MiningSystem.setDependencies({ ItemDB, ITEMS, sendCombatLog, sendInventory });
  InventorySystem.handleTrainSkillFn = handleTrainSkill;
}, 0);
const QuestManager = require('./questManager');

// Precise zone line trigger data extracted from EQ S3D client files (BSP regions)
let ZONE_TRIGGERS = {};
try { ZONE_TRIGGERS = require('./data/zone_triggers.json'); } catch (e) { console.warn('[ENGINE] No zone_triggers.json found, using DB defaults for all triggers'); }

/**
 * Map EQEmu npc_types.class to our NPC_TYPES.
 * EQEmu classes: 1=Warrior, 41=Merchant, 40=Banker, 61=LDoN Merchant, etc.
 * Guild Master classes: 20=Warrior_GM, 21=Cleric_GM, 22=Paladin_GM, 23=Ranger_GM,
 *   25=ShadowKnight_GM, 26=Druid_GM, 27=Monk_GM, 28=Bard_GM, 31=Wizard_GM,
 *   32=Magician_GM, 33=Necromancer_GM, 34=Enchanter_GM, 35=Shaman_GM, 63=LDoN_Recruiter
 */

const TICK_RATE = 200; // 200ms game ticks (5hz)
const VIEW_DISTANCE = 800; // Enable proximity culling (800 units) to reduce CPU load
const SYNC_RATE = 100; // Sync world every 100 ticks (20s) to refresh state

const State = require('./state');
const sessions = State.sessions;
const authSessions = State.authSessions;
const zoneInstances = State.zoneInstances;
let worldCalendar = State.worldCalendar;

// See combat.js for math helpers


// ── Session Management ──────────────────────────────────────────────

async function createSession(ws, char) {
  // Map EQEmu short_name to our internal zone key (qeytoqrg → qeynos_hills)
  char.zoneId = ZoneSystem.resolveZoneKey(char.zoneId);

  // Ensure the player's zone is loaded (dynamically loads spawns if needed)
  await ZoneSystem.ensureZoneLoaded(char.zoneId, SpawningSystem.spawnMob, MiningSystem.spawnMiningNodes, MiningSystem.spawnMiningNPCs);

  const inventory = await DB.getInventory(char.id);
  const spells = await DB.getSpells(char.id);
  const skillsList = await DB.getSkills(char.id);

  const skills = {};
  if (Array.isArray(skillsList)) {
    for (const row of skillsList) {
      skills[row.skill_id] = row.value;
    }
  }

  // ── Skill Initialization / Migration ──
  // Grant any missing skills that the character qualifies for based on class/level
  let skillsChanged = false;
  for (const [skillKey, skillDef] of Object.entries(Skills)) {
    if (skills[skillKey] === undefined) {
      const classReq = skillDef.classes[char.class];
      // Languages and Tradeskills start at 1 if they are "universal" (handled in skills.js by inserting into all classes)
      if (classReq && char.level >= classReq.levelGranted) {
        skills[skillKey] = 1;
        skillsChanged = true;
      }
    }
  }

  // Racial Skill Migration
  const raceKey = char.race.toLowerCase().replace(/ /g, '_');
  const racialBonus = RACIAL_STARTING_SKILLS[raceKey];
  if (racialBonus) {
    for (const [skillKey, value] of Object.entries(racialBonus)) {
      if (skills[skillKey] === undefined || skills[skillKey] < value) {
        skills[skillKey] = Math.max(skills[skillKey] || 0, value);
        skillsChanged = true;
      }
    }
  }

  if (skillsChanged) {
    console.log(`[ENGINE] Seeded missing skills for ${char.name} (${char.race} ${char.class})`);
    DB.saveCharacterSkills(char.id, skills);
  }

  char.skills = skills;

  const session = {
    ws,
    char,
    inventory,
    spells,        // memorized gems (slot 0-7)
    spellbook: [],  // all scribed spells (bookSlot 0-791)
    effectiveStats: StatsSystem.calcEffectiveStats(char, inventory),
    inCombat: false,
    autoFight: false,
    combatTarget: null,
    attackTimer: 0,
    regenTimer: 6.0,
    buffs: [],
    casting: null,
    activeVisionMode: null,  // null = auto (racial/spell), or explicit mode key
  };

  // Load spellbook from file
  SpellSystem.loadSpellbookFromFile(session);

  // Load persisted buffs (with elapsed-time calculation)
  SpellSystem.loadBuffsFromFile(session);

  const zoneDef = ZoneSystem.getZoneDef(char.zoneId);
  if (!session.char.roomId && zoneDef && zoneDef.defaultRoom) {
      session.char.roomId = zoneDef.defaultRoom;
  }

  sessions.set(ws, session);

  // Ensure the player spawns at their stored coordinates
  if (char.x !== 0 || char.y !== 0) {
    session.pendingTeleport = { x: char.x, y: char.y, z: char.z || 0 };
  }

  return session;
}

function removeSession(ws) {
  const session = sessions.get(ws);
  if (session) {
    if (session.combatTarget) {
      session.combatTarget.target = null;
    }
    DB.updateCharacterState(session.char);
    DB.saveCharacterSkills(session.char.id, session.char.skills);
    DB.forceFlushCharacter(session.char.id); // Flush write-behind cache immediately
    SpellSystem.saveBuffsToFile(session);
    // Despawn pet on disconnect
    if (session.pet) {
      despawnPet(session);
    }
    sessions.delete(ws);
  }
  authSessions.delete(ws);
}

// ── Message Handling ────────────────────────────────────────────────

async function handleMessage(ws, msg) {
  const session = sessions.get(ws);

  switch (msg.type) {
    case 'LOGIN_ACCOUNT': return await handleLoginAccount(ws, msg);
    case 'CREATE_ACCOUNT': return await handleCreateAccount(ws, msg);
    case 'SELECT_CHARACTER': return await handleSelectCharacter(ws, msg);
    case 'DELETE_CHARACTER': return await handleDeleteCharacter(ws, msg);
    case 'REQUEST_DEITIES': return await handleRequestDeities(ws, msg);
    case 'REQUEST_CHAR_CREATE_DATA': return await handleRequestCharCreateData(ws, msg);
    case 'LOGIN': return await handleLogin(ws, msg);
    case 'CREATE_CHARACTER': return await handleCreateCharacter(ws, msg);
  }

  if (!session) return send(ws, { type: 'ERROR', message: 'Not logged in.' });

  switch (msg.type) {
    case 'SIT': return handleSit(session);
    case 'STAND': return handleStand(session);
    case 'START_COMBAT': return handleStartCombat(session);
    case 'ATTACK_TARGET': return handleAttackTarget(session, msg);
    case 'STOP_COMBAT': return handleStopCombat(session);
    case 'START_RANGED': return handleStartRanged(session);
    case 'STOP_RANGED': return handleStopRanged(session);
    case 'SET_TARGET': return handleSetTarget(session, msg);
    case 'CLEAR_TARGET': return handleClearTarget(session);
    case 'UPDATE_RANGE': 
      session.isOutOfRange = msg.outOfRange;
      return;
    case 'CAST_SPELL': return handleCastSpell(session, msg);
    case 'SPELL_INSPECT': return handleSpellInspect(session, msg);
    case 'ITEM_INSPECT': return handleItemInspect(session, msg);
    case 'REMOVE_BUFF': return require('./systems/spells').handleRemoveBuff(session, msg);
    case 'EQUIP_ITEM': return InventorySystem.handleEquipItem(session, msg);
    case 'UNEQUIP_ITEM': return InventorySystem.handleUnequipItem(session, msg);
    case 'ZONE': return MovementSystem.handleZone(session, msg);
    // 'MOVE' — removed (legacy room-grid system, 3D client uses UPDATE_POS)
    case 'UPDATE_POS': return MovementSystem.handleUpdatePos(session, msg);
    case 'UPDATE_SNEAK': return MovementSystem.handleUpdateSneak(session, msg);
    case 'USE_HIDE': return MovementSystem.handleHide(session, msg);
    case 'SWIM_TICK': return MovementSystem.handleSwimTick(session, msg);
    case 'JUMP': return MovementSystem.handleJump(session);
    case 'CAMP': return handleCamp(session);
    case 'TRAIN_SKILL': return handleTrainSkill(session, msg);
    case 'ABILITY': return handleAbility(session, msg);
    case 'SET_TACTIC': return handleTactic(session, msg);
    case 'GET_TRACKING_LIST': return handleGetTrackingList(session);
    case 'SET_TRACKING_TARGET': return handleSetTrackingTarget(session, msg);
    case 'CLEAR_TRACKING': return handleClearTracking(session);
    case 'HAIL': return handleHail(session, msg);
    case 'SAY': return ChatSystem.handleSay(session, msg);
    case 'AUTO_INVENTORY': return handleAutoInventory(session);
    case 'TARGET_NAME': return handleTargetName(session, msg);
    case 'CORPSE_DRAG': return handleCorpseDrag(session);
    case 'PET_COMMAND': return handlePetCommand(session, msg);
    case 'MERCENARY_ACTION': return handleMercenaryAction(session, msg);
    case 'HIRE_STUDENT_CONFIG': return handleHireStudentConfig(session, msg);
    case 'BUY': return InventorySystem.handleBuy(session, msg);
    case 'SELL': return InventorySystem.handleSell(session, msg);
    case 'BUY_RECOVER': return InventorySystem.handleBuyRecover(session, msg);
    case 'GET_OFFER': return InventorySystem.handleGetOffer(session, msg);
    case 'SELL_JUNK': return InventorySystem.handleSellJunk(session, msg);
    case 'NPC_GIVE_ITEMS': return InventorySystem.handleNPCGiveItems(session, msg);
    case 'NPC_GIVE_CANCEL': 
      sendInventory(session);
      return;
    case 'PET_INVENTORY_ACTION': return InventorySystem.handlePetInventoryAction(session, msg);
    
    // --- Group System ---
    case 'GROUP_INVITE': return GroupManager.handleInvite(session, msg.targetName);
    case 'GROUP_INVITE_RESPONSE': return GroupManager.handleInviteResponse(session, msg.accepted);
    case 'GROUP_DISBAND': return GroupManager.handleDisband(session);
    case 'GROUP_KICK': {
      if (session.group && session.group.leaderId === session.char.id) {
        const target = session.group.members.find(m => m.char.name === msg.targetName);
        if (target) GroupManager.handleDisband(target);
      }
      break;
    }
    case 'ASSIST_GROUP': {
      if (session.group) {
        const maId = session.group.roles.mainAssist;
        const ma = session.group.members.find(m => m.char.id === maId);
        if (ma && ma.combatTarget) {
          session.combatTarget = ma.combatTarget;
          send(session.ws, { type: 'SET_TARGET', targetName: ma.combatTarget.name || ma.combatTarget.char.name });
        }
      }
      break;
    }
    case 'GROUPROLES': {
      const args = (msg.text || '').split(' ');
      GroupManager.handleRoles(session, args);
      break;
    }
    case 'DESTROY_ITEM': return InventorySystem.handleDestroyItem(session, msg);
    case 'MOVE_ITEM': return InventorySystem.handleMoveItem(session, msg);
    case 'AUTO_EQUIP': return InventorySystem.handleAutoEquip(session, msg);
    case 'MEMORIZE_SPELL': return SpellSystem.handleMemorizeSpell(session, msg);
    case 'FORGET_SPELL': return SpellSystem.handleForgetSpell(session, msg);
    case 'SWAP_BOOK_SPELLS': return SpellSystem.handleSwapBookSpells(session, msg);
    case 'SAVE_SPELL_LOADOUT': return SpellSystem.handleSaveSpellLoadout(session, msg);
    case 'LOAD_SPELL_LOADOUT': return SpellSystem.handleLoadSpellLoadout(session, msg);
    case 'DELETE_SPELL_LOADOUT': return SpellSystem.handleDeleteSpellLoadout(session, msg);
    case 'CLEAR_SPELLS': return SpellSystem.handleClearSpells(session, msg);

    case 'MELODY': return handleMelody(session, msg);
    case 'STOP_MELODY': return handleStopMelody(session);
    // 'LOOK' — removed (legacy MUD command, 3D client uses periodic ZONE_STATE sync)
    case 'SENSE_HEADING': {
      return handleSenseHeading(session);
    }
    case 'CONSIDER': return handleConsider(session);
    case 'EMOTE': return handleEmote(session, msg);
    case 'RIGHT_CLICK': return InventorySystem.handleRightClick(session, msg);
    case 'MINE': return MiningSystem.handleMine(session, msg);
    case 'SET_VISION_MODE': return handleSetVisionMode(session, msg);
    case 'SUCCOR': return await MovementSystem.handleSuccor(session);
    case 'PET_COMMAND': return handlePetCommand(session, msg);
    case 'DOOR_CLICK': return handleDoorClick(session, msg);
    // ── Chat Channels ──
    case 'SHOUT': return ChatSystem.handleShout(session, msg);
    case 'OOC': return ChatSystem.handleOOC(session, msg);
    case 'YELL': return ChatSystem.handleYell(session, msg);
    case 'WHISPER': return ChatSystem.handleWhisper(session, msg);
    case 'GROUP': return ChatSystem.handleGroup(session, msg);
    case 'GUILD': return ChatSystem.handleGuild(session, msg);
    case 'RAID': return ChatSystem.handleRaid(session, msg);
    case 'ANNOUNCEMENT': return ChatSystem.handleAnnouncement(session, msg);
    default:
      console.log(`[ENGINE] Unknown message type: ${msg.type}`);
  }
}

// ── Account Authentication ──────────────────────────────────────────

async function handleLoginAccount(ws, msg) {
  const username = (msg.username || '').trim();
  const password = msg.password || '';

  if (username.length < 2 || username.length > 30) {
    return send(ws, { type: 'ERROR', message: 'Account name must be 2-30 characters.' });
  }

  const result = await DB.loginAccount(username, password);
  if (!result) {
    return send(ws, { type: 'ERROR', message: 'Account not found.' });
  }
  if (result.error) {
    return send(ws, { type: 'ERROR', message: result.error });
  }

  // Store auth session (status >= 200 = GM/Admin in EQEmu convention)
  authSessions.set(ws, { accountId: result.id, accountName: result.name, status: result.status || 0 });

  // Send character list
  const characters = await DB.getCharactersByAccount(result.id);
  send(ws, { type: 'ACCOUNT_OK', accountName: result.name, characters });
  console.log(`[ENGINE] Account '${result.name}' logged in with ${characters.length} characters.`);
}

async function handleCreateAccount(ws, msg) {
  const username = (msg.username || '').trim();
  const password = msg.password || '';

  if (username.length < 2 || username.length > 30) {
    return send(ws, { type: 'ERROR', message: 'Account name must be 2-30 characters.' });
  }
  if (password.length < 4) {
    return send(ws, { type: 'ERROR', message: 'Password must be at least 4 characters.' });
  }

  const result = await DB.createAccount(username, password);
  if (result.error) {
    return send(ws, { type: 'ERROR', message: result.error });
  }

  // Auto-login after creation
  authSessions.set(ws, { accountId: result.id, accountName: result.name });
  send(ws, { type: 'ACCOUNT_OK', accountName: result.name, characters: [] });
  console.log(`[ENGINE] Account '${result.name}' created (id=${result.id}).`);
}

async function handleSelectCharacter(ws, msg) {
  const auth = authSessions.get(ws);
  if (!auth) {
    return send(ws, { type: 'ERROR', message: 'Not authenticated. Please login first.' });
  }

  const charName = msg.name;
  if (!charName) {
    return send(ws, { type: 'ERROR', message: 'No character name provided.' });
  }

  const char = await DB.getCharacter(charName);
  if (!char) {
    return send(ws, { type: 'ERROR', message: 'Character not found.' });
  }

  // Verify this character belongs to the authenticated account
  // (getCharacter doesn't return account_id, so we verify via the list)
  const characters = await DB.getCharactersByAccount(auth.accountId);
  const owns = characters.some(c => c.name === char.name);
  if (!owns) {
    return send(ws, { type: 'ERROR', message: 'That character does not belong to your account.' });
  }

  // Check if character is already online and boot them
  for (const [existingWs, existingSession] of sessions.entries()) {
    if (existingSession.char.id === char.id) {
      console.log(`[ENGINE] Kicking existing session for ${char.name}`);
      send(existingWs, { type: 'ERROR', message: 'You have been disconnected because another connection has logged into this character.' });
      existingWs.close();
      sessions.delete(existingWs);
    }
  }

  const session = await createSession(ws, char);
  
  // Safety: If inventory is empty, grant starter gear
  if (session.inventory.length === 0) {
    const starterItems = STARTER_GEAR[char.class] || STARTER_GEAR.warrior;
    for (const gear of starterItems) {
      await DB.addItem(char.id, gear.itemId, 1, gear.slot);
    }
    session.inventory = await DB.getInventory(char.id);
    console.log(`[ENGINE] Granted missing starter gear to ${char.name}.`);
  }

  console.log(`[ENGINE] ${char.name} entered world (level ${char.level} ${char.class}).`);
  sendFullState(session);
}

async function handleDeleteCharacter(ws, msg) {
  const auth = authSessions.get(ws);
  if (!auth) {
    return send(ws, { type: 'ERROR', message: 'Not authenticated.' });
  }

  const charName = msg.name;
  if (!charName) {
    return send(ws, { type: 'ERROR', message: 'No character name provided.' });
  }

  // Verify ownership
  const characters = await DB.getCharactersByAccount(auth.accountId);
  const target = characters.find(c => c.name === charName);
  if (!target) {
    return send(ws, { type: 'ERROR', message: 'Character not found or does not belong to your account.' });
  }

  // Delete from DB
  const eqemuDB = require('./eqemu_db');
  try {
    await eqemuDB.deleteCharacter(target.id);
  } catch (e) {
    return send(ws, { type: 'ERROR', message: 'Failed to delete character.' });
  }

  console.log(`[ENGINE] Character '${charName}' (id=${target.id}) deleted from account '${auth.accountName}'.`);

  // Send updated character list
  const updatedChars = await DB.getCharactersByAccount(auth.accountId);
  send(ws, { type: 'CHARACTER_DELETED', name: charName, characters: updatedChars });
}

// Authentic EQ deity names
const DEITY_NAMES = {
  201: 'Bertoxxulous', 202: 'Brell Serilis', 203: 'Cazic-Thule', 204: 'Erollisi Marr',
  205: 'Bristlebane', 206: 'Innoruuk', 207: 'Karana', 208: 'Mithaniel Marr',
  209: 'Prexus', 210: 'Quellious', 211: 'Rallos Zek', 212: 'Rodcet Nife',
  213: 'Solusek Ro', 214: 'The Tribunal', 215: 'Tunare', 216: 'Veeshan',
  396: 'Agnostic'
};

async function handleRequestDeities(ws, msg) {
  const raceId = msg.raceId || 1;
  const classId = msg.classId || 1;
  
  const deityIds = await DB.getValidDeities(raceId, classId);
  const deities = deityIds.map(id => ({ id, name: DEITY_NAMES[id] || `Unknown (${id})` }));
  
  send(ws, { type: 'DEITY_LIST', deities, raceId, classId });
}

async function handleRequestCharCreateData(ws, msg) {
  const raceId = msg.raceId || 1;
  const eqemuDB = require('./eqemu_db');
  const data = await eqemuDB.getCharCreateData(raceId);

  // Attach deity names for the client
  for (const cls of data.classes) {
    cls.deityNames = cls.deities.map(id => ({ id, name: DEITY_NAMES[id] || `Unknown (${id})` }));
  }

  // Scan for real face variant GLBs: {code}_face1.glb, {code}_face2.glb, etc.
  const fs = require('fs');
  const path = require('path');
  const raceModelsPath = path.join(__dirname, '..', 'eqmud', 'Data', 'race_models.json');
  const charsDir = path.join(__dirname, '..', 'eqmud', 'Data', 'Characters');
  let faceCountMale = 1, faceCountFemale = 1;
  try {
    const raceModels = JSON.parse(fs.readFileSync(raceModelsPath, 'utf8'));
    const entry = raceModels[String(raceId)];
    if (entry) {
      const countFaces = (code) => {
        try {
          // 1. Classic races use texture swapping
          const texDir = path.join(charsDir, 'Textures');
          if (fs.existsSync(texDir)) {
            const files = fs.readdirSync(texDir);
            const pattern = new RegExp(`^${code}he00(\\d)1\\.png$`, 'i');
            let maxFace = 0;
            for (const f of files) {
              const match = f.match(pattern);
              if (match) {
                const faceIdx = parseInt(match[1], 10);
                if (faceIdx > maxFace) maxFace = faceIdx;
              }
            }
            if (maxFace > 0) return maxFace + 1; // 0 is base face
          }

          // 2. Iksar/Vah Shir use _faceX.glb
          const baseFiles = fs.readdirSync(charsDir);
          const facePattern = new RegExp(`^${code}_face(\\d+)\\.glb$`, 'i');
          const faceFiles = baseFiles.filter(f => facePattern.test(f));
          if (faceFiles.length > 0) {
            return faceFiles.length + 1; // base (0) + variants (1..N)
          }

          // 3. Frogloks use _0X.glb
          if (code === 'frm' || code === 'frf') {
            const frogPattern = new RegExp(`^${code}_0(\\d)\\.glb$`, 'i');
            const frogFiles = baseFiles.filter(f => frogPattern.test(f));
            if (frogFiles.length > 0) return frogFiles.length; // frm_00 to frm_08
          }

          return 1;
        } catch { return 1; }
      };
      faceCountMale = countFaces(entry.m);
      faceCountFemale = countFaces(entry.f);
    }
  } catch (e) {
    console.log('[ENGINE] Could not scan face variants:', e.message);
  }
  data.faceCountMale = faceCountMale;
  data.faceCountFemale = faceCountFemale;

  send(ws, { type: 'CHAR_CREATE_DATA', ...data });
  console.log(`[ENGINE] Sent char create data for race ${raceId}: ${data.classes.length} classes, faces: M=${faceCountMale} F=${faceCountFemale}.`);
}

async function handleLogin(ws, msg) {
  const char = await DB.getCharacter(msg.name || 'Hero');
  if (!char) {
    send(ws, { type: 'ERROR', message: 'Character not found. Send CREATE_CHARACTER.' });
    return;
  }

  // Check if character is already online and boot them
  for (const [existingWs, existingSession] of sessions.entries()) {
    if (existingSession.char.id === char.id) {
      console.log(`[ENGINE] Kicking existing session for ${char.name}`);
      send(existingWs, { type: 'ERROR', message: 'You have been disconnected because another connection has logged into this character.' });
      existingWs.close();
      sessions.delete(existingWs);
    }
  }

  const session = await createSession(ws, char);

  // Safety: If inventory is empty, grant starter gear (fixes migration issues)
  if (session.inventory.length === 0) {
    const STARTER_GEAR = require('./data/items').STARTER_GEAR;
    const starterItems = STARTER_GEAR[char.class] || STARTER_GEAR.warrior;
    for (const gear of starterItems) {
      await DB.addItem(char.id, gear.itemId, 1, gear.slot);
    }
    session.inventory = await DB.getInventory(char.id);
    console.log(`[ENGINE] Granted missing starter gear to ${char.name}.`);
  }

  // Migration: Grant missing racial vision skills to existing characters
  let visionChanged = false;
  const racialSkills = RACIAL_STARTING_SKILLS[char.race] || {};
  const visionSkillKeys = ['normal_vision', 'weak_normal_vision', 'infravision', 'ultravision', 'cat_eye', 'serpent_sight'];
  for (const vSkill of visionSkillKeys) {
    if (racialSkills[vSkill]) {
      const val = combat.getCharSkill(char, vSkill);
      if (val <= 0) {
        if (!char.skills) char.skills = {};
        char.skills[vSkill] = 1;
        visionChanged = true;
      }
    }
  }
  if (visionChanged) {
    await DB.saveCharacterSkills(char.id, char.skills);
    console.log(`[ENGINE] Migrated missing vision skills for ${char.name}.`);
  }

  // Mercenaries will be populated via the Hire NPC system later.
  // For now, ensure the array exists with empty slots.
  if (!session.char.mercenaries) {
    session.char.mercenaries = [null, null];
  }

  console.log(`[ENGINE] ${char.name} logged in (level ${char.level} ${char.class}).`);
  sendFullState(session);
}

async function handleCreateCharacter(ws, msg) {
  const auth = authSessions.get(ws);
  if (!auth) {
    return send(ws, { type: 'ERROR', message: 'Not authenticated. Please login first.' });
  }

  const name = msg.name || 'Hero';
  const charClass = msg.class || 'warrior';
  const race = msg.race || 'human';
  const deity = msg.deity || 396; // Default to Agnostic

  // Look up numeric IDs for validation
  const eqemuDB = require('./eqemu_db');
  const CLASSES_MAP = { warrior:1, cleric:2, paladin:3, ranger:4, shadow_knight:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
  const RACES_MAP = { human:1, barbarian:2, erudite:3, wood_elf:4, high_elf:5, dark_elf:6, half_elf:7, dwarf:8, troll:9, ogre:10, halfling:11, gnome:12, iksar:128, vah_shir:130, froglok:330 };
  const raceId = RACES_MAP[race] || 1;
  const classId = CLASSES_MAP[charClass] || 1;

  // Validate race/class/deity combo against the DB
  const createData = await eqemuDB.getCharCreateData(raceId);
  const classEntry = createData.classes.find(c => c.classId === classId);
  if (!classEntry) {
    return send(ws, { type: 'ERROR', message: `${race} cannot be a ${charClass}.` });
  }
  if (!classEntry.deities.includes(deity)) {
    return send(ws, { type: 'ERROR', message: `That deity is not available for this race/class combination.` });
  }

  // Use DB base stats + player-allocated bonus points
  const dbAlloc = classEntry.allocation;
  const totalPool = (dbAlloc.alloc_str || 0) + (dbAlloc.alloc_sta || 0) + (dbAlloc.alloc_dex || 0) +
                    (dbAlloc.alloc_agi || 0) + (dbAlloc.alloc_int || 0) + (dbAlloc.alloc_wis || 0) +
                    (dbAlloc.alloc_cha || 0);

  // Accept player-allocated stats if provided, otherwise use DB defaults
  let allocStr, allocSta, allocDex, allocAgi, allocInt, allocWis, allocCha;
  if (msg.stats && typeof msg.stats === 'object') {
    allocStr = Math.max(0, msg.stats.str || 0);
    allocSta = Math.max(0, msg.stats.sta || 0);
    allocDex = Math.max(0, msg.stats.dex || 0);
    allocAgi = Math.max(0, msg.stats.agi || 0);
    allocInt = Math.max(0, msg.stats.int || 0);
    allocWis = Math.max(0, msg.stats.wis || 0);
    allocCha = Math.max(0, msg.stats.cha || 0);
    const spent = allocStr + allocSta + allocDex + allocAgi + allocInt + allocWis + allocCha;
    if (spent > totalPool) {
      return send(ws, { type: 'ERROR', message: `You spent ${spent} stat points but only have ${totalPool}.` });
    }
  } else {
    // Use DB default allocation
    allocStr = dbAlloc.alloc_str || 0;
    allocSta = dbAlloc.alloc_sta || 0;
    allocDex = dbAlloc.alloc_dex || 0;
    allocAgi = dbAlloc.alloc_agi || 0;
    allocInt = dbAlloc.alloc_int || 0;
    allocWis = dbAlloc.alloc_wis || 0;
    allocCha = dbAlloc.alloc_cha || 0;
  }

  const finalStats = {
    str: dbAlloc.base_str + allocStr,
    sta: dbAlloc.base_sta + allocSta,
    agi: dbAlloc.base_agi + allocAgi,
    dex: dbAlloc.base_dex + allocDex,
    wis: dbAlloc.base_wis + allocWis,
    intel: dbAlloc.base_int + allocInt,
    cha: dbAlloc.base_cha + allocCha,
  };

  // Compute starting HP/mana from the classic EQ formulas
  const startHp = combat.calcMaxHP(charClass, 1, finalStats.sta);
  const startMana = combat.calcMaxMana(charClass, 1, finalStats);

  // Extract appearance fields from client
  const appearance = {
    gender:    msg.gender    || 0,
    face:      msg.face      || 0,
    hairStyle: msg.hairStyle || 0,
    hairColor: msg.hairColor || 0,
    beard:     msg.beard     || 0,
    beardColor:msg.beardColor|| 0,
    eyeColor:  msg.eyeColor  || 0,
  };

  const createResult = await DB.createCharacter(
     auth.accountId, name, charClass, race, deity,
     finalStats.str, finalStats.sta, finalStats.agi, finalStats.dex, finalStats.wis, finalStats.intel, finalStats.cha,
     startHp, startMana, appearance
  );

  if (createResult && createResult.error) {
    return send(ws, { type: 'ERROR', message: createResult.error });
  }

  const char = await DB.getCharacter(name);

  // Give starter gear
  const starterItems = STARTER_GEAR[charClass] || STARTER_GEAR.warrior;
  for (const gear of starterItems) {
    await DB.addItem(char.id, gear.itemId, 1, gear.slot);
  }

  // Give starter spells — canonical EQ guild master hand-out (1-2 spells only)
  // Players must buy/scribe additional spells from spell vendors
  const STARTER_SPELLS = {
    cleric:       ['minor_healing', 'strike'],
    wizard:       ['frost_bolt', 'minor_shielding'],
    necromancer:  ['lifetap', 'minor_shielding'],
    enchanter:    ['lull', 'minor_shielding'],
    magician:     ['flare', 'minor_shielding'],
    druid:        ['minor_healing', 'snare'],
    shaman:       ['minor_healing', 'inner_fire'],
    bard:         ['chant_of_battle'],
    ranger:       ['salve'],
    paladin:      ['salve'],
    shadow_knight:['spike_of_disease'],
    // Melee classes — no starting spells
    warrior:      [],
    monk:         [],
    rogue:        [],
  };

  const starterKeys = STARTER_SPELLS[charClass] || [];
  if (starterKeys.length > 0) {
    let slotIdx = 0;
    for (const key of starterKeys) {
      const spellDef = SpellDB.getByKey(key);
      if (spellDef) {
        DB.memorizeSpell(char.id, spellDef._key, slotIdx++);
      } else {
        console.warn(`[ENGINE] Starter spell '${key}' not found in spell DB for ${charClass}`);
      }
    }
    console.log(`[ENGINE] Gave ${slotIdx} starter spells to ${charClass} "${name}": ${starterKeys.join(', ')}`);
  }

  console.log(`[ENGINE] Created ${charClass} "${name}" (${race}) on account '${auth.accountName}' with stats STR=${finalStats.str} STA=${finalStats.sta} AGI=${finalStats.agi} DEX=${finalStats.dex} WIS=${finalStats.wis} INT=${finalStats.intel} CHA=${finalStats.cha}.`);

  // Apply racial starting skill bonuses (e.g., Dwarves +10 Mining)
  const racialSkills = RACIAL_STARTING_SKILLS[race];
  if (racialSkills) {
    await DB.saveCharacterSkills(char.id, racialSkills);
    console.log(`[ENGINE] Applied racial skill bonuses for ${race}: ${JSON.stringify(racialSkills)}`);
  }

  // Send updated character list back to character select
  const characters = await DB.getCharactersByAccount(auth.accountId);
  send(ws, { type: 'CHARACTER_CREATED', name: char.name, characters });
}

function handleDoorClick(session, msg) {
  const doorId = msg.door_id;
  console.log(`[ENGINE] ${session.char.name} interacted with door ${doorId} in ${session.char.zoneId}`);

  const zone = zoneInstances[session.char.zoneId];
  if (!zone || !zone.doors) return;

  // Find the clicked door using its primary key 'id'
  console.log(`[ENGINE] Searching for door with id ${doorId} (type: ${typeof doorId})`);
  const clickedDoor = zone.doors.find(d => d.id === doorId);
  if (!clickedDoor) {
    console.log(`[ENGINE] Failed to find door with id ${doorId}! Available ids: ${zone.doors.map(d => d.id).slice(0, 10).join(', ')}...`);
    return;
  }

  // Check if it triggers another door (like an elevator button or double doors)
  // triggerdoor links to the target's local zone 'doorid', NOT the primary key 'id'
  let doorsToToggle = [clickedDoor];
  if (clickedDoor.triggerdoor && clickedDoor.triggerdoor > 0) {
    const triggered = zone.doors.find(d => d.doorid === clickedDoor.triggerdoor);
    if (triggered && triggered.id !== clickedDoor.id) {
      doorsToToggle.push(triggered);
    }
  }

  for (const door of doorsToToggle) {
    // Toggle state using the primary key 'id'
    let doorState = zone.doorStates[door.id];
    if (!doorState) {
      doorState = { isOpen: false, closeTimer: null };
      zone.doorStates[door.id] = doorState;
    }

    // Toggle it
    doorState.isOpen = !doorState.isOpen;
    console.log(`[ENGINE] Door ${door.id} (${door.name}) state changed to ${doorState.isOpen}`);

    // Broadcast to all players in the zone using the primary key 'id'
    const payload = JSON.stringify({
      type: 'DOOR_STATE_CHANGE',
      doorId: door.id,
      isOpen: doorState.isOpen
    });

    for (const [, client] of sessions) {
      if (client.char && client.char.zoneId === session.char.zoneId && client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }

    // Auto-close doors after 15 seconds (standard EQ logic for both lifts and swinging doors)
    if (doorState.closeTimer) clearTimeout(doorState.closeTimer);
    
    // Only auto-close if it just opened
    if (doorState.isOpen) {
      doorState.closeTimer = setTimeout(() => {
        if (zone.doorStates[door.id]) {
          zone.doorStates[door.id].isOpen = false;
          const closePayload = JSON.stringify({
            type: 'DOOR_STATE_CHANGE',
            doorId: door.id,
            isOpen: false
          });
          for (const [, client] of sessions) {
            if (client.char && client.char.zoneId === session.char.zoneId && client.ws.readyState === 1) {
              client.ws.send(closePayload);
            }
          }
        }
      }, 15000); // 15 seconds
    }
  }
}

function handleSit(session) {
  if (session.autoFight) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must stop attacking before sitting.' }]);
  }
  session.char.state = 'medding';
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You sit down and begin to rest.' }]);
  sendStatus(session);
}

function handleStartCombat(session) {
  if (session.char.state === 'medding') return;
  session.combatTarget = { type: 'NPC', target: null };
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Auto attack is on.` }]);
  CombatSystem.processPlayerCombatTurn(session);
}

function handleStartRanged(session) {
  if (session.char.state === 'medding') return;
  // Stub for ranged combat until fully implemented
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Auto fire on.` }]);
}

function handleStopRanged(session) {
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Auto fire off.` }]);
}

function handleStand(session) {
  session.char.state = 'standing';
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You stand up.' }]);
  sendStatus(session);
}

function handleStartCombat(session) {
  if (session.char.state === 'medding') {
    session.char.state = 'standing';
  }

  // Only engage if we already have a combat target set via ATTACK_TARGET
  if (session.combatTarget && !session.inCombat) {
    session.inCombat = true;
    session.autoFight = true;
    // Don't set mob.target here — mob only aggros when first melee hit lands in range
    session.attackTimer = 0;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You engage ${session.combatTarget.name}!` }]);
  } else if (!session.combatTarget) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have no target to attack.' }]);
  }
  sendStatus(session);
}

function handleStopCombat(session) {
  session.autoFight = false;
  session.inCombat = false;
  session.combatTarget = null;
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cease your attack.' }]);
  sendStatus(session);
}

function handleSetTarget(session, msg) {
  const targetId = msg.targetId;
  if (!targetId) return;

  const mobId = targetId.startsWith('mob_') ? targetId.substring(4) : targetId;
  const zone = zoneInstances[session.char.zoneId];
  if (!zone || !zone.liveMobs) return;

  // Check if targeting a mining node
  if (targetId.startsWith('node_') && zone.liveNodes) {
    const node = zone.liveNodes.find(n => n.id === targetId && n.alive);
    if (node) {
      session.miningTarget = node;
      session.combatTarget = null; // Can't combat-target a rock
      send(session.ws, {
        type: 'TARGET_UPDATE',
        target: {
          id: node.id,
          name: node.name,
          hp: node.hp,
          maxHp: node.maxHp,
          level: node.tier,
          type: 'mining_node',
        },
      });
      return;
    }
  }

  session.miningTarget = null; // Clear mining target when targeting a mob

  // Check if targeting a player
  if (targetId.startsWith('player_')) {
    const pId = parseInt(targetId.substring(7));
    let targetSession = null;
    for (const [, s] of sessions) {
      if (s.char && s.char.id === pId && s.char.zoneId === session.char.zoneId) {
        targetSession = s;
        break;
      }
    }
    
    if (targetSession) {
      session.combatTarget = targetSession;
      send(session.ws, {
        type: 'TARGET_UPDATE',
        target: {
          id: targetId,
          name: targetSession.char.name,
          hp: targetSession.char.hp,
          maxHp: targetSession.char.maxHp || 100, // Should use effective stats, but this is a fallback
          level: targetSession.char.level,
          type: 'player',
          pvpFaction: targetSession.char.pvpFaction || 0
        },
      });
      sendStatus(session);
      return;
    }
  }

  let mob = zone.liveMobs.find(m => m.id === mobId || m.id === targetId);
  if (mob) {
    // Always update target, even during combat, so auto-attack switches
    session.combatTarget = mob;
    send(session.ws, {
      type: 'TARGET_UPDATE',
      target: {
        id: mob.id,
        name: mob.name,
        hp: mob.hp,
        maxHp: mob.maxHp,
        level: mob.level,
        type: mob.isPet ? 'pet' : (mob.npcType === NPC_TYPES.MOB ? 'enemy' : 'npc'),
      },
    });
    sendStatus(session);
    return;
  }

  // Check if targeting a corpse
  if (zone.corpses) {
      let corpse = zone.corpses.find(c => c.id === mobId || c.id === targetId);
      if (corpse) {
          session.combatTarget = corpse;
          send(session.ws, {
              type: 'TARGET_UPDATE',
              target: {
                  id: corpse.id,
                  name: corpse.name,
                  hp: 0,
                  maxHp: 100,
                  level: corpse.level,
                  type: 'corpse',
              },
          });
          sendStatus(session);
          return;
      }
  }
}

function handleClearTarget(session) {
  // If actively fighting, stop combat first
  if (session.autoFight) {
      handleStopCombat(session);
  }
  session.combatTarget = null;
  sendStatus(session);
}

function handleAttackTarget(session, msg) {
  const targetId = msg.targetId;
  if (!targetId) {
    // No target specified, fall back to auto-engage
    return handleStartCombat(session);
  }

  // targetId from the client is like "mob_a_fire_beetle_1234_ab12"
  // Strip the "mob_" prefix to get the actual mob ID
  const mobId = targetId.startsWith('mob_') ? targetId.substring(4) : targetId;

  const zone = zoneInstances[session.char.zoneId];
  if (!zone) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'There is nothing to fight here.' }]);
    return;
  }

  let targetEntity = null;

  if (targetId.startsWith('player_')) {
    const pId = parseInt(targetId.substring(7));
    for (const [, s] of sessions) {
      if (s.char && s.char.id === pId && s.char.zoneId === session.char.zoneId) {
        targetEntity = s;
        break;
      }
    }
  } else {
    if (zone.liveMobs) {
      targetEntity = zone.liveMobs.find(m => m.id === mobId || m.id === targetId);
    }
  }
  
  if (!targetEntity) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your target is no longer available.' }]);
    return;
  }

  // Player PvP Check
  if (targetEntity.char) { // It's a player session
    if (!CombatSystem.canInteract(session, targetEntity, false)) {
       sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot attack that player!' }]);
       return;
    }
  } else {
    // Prevent attacking non-mob NPCs (merchants, quest givers, etc.)
    if (targetEntity.npcType && targetEntity.npcType !== NPC_TYPES.MOB) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot attack ${targetEntity.name}. Try hailing them instead.` }]);
      return;
    }

    if (targetEntity.target && targetEntity.target !== session) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${targetEntity.name} is already engaged by another player.` }]);
      return;
    }
  }

  session.inCombat = true;
  session.autoFight = true;
  session.combatTarget = targetEntity;

  // NOTE: Do NOT set mob.target here - mob only becomes aggressive
  // when the player's first melee swing actually goes through in range.
  
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Auto attack is on.` }]);
  CombatSystem.processPlayerCombatTurn(session);

}

function engageNextMob(session) {
  const zone = zoneInstances[session.char.zoneId];
  if (!zone || zone.liveMobs.length === 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'There is nothing to fight here.' }]);
    return false;
  }

  // Only auto-engage hostile mobs, skip NPCs
  const mob = zone.liveMobs.find(m => m.target === null && (m.roomId === session.char.roomId || !m.roomId) && (!m.npcType || m.npcType === NPC_TYPES.MOB));
  if (!mob) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'All targets are engaged.' }]);
    return false;
  }

  session.inCombat = true;
  session.combatTarget = mob;
  mob.target = session;
  session.attackTimer = 0;

  sendCombatLog(session, [{ event: 'MESSAGE', text: `You engage ${mob.name}!` }]);
  sendStatus(session);
  return true;
}

function handleSpellInspect(session, msg) {
  let targetSpellId = msg.spellId;

  if (msg.spellName) {
    const SpellDB = require('./data/spellDatabase');
    const spellDef = SpellDB.getByName(msg.spellName);
    if (spellDef) {
      targetSpellId = spellDef.id;
    }
  }

  if (msg.itemId) {
    const def = ItemDB.getById(msg.itemId) || ITEMS[msg.itemId] || {};
    if (def.scrolleffect > 0) {
      targetSpellId = def.scrolleffect;
    }
  }

  if (targetSpellId) {
    const spellDef = SPELLS[targetSpellId] || SPELLS[String(targetSpellId)];
    if (spellDef) {
      send(session.ws, {
        type: 'SPELL_DETAILS',
        spell: {
          spellId: targetSpellId,
          name: spellDef.name || 'Unknown Spell',
          manaCost: spellDef.manaCost || 0,
          castTime: spellDef.castTime || 1.5,
          target: spellDef.targetType ? spellDef.targetType.name : (spellDef.target || 'self'),
          effect: spellDef.effect || 'unknown',
          level: spellDef.level || 1,
          description: spellDef.description || '',
          memIcon: spellDef.visual ? spellDef.visual.memIcon : 0,
          icon: spellDef.visual ? spellDef.visual.icon : 0,
          skill: spellDef.skill ? spellDef.skill.name : 'Unknown',
          range: spellDef.range ? spellDef.range.range : 0,
          duration: spellDef.duration || 0,
          reflectable: spellDef.properties ? (spellDef.properties.reflectable > 0) : false,
          spellLine: spellDef.visual ? (spellDef.visual.spellAffectName || '') : '',
        }
      });
    }
  }
}

async function handleCastSpell(session, msg) {
  const slotIndex = msg.slot;
  const isMelody = msg.isMelody === true;

  // If manual cast, cancel any active melody
  if (!isMelody && session.melody) {
      session.melody = null;
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You stop your melody to cast a spell.' }]);
  }

  const spellRow = session.spells.find(s => s.slot === slotIndex);
  if (!spellRow) {
      if (isMelody) {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `Melody interrupted: No spell in slot ${slotIndex + 1}.` }]);
          session.melody = null;
      }
      return;
  }

  const spellDef = SPELLS[spellRow.spell_key];
  if (!spellDef) return;

  // Can't cast while already casting
  if (session.casting) {
    if (session.casting.spellDef?.derived?.isBardSong) {
        interruptCasting(session, 'You change your tune.');
    } else {
        return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are already casting a spell!' }]);
    }
  }

  const spellsSystem = require('./systems/spells');
  const eligibleFocuses = spellsSystem.getEligibleFocusEffects(session, spellDef);

  let manaCostMod = 0;
  let castTimeMod = 0;

  for (const focus of eligibleFocuses) {
     for (const e of focus.effects) {
         if (e.spa === 104 && e.base > 0) { // Mana preservation
             const val = Math.floor(Math.random() * e.base) + 1;
             if (val > manaCostMod) manaCostMod = val;
         }
         else if (e.spa === 127 && e.base > 0) { // Spell Haste
             const val = Math.floor(Math.random() * e.base) + 1;
             if (val > castTimeMod) castTimeMod = val;
         }
     }
  }

  let finalManaCost = spellDef.manaCost || 0;
  if (manaCostMod > 0) {
      finalManaCost = Math.floor(finalManaCost * (1.0 - (manaCostMod / 100.0)));
      if (finalManaCost < 1) finalManaCost = 1;
  }

  if (session.char.mana < finalManaCost) {
    if (isMelody) session.melody = null;
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Insufficient mana.' }]);
  }
  if (session.char.state === 'medding') {
    if (isMelody) session.melody = null;
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must stand before casting!' }]);
  }

  // Range check for offensive spells
  const spellRange = spellDef.range?.range || 200;
  if (spellDef.target === 'enemy') {
    if (!session.combatTarget) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must have a target to cast that spell.' }]);
    }
    // PvP Check for detrimental
    if (session.combatTarget.char && !CombatSystem.canInteract(session, session.combatTarget, false)) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot cast offensive spells on this target!' }]);
    }
    // Check distance to target mob
    const mob = session.combatTarget;
    if (mob.x != null && session.char.x != null) {
      const dx = session.char.x - mob.x;
      const dy = session.char.y - mob.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > spellRange * spellRange) {
        return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your target is out of range.' }]);
      }
    }
  }

  // Calculate cast time in seconds (EQ data stores milliseconds)
  let castTimeSec = (spellDef.timing?.castTime || 1500) / 1000;
  if (castTimeMod > 0) {
      castTimeSec = castTimeSec * (1.0 - (castTimeMod / 100.0));
  }

  // Deduct mana up front (classic EQ behavior)
  session.char.mana -= finalManaCost;

  // Casting breaks sneak and hide
  MovementSystem.breakSneak(session);
  MovementSystem.breakHide(session);

  // Record cast-start position for movement interruption detection
  const castStartPos = { x: session.char.x || 0, y: session.char.y || 0 };

  // Instant-cast spells (0 cast time) fire immediately
  if (castTimeSec <= 0) {
    await applySpellEffect(session, spellDef, spellRow.spell_key);
    session.ws.send(JSON.stringify({ type: 'CAST_COMPLETE', spellName: spellDef.name }));
    sendStatus(session);
    return;
  }

  // Start casting state
  session.casting = {
    spellDef,
    spellKey: spellRow.spell_key,
    slotIndex,
    castTime: castTimeSec,
    elapsed: 0,
    startPos: castStartPos,
  };

  // Notify client to show cast bar
  session.ws.send(JSON.stringify({
    type: 'CAST_START',
    spellName: spellDef.name,
    castTime: castTimeSec,
    slot: slotIndex,
    animType: spellDef.castingAnimation || 44
  }));

  sendCombatLog(session, [{ event: 'MESSAGE', text: `You begin casting ${spellDef.name}.` }]);
  sendStatus(session);
}

/**
 * Process ongoing casting each tick.
 * Called from the main game loop for every session.
 */
async function processCasting(session, dt) {
  if (!session.casting) return;

  session.casting.elapsed += dt;

  // Check if cast is complete
  if (session.casting.elapsed >= session.casting.castTime) {
    const { spellDef, spellKey, slotIndex } = session.casting;
    session.casting = null;

    await applySpellEffect(session, spellDef, spellKey);
    session.ws.send(JSON.stringify({ type: 'CAST_COMPLETE', spellName: spellDef.name }));
    sendStatus(session);

    // Auto-recast bard songs (twisting pulse)
    if (spellDef.derived?.isBardSong && session.char.state !== 'sitting' && session.char.state !== 'medding') {
        if (session.melody && session.melody.active) {
            playNextMelodySong(session);
        } else {
            const nextCastTime = 3.0; // Standard 3 second pulse
            session.casting = {
                spellDef,
                spellKey,
                slotIndex: slotIndex !== undefined ? slotIndex : -1,
                castTime: nextCastTime,
                elapsed: 0,
                startPos: { x: session.char.x, y: session.char.y, z: session.char.z }
            };
            session.ws.send(JSON.stringify({
                type: 'CAST_START',
                spellName: spellDef.name,
                castTime: nextCastTime,
                slot: slotIndex !== undefined ? slotIndex : -1,
                animType: spellDef.castingAnimation || 44
            }));
        }
    }
  }
}

async function handleMelody(session, msg) {
  if (session.char.class !== 'bard') {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Only bards can use /melody.' }]);
  }
  
  const parts = msg.slots.split(' ').map(s => parseInt(s, 10) - 1).filter(s => !isNaN(s) && s >= 0 && s < 8);
  if (parts.length === 0) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Usage: /melody <slot1> <slot2> ... (e.g. /melody 1 2 3 4)' }]);
  }

  session.melody = {
    active: true,
    playlist: parts,
    currentIndex: 0
  };

  sendCombatLog(session, [{ event: 'MESSAGE', text: `Melody started: ${parts.map(p => p + 1).join(', ')}` }]);

  if (!session.casting) {
    playNextMelodySong(session);
  } else if (session.casting.spellDef?.derived?.isBardSong) {
    interruptCasting(session, 'You change your tune.');
    playNextMelodySong(session);
  }
}

function handleStopMelody(session) {
  if (session.melody) {
    session.melody = null;
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You stop your melody.' }]);
  }
  if (session.casting && session.casting.spellDef?.derived?.isBardSong) {
    interruptCasting(session, 'You stop singing.');
  }
}

async function playNextMelodySong(session) {
  if (!session.melody || !session.melody.active || session.melody.playlist.length === 0) return;
  if (session.char.state === 'sitting' || session.char.state === 'medding') {
     session.melody = null;
     return;
  }
  
  const nextSlot = session.melody.playlist[session.melody.currentIndex];
  session.melody.currentIndex = (session.melody.currentIndex + 1) % session.melody.playlist.length;
  
  await handleCastSpell(session, { slot: nextSlot, isMelody: true });
}

/**
 * Attempt to interrupt a casting spell (called when player takes damage).
 * Classic EQ interruption: roughly 75% base chance, modified by level difference.
 */
function tryInterruptCasting(session, source) {
  if (!session.casting) return;

  // Base 75% interrupt chance, reduced by level (higher level = harder to interrupt)
  const interruptChance = Math.max(0.25, 0.75 - (session.char.level * 0.005));
  if (Math.random() < interruptChance) {
    interruptCasting(session, `Your spell is interrupted!`);
  }
}

/**
 * Force-interrupt the current cast (movement, death, etc.)
 */
function interruptCasting(session, message) {
  if (!session.casting) return;
  const spellName = session.casting.spellDef.name;
  session.casting = null;

  session.ws.send(JSON.stringify({ type: 'CAST_INTERRUPTED', spellName }));
  sendCombatLog(session, [{ event: 'MESSAGE', text: message || 'Your spell is interrupted!' }]);
  sendStatus(session);
}

async function applySpellEffect(session, spellDef, spellKey) {
  // Determine visual target based on beneficial/detrimental status
  let targetId = `player_${session.char.id}`;
  const isDetrimental = !spellDef.goodEffect;

  if (isDetrimental && session.combatTarget) {
      targetId = session.combatTarget.char ? `player_${session.combatTarget.char.id}` : session.combatTarget.id;
  } else if (!isDetrimental && session.combatTarget) {
      if (session.combatTarget.char) {
          const combat = require('./systems/combat');
          if (combat.canInteract(session, session.combatTarget, true)) {
              targetId = `player_${session.combatTarget.char.id}`;
          }
      } else if (session.combatTarget.npcType === 'pet') {
          targetId = session.combatTarget.id;
      }
  }

  // Broadcast SPELL_ANIMATION to everyone in the zone
  const spellAnimId = spellDef.visual && spellDef.visual.spellAffectIndex !== undefined ? spellDef.visual.spellAffectIndex : -1;
  
  if (spellAnimId !== -1) {
    let visualTargets = [targetId];

    // Distribute to group members if it's a song or group buff
    if (spellDef.derived?.isBardSong || [3, 4, 41].includes(spellDef.targetType?.id) || spellDef.targetType?.name === 'groupPet') {
        if (session.group && session.group.members) {
            const rangeSq = (spellDef.range?.aoeRange || 50) ** 2;
            visualTargets = session.group.members.filter(m => {
                const dx = (m.char.x || 0) - (session.char.x || 0);
                const dy = (m.char.y || 0) - (session.char.y || 0);
                const dz = (m.char.z || 0) - (session.char.z || 0);
                return (dx*dx + dy*dy + dz*dz) <= rangeSq || m === session;
            }).map(m => `player_${m.char.id}`);
        }
    }

    for (const vTarget of visualTargets) {
        const payload = JSON.stringify({
          type: 'SPELL_ANIMATION',
          casterId: `player_${session.char.id}`,
          targetId: vTarget,
          spellAnimId: spellAnimId,
          spellName: spellDef.name,
          isAura: spellDef.duration > 0
        });
        
        for (const [ws, client] of sessions) {
          if (client.char && client.char.zoneId === session.char.zoneId && ws.readyState === 1) {
            try { ws.send(payload); } catch(e) {}
          }
        }
    }
  }

  return SpellSystem.applySpellEffect(session, spellDef, spellKey);
}

function handleAbility(session, msg) {
  const ability = (msg.ability || '').toLowerCase().trim();
  const char = session.char;

  // ── Non-combat utility skills (no combat/target required) ──
  if (ability === 'hide') return MovementSystem.handleHide(session, { hiding: true });
  if (ability === 'sneak') return MovementSystem.handleUpdateSneak(session, { sneaking: true });

  if (ability === 'sensehead' || ability === 'sense_heading' || ability === 'sense heading') {
    return handleSenseHeading(session);
  }

  if (ability === 'tracking') {
    const skill = combat.getCharSkill(char, 'tracking');
    if (skill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You have no idea how to track.` }]);
    }
    combat.trySkillUp(session, 'tracking');
    flushSkillUps(session);
    return handleGetTrackingList(session);
  }

  if (ability === 'forage') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['forage'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before foraging again.` }]);
    }
    if (session.inCombat) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You can't forage while in combat!` }]);
    }
    const skill = combat.getCharSkill(char, 'forage');
    if (skill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You have no idea how to forage.` }]);
    }
    const roll = Math.floor(Math.random() * 200) + 1;
    const success = roll <= (skill + 25);
    combat.trySkillUp(session, 'forage');

    if (success) {
      // Zone-aware forage table — common generic items
      const FORAGE_TABLE = [
        { name: 'Roots', weight: 0.1 },
        { name: 'Berries', weight: 0.1 },
        { name: 'Pod of Water', weight: 0.4 },
        { name: 'Fishing Grubs', weight: 0.1 },
        { name: 'Vegetables', weight: 0.2 },
        { name: 'Fruit', weight: 0.2 },
        { name: 'Rabbit Meat', weight: 0.3 },
      ];
      const item = FORAGE_TABLE[Math.floor(Math.random() * FORAGE_TABLE.length)];
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You have foraged ${item.name}![/color]` }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You fail to find anything useful.` }]);
    }
    session.abilityCooldowns['forage'] = 10;
    flushSkillUps(session);
    return;
  }

  if (ability === 'mend') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['mend'] > 0) {
      const remaining = Math.ceil(session.abilityCooldowns['mend']);
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `Mend is not ready yet. (${remaining}s)` }]);
    }
    // Monk self-heal: 25% base, can crit for 50%, can fail or crit-fail
    const maxHp = session.effectiveStats.hp;
    const mendRoll = Math.random();
    if (mendRoll < 0.05) {
      const dmg = Math.floor(maxHp * 0.05);
      char.hp = Math.max(1, char.hp - dmg);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=red]You attempt to mend your wounds but make them worse! (${dmg} damage)[/color]` }]);
    } else if (mendRoll < 0.25) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You attempt to mend your wounds but fail.` }]);
    } else if (mendRoll < 0.85) {
      const heal = Math.floor(maxHp * 0.25);
      char.hp = Math.min(maxHp, char.hp + heal);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You mend your wounds for ${heal} hit points.[/color]` }]);
    } else {
      const heal = Math.floor(maxHp * 0.50);
      char.hp = Math.min(maxHp, char.hp + heal);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You expertly mend your wounds for ${heal} hit points![/color]` }]);
    }
    session.abilityCooldowns['mend'] = 360; // 6 minute cooldown like classic EQ
    sendStatus(session);
    return;
  }

  if (ability === 'track') {
    const skill = combat.getCharSkill(char, 'tracking');
    if (skill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't know how to track.` }]);
    }
    // List mobs and players within tracking range (skill * 3 units)
    const trackRange = skill * 3;
    const instance = zoneInstances[char.zoneId];
    const results = [];
    if (instance) {
      for (const mob of instance.liveMobs) {
        const dist = getDistance(mob.x, mob.y, char.x, char.y);
        if (dist <= trackRange) {
          results.push({ name: mob.name, dist: Math.floor(dist) });
        }
      }
    }
    // Other players in the zone
    for (const [, other] of sessions) {
      if (other.char && other.char.zoneId === char.zoneId && other.char.id !== char.id) {
        const dist = getDistance(other.char.x, other.char.y, char.x, char.y);
        if (dist <= trackRange) {
          results.push({ name: `(PC) ${other.char.name}`, dist: Math.floor(dist) });
        }
      }
    }
    results.sort((a, b) => a.dist - b.dist);
    combat.trySkillUp(session, 'tracking');
    flushSkillUps(session);

    if (results.length === 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't sense any nearby creatures.` }]);
    }
    const lines = results.slice(0, 20).map(r => ({ event: 'MESSAGE', text: `  [color=cyan]${r.name}[/color] (${r.dist} units)` }));
    lines.unshift({ event: 'MESSAGE', text: `[color=yellow]-- Tracking Results (${results.length}) --[/color]` });
    return sendCombatLog(session, lines);
  }

  if (ability === 'bindwound' || ability === 'bind_wound' || ability === 'bind wound') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['bindwound'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before binding wounds again.` }]);
    }
    if (session.inCombat) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You can't bind wounds while in combat!` }]);
    }
    const maxHp = session.effectiveStats.hp;
    // Can only heal up to 50% HP via bind wound (classic EQ limit without AAs)
    if (char.hp >= Math.floor(maxHp * 0.5)) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You are not wounded enough to bind wounds.` }]);
    }
    const bwSkill = combat.getCharSkill(char, 'bind_wound');
    const healAmount = Math.max(1, Math.floor(bwSkill / 4) + Math.floor(Math.random() * 4));
    char.hp = Math.min(Math.floor(maxHp * 0.5), char.hp + healAmount);
    combat.trySkillUp(session, 'bind_wound');
    flushSkillUps(session);
    session.abilityCooldowns['bindwound'] = 15;
    sendStatus(session);
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You bind your wounds and heal ${healAmount} hit points.[/color]` }]);
  }

  if (ability === 'fishing') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['fishing'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before fishing again.` }]);
    }
    const fishSkill = combat.getCharSkill(char, 'fishing');
    const fishRoll = Math.floor(Math.random() * 200) + 1;
    combat.trySkillUp(session, 'fishing');
    flushSkillUps(session);
    session.abilityCooldowns['fishing'] = 12;
    if (fishRoll <= fishSkill + 10) {
      const catches = ['a Fish', 'a Tattered Cloth Sandal', 'a Rusty Dagger', 'a Fresh Fish', 'some Seaweed'];
      const caught = catches[Math.floor(Math.random() * catches.length)];
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You caught ${caught}![/color]` }]);
    }
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You didn't catch anything.` }]);
  }

  if (ability === 'begging') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['begging'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before begging again.` }]);
    }
    const begSkill = combat.getCharSkill(char, 'begging');
    const begRoll = Math.floor(Math.random() * 200) + 1;
    combat.trySkillUp(session, 'begging');
    flushSkillUps(session);
    session.abilityCooldowns['begging'] = 8;
    if (begRoll <= begSkill) {
      const copper = Math.floor(Math.random() * 3) + 1;
      if (!char.currency) char.currency = { platinum: 0, gold: 0, silver: 0, copper: 0 };
      char.currency.copper += copper;
      sendStatus(session);
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]Someone takes pity on you and gives you ${copper} copper.[/color]` }]);
    }
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You beg unsuccessfully.` }]);
  }

  if (ability === 'picklock') {
    const plSkill = combat.getCharSkill(char, 'pick_lock');
    if (plSkill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't know how to pick locks.` }]);
    }
    combat.trySkillUp(session, 'pick_lock');
    flushSkillUps(session);
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You attempt to pick the lock... but there is nothing to pick nearby.` }]);
  }

  // ── Vision Mode Toggle (non-combat) ──
  // Normalize: client sends display names with spaces, server uses underscore keys
  const abilityNormalized = ability.replace(/[\s-]+/g, '_');
  const visionAbilities = {
    'normal_vision': 'normal',
    'weak_normal_vision': 'normal_weak',
    'infravision': 'infravision',
    'ultravision': 'ultravision',
    'cat_eye': 'cateye',
    'serpent_sight': 'serpentsight',
  };
  if (visionAbilities[abilityNormalized]) {
    const skillVal = combat.getCharSkill(char, abilityNormalized);
    if (skillVal <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You do not possess ${ability.replace(/_/g, ' ')}.` }]);
    }
    const newVision = visionAbilities[abilityNormalized];
    session.activeVisionMode = newVision;
    const modeDef = VISION_MODES[newVision] || VISION_MODES.normal;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You focus your eyes. ${modeDef.description}` }]);
    sendStatus(session);
    return;
  }

  // ── Combat abilities (require active combat) ──
  if (!session.inCombat || !session.combatTarget) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You must be in combat to use ${msg.ability}.` }]);
  }
  
  if (!session.abilityCooldowns) session.abilityCooldowns = {};
  if (session.abilityCooldowns[msg.ability] > 0) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `Ability ${msg.ability} is not ready yet.` }]);
  }

  const mob = session.combatTarget;
  if (mob.char && !CombatSystem.canInteract(session, mob, false)) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot use offensive abilities on this target.` }]);
  }
  if (msg.ability === 'kick') {
    const dmg = combat.calcKickDamage(session);
    if (dmg > 0) {
       mob.hp -= dmg;
       sendCombatLog(session, [{ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmg, text: 'Kick!' }]);
    } else {
       sendCombatLog(session, [{ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Kick missed' }]);
    }
    session.abilityCooldowns[msg.ability] = 6;
  } else if (msg.ability === 'bash') {
    const dmg = combat.calcBashDamage(session);
    if (dmg > 0) {
       mob.hp -= dmg;
       sendCombatLog(session, [{ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmg, text: 'Bash!' }]);
    } else {
       sendCombatLog(session, [{ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Bash missed' }]);
    }
    session.abilityCooldowns[msg.ability] = 6;
  } else if (msg.ability === 'taunt') {
    const tauntSkill = combat.getCharSkill(char, 'taunt');
    const tauntRoll = Math.floor(Math.random() * 200) + 1;
    const tauntSuccess = tauntRoll <= (tauntSkill + 30);
    combat.trySkillUp(session, 'taunt');
    if (tauntSuccess) {
      // Lock aggro on this player — mob focuses on taunter
      mob.taunted = true;
      mob.tauntedBy = session;
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You taunt ${mob.name}, grabbing its attention![/color]` }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You try to taunt ${mob.name} but fail to get its attention.` }]);
    }
    session.abilityCooldowns[msg.ability] = 6;
  } else if (msg.ability === 'backstab') {
    const weapon = StatsSystem.getWeaponStats(char.inventory || []);
    const dmg = combat.calcBackstabDamage(session, weapon.damage);
    if (dmg > 0) {
      mob.hp -= dmg;
      sendCombatLog(session, [{ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmg, text: 'Backstab!' }]);
    } else {
      sendCombatLog(session, [{ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Backstab missed' }]);
    }
    session.abilityCooldowns[msg.ability] = 10;
  } else if (msg.ability === 'disarm') {
    const disarmSkill = combat.getCharSkill(char, 'disarm');
    const disarmRoll = Math.floor(Math.random() * 200) + 1;
    const disarmSuccess = disarmRoll <= (disarmSkill + 10);
    combat.trySkillUp(session, 'disarm');
    if (disarmSuccess && mob.maxDmg > 1) {
      // Temporarily halve the mob's damage for 30 seconds
      const origMax = mob.maxDmg;
      const origMin = mob.minDmg;
      mob.maxDmg = Math.floor(mob.maxDmg * 0.5);
      mob.minDmg = Math.max(1, Math.floor(mob.minDmg * 0.5));
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You disarm ${mob.name}![/color]` }]);
      // Restore after 30 seconds
      setTimeout(() => {
        if (mob) { mob.maxDmg = origMax; mob.minDmg = origMin; }
      }, 30000);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You fail to disarm ${mob.name}.` }]);
    }
    session.abilityCooldowns[msg.ability] = 60;
  }

  flushSkillUps(session);
}

function handleTactic(session, msg) {
  session.tactic = msg.tactic;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Combat tactic set to: ${msg.tactic}` }]);
}

// ── NPC Interaction Handlers ────────────────────────────────────────

async function handleHail(session, msg) {
  const char = session.char;
  const zone = zoneInstances[char.zoneId];

  // If no target, just hail into the void
  if (!session.combatTarget) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You say, 'Hail!'` }]);
    return;
  }

  const target = session.combatTarget;

  // Proximity check — must be within HAIL_RANGE
  const distSq = getDistanceSq(char.x, char.y, target.x, target.y);
  if (distSq > HAIL_RANGE * HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You are too far away to speak with ${target.name}.` }]);
    return;
  }

  // Turn NPC to face player (0-512 scale)
  let dx = char.x - target.x;
  let dy = char.y - target.y;
  let newHeading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
  if (newHeading < 0) newHeading += 512;
  target.heading = newHeading;

  const events = [];
  
  // Send Player's Hail text FIRST so it appears before the NPC responds
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You say, 'Hail, ${target.name}!'` }]);

  // All non-KOS NPCs will wave back
  send(session.ws, {
    type: 'EMOTE',
    charName: target.name,
    emote: 'wave',
    heading: target.heading
  });

  // Fire Quest Engine for 'Hail' text
  const zoneShortName = char.zoneId;
  const eData = { message: 'hail', joined: false, trade: {} };
  const actions = await QuestManager.triggerEvent(zoneShortName, target, char, 'EVENT_SAY', eData);
  
  if (actions && actions.length > 0) {
    processQuestActions(session, target, actions);
    return; // STOP execution here so we don't fall through to legacy handlers
  }

  // If it's a regular mob and no quest triggered, just regard indifferently
  if (!target.npcType || target.npcType === NPC_TYPES.MOB) {
    events.push({ event: 'MESSAGE', text: `${target.name} regards you indifferently.` });
    sendCombatLog(session, events);
    return;
  }

  switch (target.npcType) {
    case NPC_TYPES.MERCHANT: {
      // Hailing a merchant now only triggers quests/dialog, not the shop window
      // Shop window is handled by RIGHT_CLICK
      break;
    }

    case NPC_TYPES.QUEST: {
      const hailResponse = QuestDialogs.getHailResponse(target.key, char);
      if (hailResponse) {
        events.push({ event: 'NPC_SAY', npcName: target.name, text: hailResponse, keywords: QuestDialogs.extractKeywords(hailResponse) });
      } else {
        events.push({ event: 'MESSAGE', text: `${target.name} nods at you.` });
      }
      break;
    }

    case NPC_TYPES.TRAINER: {
      // Determine which class this trainer teaches
      const trainerClass = GUILD_MASTER_CLASS[target.eqClass];
      const playerClass = session.char.class;

      if (trainerClass && trainerClass !== playerClass) {
        events.push({ event: 'MESSAGE', text: `${target.name} says, 'I have nothing to teach you, ${session.char.name}. You should seek out your own guild master.'` });
        break;
      }

      events.push({ event: 'MESSAGE', text: `${target.name} says, 'Welcome, ${session.char.name}. I can train you in various skills.'` });

      // Build complete skill list for this class
      const skillList = [];
      const charSkills = session.char.skills || {};
      for (const [key, skillDef] of Object.entries(Skills)) {
        const classData = skillDef.classes[playerClass];
        if (!classData) continue;

        const currentValue = charSkills[key] || 0;
        const levelCap = Math.min(classData.capFormula(session.char.level), classData.maxCap);
        const rank = StatsSystem.getSkillRank(currentValue, classData.maxCap);
        const atCap = currentValue >= levelCap;
        const tooLowLevel = session.char.level < classData.levelGranted;

        let costCopper = 0;
        let costCoins = { pp: 0, gp: 0, sp: 0, cp: 0 };
        let canTrain = false;

        if (!atCap && !tooLowLevel) {
          canTrain = true;
          costCopper = StatsSystem.getTrainingCostCopper(currentValue);
          costCoins = StatsSystem.copperToCoins(costCopper);
        }

        skillList.push({
          key,
          name: skillDef.name,
          type: skillDef.type,
          value: currentValue,
          cap: levelCap,
          maxCap: classData.maxCap,
          rank,
          canTrain,
          costPp: canTrain ? costCoins.pp : null,
          costGp: canTrain ? costCoins.gp : null,
          costSp: canTrain ? costCoins.sp : null,
          costCp: canTrain ? costCoins.cp : null,
          costTotalCopper: canTrain ? costCopper : 0,
          levelGranted: classData.levelGranted,
        });
      }

      send(session.ws, {
        type: 'OPEN_TRAINER',
        npcId: target.id,
        npcName: target.name,
        trainerClass: trainerClass || playerClass,
        practices: session.char.practices || 0,
        copper: session.char.copper || 0,
        skills: skillList,
      });
      break;
    }

    case NPC_TYPES.BANK: {
      events.push({ event: 'MESSAGE', text: `${target.name} says, 'Welcome to the bank. How may I assist you?'` });
      send(session.ws, {
        type: 'OPEN_BANK',
        npcId: target.id,
        npcName: target.name,
        // TODO: retrieve player bank contents
        bankSlots: [],
      });
      break;
    }

    case NPC_TYPES.BIND: {
      events.push({ event: 'MESSAGE', text: `${target.name} says, 'Shall I bind your soul to this location? [bind]'` });
      break;
    }

    case NPC_TYPES.BLANK:
    default: {
      events.push({ event: 'MESSAGE', text: `${target.name} nods at you.` });
      break;
    }
  }

  if (events.length > 0) sendCombatLog(session, events);
}



function processQuestActions(session, npc, actions) {
  const events = [];
  for (const act of actions) {
    switch (act.action) {
      case 'say':
      case 'shout':
      case 'emote':
        // Send to the triggering player's UI (white text with clickable brackets)
        events.push({ event: 'NPC_SAY', npcName: npc.name, text: act.msg || act.text, keywords: [] });
        
        // Broadcast to spatial channel for bystanders to overhear (blue text, no brackets)
        // We set id to session.char.id so broadcastChat will skip the triggering player!
        const mockSession = { char: { id: session.char.id, name: npc.name, zoneId: npc.zoneId, x: npc.x, y: npc.y }, ws: null };
        ChatSystem.broadcastChat(mockSession, act.action === 'shout' ? 'shout' : 'say', act.msg || act.text, act.action === 'shout' ? 600 : 200);
        break;
      case 'message':
        events.push({ event: 'MESSAGE', text: act.text });
        break;
      case 'summonitem':
      case 'reward':
        if (act.item_id && act.item_id > 0) {
            events.push({ event: 'MESSAGE', text: `You receive an item!` });
        }
        if (act.exp && act.exp > 0) {
            events.push({ event: 'MESSAGE', text: `You gain experience!!` });
        }
        break;
      case 'anim':
        // Broadcast animation to zone
        broadcastToZone(npc.zoneId, { type: 'NPC_ANIM', id: npc.id, anim: act.anim });
        break;
      case 'cast':
        // Handle Soulbinder Bind Affinity (Spell ID: 2049)
        if (act.spellId === 2049) {
          session.char.bindX = session.char.x;
          session.char.bindY = session.char.y;
          session.char.bindZ = session.char.z;
          session.char.bindZoneId = session.char.zoneId;
          session.char.bindHeading = session.char.heading || 0;
          DB.updateCharacterBind(session.char);
          events.push({ event: 'MESSAGE', text: `You feel your soul bound to this location.` });
          
          broadcastToZone(npc.zoneId, { type: 'EMOTE', charName: npc.name, emote: 't04' });
          
          // Send particles to the player
          send(session.ws, { type: 'SPELL_ANIMATION', casterId: npc.id.toString(), targetId: 'You', spellAnimId: 42, isAura: false });
          // Broadcast particles to the rest of the zone
          const spellPayload = JSON.stringify({ type: 'SPELL_ANIMATION', casterId: npc.id.toString(), targetId: `player_${session.char.id}`, spellAnimId: 42, isAura: false });
          for (const [ws, other] of sessions) {
            if (other !== session && other.char && other.char.zoneId === npc.zoneId) {
              try { ws.send(spellPayload); } catch(e) {}
            }
          }
          
          // Force an instant save to DB
          DB.updateCharacterState(session.char);
        } else {
          // General NPC casting (assuming SpellSystem has a way, otherwise stub it)
          events.push({ event: 'MESSAGE', text: `${npc.name} begins to cast a spell.` });
          broadcastToZone(npc.zoneId, { type: 'EMOTE', charName: npc.name, emote: 't04' });
          send(session.ws, { type: 'SPELL_ANIMATION', casterId: npc.id.toString(), targetId: 'You', spellAnimId: 42, isAura: false });
          const spellPayload = JSON.stringify({ type: 'SPELL_ANIMATION', casterId: npc.id.toString(), targetId: `player_${session.char.id}`, spellAnimId: 42, isAura: false });
          for (const [ws, other] of sessions) {
            if (other !== session && other.char && other.char.zoneId === npc.zoneId) {
              try { ws.send(spellPayload); } catch(e) {}
            }
          }
        }
        break;
    }
  }
  if (events.length > 0) sendCombatLog(session, events);
}

// ── Chat System extracted to systems/chat.js ──────────────────────
// ── Inventory System extracted to systems/inventory.js ──────────────────────




// ── Sneak/Hide Break Helpers ────────────────────────────────────────

/** Break sneak state (called when hit by spell/melee, or casting) */

/** Break hide state (called when moving without sneak, hit, casting) */

/** Broadcast an entity state change (sneak/hide) to other players in the zone */
function broadcastEntityState(session, msgType, extraFields) {
  const payload = JSON.stringify({
    type: msgType,
    id: `player_${session.char.id}`,
    ...extraFields
  });
  for (const [ws, other] of sessions) {
    if (other !== session && other.char && other.char.zoneId === session.char.zoneId) {
      try { ws.send(payload); } catch(e) {}
    }
  }
}

function broadcastToZone(zoneId, msg) {
  const payload = JSON.stringify(msg);
  for (const [ws, session] of sessions) {
    if (session.char && session.char.zoneId === zoneId) {
      try { ws.send(payload); } catch(e) {}
    }
  }
}

/** Broadcast mob movement to all players in the zone */
function broadcastMobMove(mob, zoneId) {
  const payload = JSON.stringify({
    type: 'MOB_MOVE',
    id: mob.id,
    x: mob.x,
    y: mob.y,
    z: mob.z || 0,
    heading: mob.heading || 0
  });
  for (const [ws, other] of sessions) {
    if (other.char && other.char.zoneId === zoneId) {
      try { ws.send(payload); } catch(e) {}
    }
  }
}

/** Flush pending skill-up messages */
function flushSkillUps(session) {
  if (session.skillUpMessages && session.skillUpMessages.length > 0) {
    const logs = session.skillUpMessages.map(m => ({
      event: 'MESSAGE',
      text: `[color=yellow]You have become better at ${m.skillName}! (${m.newLevel})[/color]`
    }));
    sendCombatLog(session, logs);
    session.skillUpMessages = [];
  }
}

// handleMove / getDirName — removed (legacy room-grid movement, not used by 3D client)


// ── Pet System ──────────────────────────────────────────────────────

/**
 * Spawn a summoned pet for a player session.
 * @param {Object} session - Player session
 * @param {Object} petDef - Entry from PET_SPELLS table
 * @param {Object} spellDef - The spell definition
 * @returns {{ pet: Object, events: Array }}
 */
function spawnPet(session, petDef, spellDef) {
  const events = [];
  const zoneId = session.char.zoneId;
  const zone = zoneInstances[zoneId];
  if (!zone) return { pet: null, events: [{ event: 'MESSAGE', text: 'You cannot summon a pet here.' }] };

  // Kill existing pet if any
  if (session.pet) {
    despawnPet(session, 'Your previous pet fades away.');
  }

  // Roll level within range
  const [minLvl, maxLvl] = petDef.levelRange;
  const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

  // Interpolate HP between hpRange
  const [minHp, maxHp] = petDef.hpRange;
  const hp = minLvl === maxLvl ? minHp : Math.floor(minHp + (maxHp - minHp) * ((level - minLvl) / Math.max(1, maxLvl - minLvl)));

  // Pick a name from the name pool
  const namePool = PET_NAMES[petDef.element] || PET_NAMES.generic;
  let petName;
  if (petDef.element === 'animation') {
    petName = `${session.char.name}'s Animation`;
  } else if (namePool.length > 0) {
    petName = namePool[Math.floor(Math.random() * namePool.length)];
  } else {
    petName = petDef.name || 'Pet';
  }

  // Determine race for rendering
  let petRace = petDef.race || 75;
  if (petDef.element === 'animation') {
    petRace = session.char.raceId || 1; // Animations match caster race
  }

  // Build pet skills based on level tier
  const petSkills = {};
  for (const [tierLevel, skills] of Object.entries(PET_SKILL_TIERS)) {
    if (level >= parseInt(tierLevel)) {
      for (const sk of skills) {
        petSkills[sk] = true;
      }
    }
  }
  // Fire pets don't get dodge/parry/doubleAttack
  if (petDef.element === 'fire') {
    delete petSkills.dodge;
    delete petSkills.parry;
    delete petSkills.doubleAttack;
    delete petSkills.doubleKickBash;
  }

  const pet = {
    id: `pet_${session.char.name}_${Date.now()}`,
    name: petName,
    ownerSession: session,
    ownerId: session.char.id,
    isPet: true,
    isCharmed: false,

    // Combat stats
    level: level,
    hp: hp,
    maxHp: hp,
    minDmg: petDef.minDmg,
    maxDmg: petDef.maxDmg,
    attackDelay: petDef.attackDelay || 3.0,
    attackTimer: 0,
    ac: petDef.ac || 0,
    race: petRace,
    gender: 0,
    npcType: NPC_TYPES.MOB, // So it renders, but isPet flag differentiates

    // Position (spawns near owner)
    x: (session.char.x || 0) + 3,
    y: (session.char.y || 0) + 3,
    z: session.char.z || 0,
    spawnX: session.char.x || 0,
    spawnY: session.char.y || 0,

    // AI state
    state: 'follow',       // follow | guard | sit
    guardX: null,
    guardY: null,
    target: null,
    hateList: [],          // [{mob, hate}]
    taunting: true,
    alive: true,

    // Regen
    regen: petSkills.fastRegen ? 30 : 6, // HP per 6-second tick
    regenTimer: 0,

    // Skills & innate spells
    skills: petSkills,
    innateSpells: petDef.innateSpells || [],
    innateSpellCooldowns: {},

    // Pet inventory (QoL: full player control)
    equipment: {},
    inventory: [],

    // Summoning info (for Reclaim Energy)
    summonManaCost: petDef.manaCost || spellDef.manaCost || 0,
    summonSpellId: spellDef.id || spellDef._spellId || 0,

    // Damage tracking for XP penalty
    totalDamageDealt: 0,
  };

  // Add pet to session and zone
  session.pet = pet;
  zone.liveMobs.push(pet);

  events.push({ event: 'MESSAGE', text: `You have summoned a pet.` });
  events.push({ event: 'MESSAGE', text: `[color=cyan]${petName} says, 'I live to serve you, master.'[/color]` });

  return { pet, events };
}

/**
 * Despawn a pet, removing it from the zone and clearing session reference.
 */
function despawnPet(session, message) {
  if (!session.pet) return;
  const pet = session.pet;
  const zone = zoneInstances[session.char.zoneId];
  if (zone) {
    zone.liveMobs = zone.liveMobs.filter(m => m.id !== pet.id);
  }
  // If charmed, revert mob to hostile
  if (pet.isCharmed && pet._originalTarget !== undefined) {
    pet.isPet = false;
    pet.isCharmed = false;
    pet.target = session; // Attack the charmer
    // Don't remove from liveMobs — it's still an active mob
    if (zone && !zone.liveMobs.includes(pet)) {
      zone.liveMobs.push(pet);
    }
  }
  session.pet = null;
  if (message) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: message }]);
  }
}

/**
 * Convert a mob into a charmed pet.
 */
function charmMob(session, mob, spellDef) {
  const events = [];

  // Kill existing pet
  if (session.pet) {
    despawnPet(session, 'Your previous pet fades away.');
  }

  // Calculate charm duration
  const baseTicks = spellDef.duration ? (spellDef.duration.ticks || spellDef.duration / 6) : 205;
  const chaBonusTicks = Math.max(0, Math.floor(((session.effectiveStats?.cha || session.char.cha) - 75) / 25));
  const totalDuration = (baseTicks + chaBonusTicks) * 6; // Convert ticks to seconds

  // Store original state for uncharm
  mob._originalTarget = mob.target;
  mob.isPet = true;
  mob.isCharmed = true;
  mob.ownerSession = session;
  mob.ownerId = session.char.id;
  mob.state = 'follow';
  mob.guardX = null;
  mob.guardY = null;
  mob.target = null;
  mob.hateList = [];
  mob.taunting = true;
  mob.charmDuration = totalDuration;
  mob.charmTickTimer = 6; // Check for break every 6 seconds
  mob.totalDamageDealt = 0;
  mob.alive = true;
  // Give pet equipment/inventory structures
  if (!mob.equipment) mob.equipment = {};
  if (!mob.inventory) mob.inventory = [];

  session.pet = mob;

  // Stop combat
  session.inCombat = false;
  session.autoFight = false;
  session.combatTarget = null;

  events.push({ event: 'MESSAGE', text: `${mob.name} regards you as an ally!` });
  events.push({ event: 'MESSAGE', text: `[color=cyan]${mob.name} is now under your command.[/color]` });

  return events;
}

/**
 * Handle pet commands from the player.
 */
function handlePetCommand(session, msg) {
  if (!session.pet || !session.pet.alive) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You do not have a pet.' }]);
  }

  const pet = session.pet;
  const cmd = (msg.command || '').toLowerCase();
  const events = [];

  switch (cmd) {
    case 'follow':
      pet.state = 'follow';
      pet.guardX = null;
      pet.guardY = null;
      events.push({ event: 'MESSAGE', text: `${pet.name} begins to follow you.` });
      break;

    case 'guard':
      pet.state = 'guard';
      pet.guardX = pet.x;
      pet.guardY = pet.y;
      events.push({ event: 'MESSAGE', text: `${pet.name} guards this position.` });
      break;

    case 'sit':
      pet.state = 'sit';
      events.push({ event: 'MESSAGE', text: `${pet.name} sits down.` });
      break;

    case 'attack': {
      // Attack owner's current target
      const targetMob = session.combatTarget;
      if (!targetMob) {
        events.push({ event: 'MESSAGE', text: 'You must have a target for your pet to attack.' });
        break;
      }
      if (targetMob.isPet) {
        events.push({ event: 'MESSAGE', text: 'Your pet refuses to attack another pet.' });
        break;
      }
      // Add to hate list
      const existingHate = pet.hateList.find(h => h.mob === targetMob);
      if (existingHate) {
        existingHate.hate += 1000;
      } else {
        pet.hateList.push({ mob: targetMob, hate: 1000 });
      }
      pet.state = 'follow'; // Wake up from sit/guard
      events.push({ event: 'MESSAGE', text: `${pet.name} attacks ${targetMob.name}!` });
      break;
    }

    case 'backoff':
      pet.hateList = [];
      pet.target = null;
      events.push({ event: 'MESSAGE', text: `${pet.name} backs off.` });
      break;

    case 'taunt':
      pet.taunting = !pet.taunting;
      events.push({ event: 'MESSAGE', text: `${pet.name} will ${pet.taunting ? 'now' : 'no longer'} taunt enemies.` });
      break;

    case 'getlost':
      events.push({ event: 'MESSAGE', text: `${pet.name} says, 'As you wish, master.' and fades away.` });
      despawnPet(session);
      break;

    case 'health': {
      const hpPct = Math.floor((pet.hp / pet.maxHp) * 100);
      let condition;
      if (hpPct >= 90) condition = 'is in excellent health';
      else if (hpPct >= 75) condition = 'is slightly injured';
      else if (hpPct >= 50) condition = 'is moderately wounded';
      else if (hpPct >= 25) condition = 'is badly wounded';
      else condition = 'is near death';
      events.push({ event: 'MESSAGE', text: `${pet.name} ${condition}. (${pet.hp}/${pet.maxHp} HP)` });
      break;
    }

    case 'leader':
      events.push({ event: 'MESSAGE', text: `[color=cyan]${pet.name} says, 'My leader is ${session.char.name}.'[/color]` });
      break;

    case 'target':
      // Set owner's target to the pet itself (for healing, buffs, etc.)
      session.combatTarget = pet;
      events.push({ event: 'MESSAGE', text: `You target ${pet.name}.` });
      break;

    case 'asyouwere':
      pet.hateList = [];
      pet.target = null;
      pet.state = 'follow';
      events.push({ event: 'MESSAGE', text: `${pet.name} returns to your side.` });
      break;

    default:
      events.push({ event: 'MESSAGE', text: `Unknown pet command: ${cmd}. Try: follow, guard, sit, attack, backoff, taunt, getlost, health, leader, target` });
  }

  if (events.length > 0) sendCombatLog(session, events);
}

function sendMercenaries(session) {
  if (!session.char.mercenaries) session.char.mercenaries = [null, null];
  send(session.ws, {
    type: 'MERCENARIES_UPDATE',
    mercenaries: session.char.mercenaries
  });
}

function handleMercenaryAction(session, msg) {
  if (!session.char.mercenaries) session.char.mercenaries = [null, null];
  
  const action = msg.action;
  const index = msg.index;
  if (index < 0 || index >= session.char.mercenaries.length) return;

  const merc = session.char.mercenaries[index];

  if (action === "switch") {
    if (!merc) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'No mercenary contract in that slot.' }]);
      return;
    }
    // Activate this mercenary. If there's already a pet/merc out, suspend it first.
    if (session.pet) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You suspend your current companion.` }]);
      despawnPet(session);
    }
    // Spawn the new merc
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You call upon ${merc.name} the ${merc.raceStr}/${merc.classStr}.` }]);
    // Use spawnPet but mark it as mercenary
    spawnPet(session, {
      name: merc.name,
      hpRange: [merc.maxHp || 100, merc.maxHp || 100],
      ac: merc.ac || 10,
      minDmg: merc.minDmg || 1, maxDmg: merc.maxDmg || 10,
      attackDelay: merc.attackDelay || 3,
      levelRange: [merc.level || 1, merc.level || 1],
      race: merc.raceId || 1,
      npcClass: merc.classId || 1
    });
    if (session.pet) {
      session.pet.isMercenary = true;
      session.pet.raceStr = merc.raceStr || "Human";
      session.pet.classStr = merc.classStr || "Warrior";
      session.pet.mercIndex = index;
    }
    sendStatus(session);
  }
  else if (action === "suspend") {
    if (!merc) return;
    if (session.pet && session.pet.isMercenary && session.pet.mercIndex === index) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You suspend ${merc.name}'s services.` }]);
      despawnPet(session);
      sendStatus(session);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'That mercenary is not currently active.' }]);
    }
  }
  else if (action === "release") {
    if (!merc) return;
    if (session.pet && session.pet.isMercenary && session.pet.mercIndex === index) {
      despawnPet(session);
      sendStatus(session);
    }
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You release ${merc.name} from your contract.` }]);
    session.char.mercenaries[index] = null;
    sendMercenaries(session);
  }
  else if (action === "set_stance") {
    const newStance = msg.stance;
    if (session.pet && session.pet.isMercenary && session.pet.botAI) {
      session.pet.botAI.stance = newStance;
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You instruct your mercenary to adopt a ${newStance} stance.` }]);
    }
  }
}

/**
 * Process pet AI for a single pet during the mob AI tick.
 * Called from processMobAI for mobs with isPet === true.
 */
function processPetAI(pet, zone, zoneId, dt) {
  if (!pet.alive || !pet.ownerSession) return;

  const owner = pet.ownerSession;
  if (!owner.char || owner.char.zoneId !== zoneId) {
    // Owner left the zone — despawn pet
    despawnPet(owner, 'Your pet fades away as you leave.');
    return;
  }

  // ── Charm Break Check ──
  if (pet.isCharmed) {
    pet.charmDuration -= dt;
    pet.charmTickTimer -= dt;
    if (pet.charmDuration <= 0) {
      // Charm expired
      sendCombatLog(owner, [{ event: 'MESSAGE', text: `[color=red]Your charm has worn off! ${pet.name} turns hostile![/color]` }]);
      pet.isPet = false;
      pet.isCharmed = false;
      pet.target = owner; // Attack the charmer
      owner.pet = null;
      return;
    }
    if (pet.charmTickTimer <= 0) {
      pet.charmTickTimer = 6; // Check every 6 seconds
      // Periodic resist check — chance to break early
      const breakChance = 5 + Math.max(0, (pet.level - owner.char.level) * 2); // Higher level = more likely to break
      if (Math.random() * 100 < breakChance) {
        sendCombatLog(owner, [{ event: 'MESSAGE', text: `[color=red]Your charm has been broken! ${pet.name} turns hostile![/color]` }]);
        pet.isPet = false;
        pet.isCharmed = false;
        pet.target = owner;
        owner.pet = null;
        return;
      }
    }
  }

  // ── Regen ──
  pet.regenTimer -= dt;
  if (pet.regenTimer <= 0) {
    pet.regenTimer = 6; // 6-second EQ tick
    if (pet.hp < pet.maxHp) {
      const regenAmt = pet.state === 'sit' ? Math.floor(pet.regen * 1.5) : pet.regen;
      pet.hp = Math.min(pet.maxHp, pet.hp + regenAmt);
    }
  }

  // ── Combat ──
  // Clean up dead targets from hate list
  pet.hateList = pet.hateList.filter(h => h.mob && h.mob.hp > 0);

  // If no hate list targets, clear combat target
  if (pet.hateList.length === 0) {
    pet.target = null;
  } else {
    // Select highest-hate target
    pet.hateList.sort((a, b) => b.hate - a.hate);
    pet.target = pet.hateList[0].mob;
  }

  // ── Movement ──
  const MELEE_RANGE = 15;
  const FOLLOW_DISTANCE = 8;
  const PET_SPEED = 8 + (pet.level || 1) * 0.3;

  if (pet.target && pet.target.hp > 0) {
    // Combat chase — move toward target
    const dx = pet.target.x - pet.x;
    const dy = pet.target.y - pet.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > MELEE_RANGE * MELEE_RANGE) {
      const moveAmt = PET_SPEED * dt;
      pet.x += (dx / dist) * Math.min(moveAmt, dist);
      pet.y += (dy / dist) * Math.min(moveAmt, dist);
    }

    // ── Pet Melee Attack ──
    if (dist <= MELEE_RANGE) {
      pet.attackTimer -= dt;
      if (pet.attackTimer <= 0) {
        pet.attackTimer = pet.attackDelay;

        const target = pet.target;
        const events = [];

        // Hit chance based on level difference
        const hitChance = Math.min(95, Math.max(30, 60 + (pet.level - target.level) * 3));
        if (Math.random() * 100 < hitChance) {
          // Damage roll
          const dmgRange = pet.maxDmg - pet.minDmg;
          let dmg = pet.minDmg + Math.floor(Math.random() * (dmgRange + 1));

          // Check for equipped weapon — use weapon damage if higher
          if (pet.equipment && pet.equipment.primary) {
            const wpnDmg = pet.equipment.primary.damage || 0;
            if (wpnDmg > dmg) dmg = wpnDmg;
          }

          // Double attack check
          let totalDmg = dmg;
          if (pet.skills.doubleAttack && Math.random() < 0.3) {
            const dmg2 = pet.minDmg + Math.floor(Math.random() * (dmgRange + 1));
            totalDmg += dmg2;
          }

          target.hp -= totalDmg;
          pet.totalDamageDealt += totalDmg;

          // Make the target aggro back on the pet if taunting
          if (pet.taunting && target.target !== pet) {
            target.target = pet; // Mob now attacks the pet instead of player
          }

          events.push({ event: 'MELEE_HIT', source: pet.name, target: target.name, damage: totalDmg });
        } else {
          events.push({ event: 'MELEE_MISS', source: pet.name, target: target.name });
        }

        // Pet innate spells
        if (pet.innateSpells && pet.innateSpells.length > 0 && target.hp > 0) {
          for (const innate of pet.innateSpells) {
            if (!pet.innateSpellCooldowns[innate] || pet.innateSpellCooldowns[innate] <= 0) {
              let innateDmg = 0;
              let innateMsg = '';
              switch (innate) {
                case 'fireBolt':
                  innateDmg = Math.floor(pet.level * 2.5 + 10);
                  innateMsg = 'Fire Bolt';
                  pet.innateSpellCooldowns[innate] = 8;
                  break;
                case 'iceBolt':
                  innateDmg = Math.floor(pet.level * 2 + 8);
                  innateMsg = 'Ice Bolt';
                  pet.innateSpellCooldowns[innate] = 8;
                  break;
                case 'stun':
                  innateDmg = Math.floor(pet.level * 0.5);
                  innateMsg = 'Stun';
                  pet.innateSpellCooldowns[innate] = 12;
                  // Apply brief stun to target
                  if (!target.buffs) target.buffs = [];
                  target.buffs.push({ name: 'Pet Stun', duration: 2, isStun: true });
                  break;
                case 'root':
                  innateDmg = 0;
                  innateMsg = 'Root';
                  pet.innateSpellCooldowns[innate] = 15;
                  if (!target.buffs) target.buffs = [];
                  target.buffs.push({ name: 'Pet Root', duration: 8, isRoot: true });
                  break;
                case 'damageShield':
                  // Passive — handled elsewhere
                  break;
              }
              if (innateDmg > 0) {
                target.hp -= innateDmg;
                pet.totalDamageDealt += innateDmg;
                events.push({ event: 'SPELL_DAMAGE', source: pet.name, target: target.name, spell: innateMsg, damage: innateDmg });
              } else if (innateMsg && innateMsg !== 'Root') {
                events.push({ event: 'MESSAGE', text: `${pet.name} casts ${innateMsg} on ${target.name}!` });
              }
              break; // Only one innate per tick
            }
          }
        }

        // Send combat events to owner
        if (events.length > 0) sendCombatLog(owner, events);

        // Check if target died
        if (target.hp <= 0) {
          // Find the session that was fighting this mob for XP credit
          let xpSession = null;
          for (const [, s] of sessions) {
            if (s.combatTarget === target) { xpSession = s; break; }
          }
          if (!xpSession) xpSession = owner; // Owner gets XP if no one else is fighting
          handleMobDeath(xpSession, target, []);
          pet.hateList = pet.hateList.filter(h => h.mob !== target);
          pet.target = null;
        }
      }
    }
  } else {
    // No combat target — movement based on state
    if (pet.state === 'follow') {
      const dx = owner.char.x - pet.x;
      const dy = owner.char.y - pet.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > FOLLOW_DISTANCE * FOLLOW_DISTANCE) {
        const dist = Math.sqrt(distSq);
        const moveAmt = PET_SPEED * dt;
        pet.x += (dx / dist) * Math.min(moveAmt, dist - FOLLOW_DISTANCE + 1);
        pet.y += (dy / dist) * Math.min(moveAmt, dist - FOLLOW_DISTANCE + 1);
      }
    } else if (pet.state === 'guard' && pet.guardX != null) {
      // Return to guard position if displaced by combat
      const dx = pet.guardX - pet.x;
      const dy = pet.guardY - pet.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > 9) {
        const dist = Math.sqrt(distSq);
        const moveAmt = PET_SPEED * dt;
        pet.x += (dx / dist) * Math.min(moveAmt, dist);
        pet.y += (dy / dist) * Math.min(moveAmt, dist);
      }
    }
    // sit: pet stays still
  }

  // Cooldown innate spell timers
  for (const key of Object.keys(pet.innateSpellCooldowns)) {
    if (pet.innateSpellCooldowns[key] > 0) {
      pet.innateSpellCooldowns[key] -= dt;
    }
  }
}

/**
 * Handle pet death — called when pet HP reaches 0.
 */
function handlePetDeath(pet, zone) {
  if (!pet.ownerSession) return;
  const owner = pet.ownerSession;

  sendCombatLog(owner, [{ event: 'MESSAGE', text: `[color=red]${pet.name} has been slain![/color]` }]);

  // Remove from zone
  if (zone) {
    zone.liveMobs = zone.liveMobs.filter(m => m.id !== pet.id);
  }

  // Clear session reference
  owner.pet = null;
}



async function handleMobDeath(session, mob, events) {
  return CombatSystem.handleMobDeath(session, mob, events);
}

function handleAutoInventory(session) {
  // In a full EQ implementation, this moves the cursor item to inventory.
  // We don't simulate cursor items perfectly yet, so this acts as a stub or auto-loot command.
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You auto-inventory your items.` }]);
}

function handleTargetName(session, msg) {
  if (!msg.name) return;
  const targetNameLower = msg.name.toLowerCase();
  
  // Find closest entity matching name in session's zone
  const zoneKey = session.char.zone;
  const entities = Array.from(SpawnSystem.getActiveEntities(zoneKey));
  
  let bestMatch = null;
  for (const entity of entities) {
    if (entity.name && entity.name.toLowerCase().includes(targetNameLower)) {
      bestMatch = entity;
      break; // Just grab first match for now
    }
  }

  if (bestMatch) {
    handleSetTarget(session, { targetId: bestMatch.id });
  } else {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `Target '${msg.name}' not found.` }]);
  }
}

function handleCorpseDrag(session) {
  const target = session.combatTarget;
  if (!target || target.type !== 'corpse') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You must have a corpse targeted to drag it.` }]);
      return;
  }

  const char = session.char;
  const distSq = getDistanceSq(char.x, char.y, target.x, target.y);
  const DRAG_RANGE = 40; // Fairly short range to start dragging
  
  if (distSq > DRAG_RANGE * DRAG_RANGE) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You are too far away to drag that corpse.` }]);
      return;
  }

  target.x = char.x;
  target.y = char.y;
  target.z = char.z;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You pull the corpse towards you.` }]);
}

function handlePetCommand(session, msg) {
  const cmd = msg.command;
  if (!session.pet) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You do not have a pet.` }]);
    return;
  }
  
  if (cmd === 'attack') {
    if (session.target && session.target !== session.pet.id) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${session.pet.name} says, 'Attacking ${session.target} Master!'` }]);
      // TODO: set pet combat target
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You must have a target to command your pet to attack.` }]);
    }
  } else if (cmd === 'back' || cmd === 'follow') {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `${session.pet.name} says, 'Following you Master.'` }]);
    // TODO: clear pet combat target and resume follow state
  }
}

function handleCamp(session) {
  // Must be sitting to camp
  if (session.char.state !== 'medding') {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must be sitting to camp.' }]);
    return;
  }

  // Can't camp while in combat
  if (session.autoFight || session.inCombat) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot camp while in combat!' }]);
    return;
  }

  // Already camping?
  if (session.campTimer) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are already camping.' }]);
    return;
  }

  // Start the 15-second countdown
  session.campCountdown = 15;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `It will take about ${session.campCountdown} seconds to camp.` }]);

  session.campTimer = setInterval(() => {
    // Cancel if player stood up, entered combat, or disconnected
    if (!sessions.has(session.ws)) {
      clearInterval(session.campTimer);
      session.campTimer = null;
      return;
    }

    if (session.char.state !== 'medding' || session.autoFight || session.inCombat) {
      clearInterval(session.campTimer);
      session.campTimer = null;
      session.campCountdown = 0;
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have stopped camping.' }]);
      return;
    }

    session.campCountdown--;

    if (session.campCountdown <= 0) {
      // Camp complete!
      clearInterval(session.campTimer);
      session.campTimer = null;

      // Save character state
      DB.updateCharacterState(session.char);
      DB.saveCharacterSkills(session.char.id, session.char.skills);
      SpellSystem.saveBuffsToFile(session);
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have safely camped out.' }]);

      // Tell the client to return to character select
      send(session.ws, { type: 'CAMP_COMPLETE' });

      // Remove session
      sessions.delete(session.ws);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `Remain camping for ${session.campCountdown} seconds to log out.` }]);
    }
  }, 1000);
}

function handleTrainSkill(session, msg) {
  const skillKey = msg.skillKey;
  if (!skillKey) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'No skill specified.' }]);
    return;
  }

  const skillDef = Skills[skillKey];
  if (!skillDef) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Unknown skill.' }]);
    return;
  }

  const playerClass = session.char.class;
  const classData = skillDef.classes[playerClass];
  if (!classData) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot learn ${skillDef.name}.` }]);
    return;
  }

  // Level requirement check
  if (session.char.level < classData.levelGranted) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You are not high enough level to train ${skillDef.name}.` }]);
    return;
  }

  // Cap check
  const currentValue = (session.char.skills || {})[skillKey] || 0;
  const levelCap = Math.min(classData.capFormula(session.char.level), classData.maxCap);
  if (currentValue >= levelCap) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `Your ${skillDef.name} skill is already at its maximum for your level.` }]);
    return;
  }

  // Determine payment method
  const usePractice = msg.usePractice !== false; // Default to using practice points
  let paid = false;

  if (usePractice && (session.char.practices || 0) > 0) {
    // Spend a practice point (free training)
    session.char.practices--;
    paid = true;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You have increased your ${skillDef.name} skill to ${currentValue + 1}! (${session.char.practices} practice points remaining)` }]);
  } else {
    // Pay with coin
    const costCopper = StatsSystem.getTrainingCostCopper(currentValue);
    if (costCopper > 0 && (session.char.copper || 0) < costCopper) {
      const coins = StatsSystem.copperToCoins(costCopper);
      const costStr = [];
      if (coins.pp > 0) costStr.push(`${coins.pp}pp`);
      if (coins.gp > 0) costStr.push(`${coins.gp}gp`);
      if (coins.sp > 0) costStr.push(`${coins.sp}sp`);
      if (coins.cp > 0) costStr.push(`${coins.cp}cp`);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot afford to train ${skillDef.name}. Cost: ${costStr.join(' ')}.` }]);
      return;
    }
    session.char.copper = (session.char.copper || 0) - costCopper;
    paid = true;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You have trained ${skillDef.name} to ${currentValue + 1}!` }]);
  }

  if (!paid) return;

  // Increment the skill
  if (!session.char.skills) session.char.skills = {};
  session.char.skills[skillKey] = currentValue + 1;

  // Persist immediately
  DB.saveCharacterSkills(session.char.id, session.char.skills);
  DB.updateCharacterState(session.char);

  // Resend the full trainer window so costs/ranks refresh
  const skillList = [];
  const charSkills = session.char.skills;
  for (const [key, sDef] of Object.entries(Skills)) {
    const cData = sDef.classes[playerClass];
    if (!cData) continue;
    const val = charSkills[key] || 0;
    const cap = Math.min(cData.capFormula(session.char.level), cData.maxCap);
    const rank = StatsSystem.getSkillRank(val, cData.maxCap);
    const atCap = val >= cap;
    const tooLow = session.char.level < cData.levelGranted;
    let costC = 0, costCoins = { pp: 0, gp: 0, sp: 0, cp: 0 }, canTrain = false;
    if (!atCap && !tooLow) {
      canTrain = true;
      costC = StatsSystem.getTrainingCostCopper(val);
      costCoins = StatsSystem.copperToCoins(costC);
    }
    skillList.push({
      key, name: sDef.name, type: sDef.type,
      value: val, cap, maxCap: cData.maxCap, rank, canTrain,
      costPp: canTrain ? costCoins.pp : null,
      costGp: canTrain ? costCoins.gp : null,
      costSp: canTrain ? costCoins.sp : null,
      costCp: canTrain ? costCoins.cp : null,
      costTotalCopper: canTrain ? costC : 0,
      levelGranted: cData.levelGranted,
    });
  }

  send(session.ws, {
    type: 'OPEN_TRAINER',
    npcId: msg.npcId || 0,
    npcName: msg.npcName || 'Trainer',
    trainerClass: playerClass,
    practices: session.char.practices || 0,
    copper: session.char.copper || 0,
    skills: skillList,
  });
}

// ── Movement & Zoning ───────────────────────────────────────────────────────────


// ── Network Helpers ─────────────────────────────────────────────────


// Compute per-slot armor material indices and weapon model IDs from equipped items
// Returns: { head: 0, chest: 0, ..., primaryWeapon: 'IT10', secondaryWeapon: 'IT215' }
function getEquipVisuals(session) {
  const visuals = { head: 0, chest: 0, arms: 0, wrist: 0, hands: 0, legs: 0, feet: 0, primaryWeapon: '', secondaryWeapon: '' };
  if (!session || !session.inventory) return visuals;

  // EQEmu equip slot -> body part mapping
  const slotMap = {
    2: 'head',    // HEAD
    7: 'arms',    // ARMS
    9: 'wrist',   // WRIST1
    10: 'wrist',  // WRIST2
    12: 'hands',  // HANDS
    17: 'chest',  // CHEST
    18: 'legs',   // LEGS
    19: 'feet',   // FEET
  };

  for (const inv of session.inventory) {
    if (inv.equipped !== 1) continue;
    const itemDef = ItemDB.getById(inv.item_key);
    if (!itemDef) continue;

    // Armor material
    const bodyPart = slotMap[inv.slot];
    if (bodyPart && itemDef.material !== undefined) {
      visuals[bodyPart] = itemDef.material;
    }

    // Primary weapon (slot 13)
    if (inv.slot === 13 && itemDef.idfile) {
      visuals.primaryWeapon = itemDef.idfile.toLowerCase();
    }
    // Secondary weapon/shield (slot 14)
    if (inv.slot === 14 && itemDef.idfile) {
      visuals.secondaryWeapon = itemDef.idfile.toLowerCase();
    }
  }

  // console.log(`[ENGINE] equipVisuals: ${JSON.stringify(visuals)}`);
  return visuals;
}

function sendFullState(session) {
  sendLoginOk(session);
  sendInventory(session);
  SpellSystem.sendSpellbook(session);
  SpellSystem.sendSpellbookFull(session);
  SpellSystem.sendBuffs(session);
  sendMercenaries(session);
  sendStatus(session);
  handleLook(session);
}

function sendLoginOk(session) {
  const char = session.char;
  const effective = session.effectiveStats;
  const zone = ZoneSystem.getZoneDef(char.zoneId);

  send(session.ws, {
    type: 'LOGIN_OK',
    character: {
      name: char.name,
      class: char.class,
      race: char.race,
      raceId: char.raceId || 1,
      gender: char.gender || 0,
      face: char.face || 0,
      level: char.level,
      experience: char.experience,
      nextLevelXp: combat.xpForLevel(char.level + 1),
      hp: char.hp,
      maxHp: effective.hp,
      mana: char.mana,
      maxMana: effective.mana,
      state: char.state,
      inCombat: session.inCombat,
      zone: zone ? zone.name : 'Unknown',
      zoneId: char.zoneId,
      connections: zone ? zone.connections : [],
      copper: char.copper,
      x: char.x,
      y: char.y,
      z: char.z || 0,
      stats: {
        str: effective.str, sta: effective.sta, agi: effective.agi,
        dex: effective.dex, wis: effective.wis, intel: effective.intel,
        cha: effective.cha, ac: effective.ac,
      },
      skills: char.skills,
      equipVisuals: getEquipVisuals(session),
    },
  });
}

function sendStatus(session) {
  const char = session.char;
  const effective = session.effectiveStats;
  const zone = ZoneSystem.getZoneDef(char.zoneId);

  // Pick out basic room data if it exists
  let roomName = null;
  let roomId = null;
  let mapData = null;
  
  if (!session.visitedRooms) session.visitedRooms = new Set();
  
  if (zone && zone.rooms && char.roomId) {
     session.visitedRooms.add(char.roomId);
     const rm = zone.rooms[char.roomId];
     if (rm) {
       roomName = rm.name;
       roomId = rm.id;
       mapData = Object.values(zone.rooms).map(r => ({
          id: r.id, name: r.name, x: r.x, y: r.y, exits: r.exits,
          visited: session.visitedRooms.has(r.id)
       }));
     }
  }

  // Determine which abilities & skills the character has unlocked to send to the UI
  const availableAbilities = [];  // Combat actions → Abilities tab
  const availableSkills = [];     // Utility actions → Skills tab
  for (const skillKey of Object.keys(Skills)) {
      const skVal = combat.getCharSkill(char, skillKey);
      if (Skills[skillKey].type === 'ability' && skVal > 0) {
          availableAbilities.push(Skills[skillKey].name.toLowerCase());
      } else if (Skills[skillKey].type === 'skill' && skVal > 0) {
          availableSkills.push(Skills[skillKey].name.toLowerCase());
      }
  }

  // Build Extended Targets list (only mobs actively in combat with this player)
  // Uses a cached ID set so we only log on add/remove, not every tick.
  const extendedTargets = [];
  if (!session._extTargetIds) session._extTargetIds = new Set();
  const currentExtIds = new Set();
  const zoneInst = zoneInstances[char.zoneId];
  if (zoneInst && zoneInst.liveMobs) {
      for (const m of zoneInst.liveMobs) {
          const isTargetingPlayer = m.target === session || m.target === session.id || m.target === session.char.name;
          const isTargetingPet = session.pet && (m.target === session.pet || m.target === session.pet.id || m.target === session.pet.name);
          const isPlayerAttacking = session.inCombat && session.combatTarget === m;
          const isPetAttacking = session.pet && session.pet.target === m;

          const onHateList = m.hateList && m.hateList.entries.some(e => e.entityId === session.char.name);

          if ((isTargetingPlayer || isTargetingPet || isPlayerAttacking || isPetAttacking || onHateList) && m.hp > 0) {
              currentExtIds.add(m.id);
              if (!session._extTargetIds.has(m.id)) {
                  console.log(`[EXT] Added ${m.name} to extended targets for ${session.char.name}`);
              }
              const hatePercent = m.hateList ? m.hateList.getHateRatio(session.char.name) : 0;
              extendedTargets.push({
                  id: m.id,
                  name: m.name,
                  hp: m.hp,
                  maxHp: m.maxHp,
                  level: m.level,
                  hatePercent: hatePercent
              });
          }
      }
  }
  // Log removals (mob died or lost aggro)
  for (const oldId of session._extTargetIds) {
      if (!currentExtIds.has(oldId)) {
          console.log(`[EXT] Removed target (id=${oldId}) from extended targets for ${session.char.name}`);
      }
  }
  session._extTargetIds = currentExtIds;

  // Pre-compute combat animation data safely — any error here must NOT crash sendStatus
  let _wpnSkill = '1h_slashing';
  let _hasteMod = 1.0;
  try {
    if (session.inventory) _wpnSkill = StatsSystem.getWeaponSkillName(session.inventory);
    if (Array.isArray(session.buffs)) {
      for (const buff of session.buffs) {
        if (Array.isArray(buff.effects)) {
          const hasteEff = buff.effects.find(e => e.spa === 11 && e.base > 0);
          if (hasteEff) _hasteMod = Math.min(2.0, 1.0 + (hasteEff.base / 100));
        }
      }
    }
  } catch (e) {
    console.error('[ENGINE] Error computing combat anim data:', e.message);
  }

  send(session.ws, {
    type: 'STATUS',
    character: {
      name: char.name,
      class: char.class,
      raceId: char.raceId || 1,
      gender: char.gender || 0,
      face: char.face || 0,
      hp: char.hp, maxHp: effective.hp,
      mana: char.mana, maxMana: effective.mana,
      fatigue: char.fatigue || 0,
      str: effective.str, sta: effective.sta, agi: effective.agi,
      dex: effective.dex, wis: effective.wis, intel: effective.intel, cha: effective.cha,
      ac: effective.ac,
      mitigationAC: effective.mitigationAC || 0,
      avoidanceAC: effective.avoidanceAC || 0,
      atkBonus: effective.atkBonus || 0,
      dmg: effective.dmg || 0,
      dly: effective.dly || 0,
      offhandDmg: effective.offhandDmg || 0,
      offhandDly: effective.offhandDly || 0,
      resistFire: effective.resistFire || 0,
      resistCold: effective.resistCold || 0,
      resistPoison: effective.resistPoison || 0,
      resistDisease: effective.resistDisease || 0,
      resistMagic: effective.resistMagic || 0,
      speedMod: effective.speedMod || 1.0,
      weaponSkill: _wpnSkill,
      hasteMod: _hasteMod,
      state: char.state,
      inCombat: session.inCombat,
      autoFight: session.autoFight,
      // Vision flags for stats panel
      ...(() => {
        const vm = VisionSystem.getAvailableVisionModes(session);
        return {
          hasInfravision: vm.includes('infravision'),
          hasUltravision: vm.includes('ultravision'),
        };
      })(),
      hasSeeInvis: Array.isArray(session.buffs) && session.buffs.some(b => b.effects && b.effects.some(e => e.spa === 13)),
      level: char.level,
      experience: char.experience,
      nextLevelXp: combat.xpForLevel(char.level + 1),
      zone: zone ? zone.name : 'Unknown',
      zoneId: char.zoneId,
      roomId: roomId,
      roomName: roomName,
      x: char.x,
      y: char.y,
      mapSize: zone ? zone.mapSize : { width: 400, length: 400 },
      centerOffset: zone ? zone.centerOffset : { x: 0, y: 0 },
      zoneLines: zone ? zone.zoneLines : [],
      connections: zone && zone.connections ? zone.connections : [], // Legacy
      spawnPos: session.pendingTeleport || null,
      equipVisuals: getEquipVisuals(session),
      skills: char.skills,
      mapData: mapData,
      worldAtlas: (() => {
        const atlas = WorldAtlas.getAtlasEntry(char.zoneId);
        if (!atlas) return null;
        const worldPos = WorldAtlas.localToWorld(char.zoneId, char.x || 0, char.y || 0);
        // Use vision viewDistance or fallback to 15000 for neighbor search
        const visionState = VisionSystem.getVisionState(session, zone);
        const searchRadius = Math.max(visionState.viewDistance || 15000, 15000);
        const neighbors = WorldAtlas.getNeighborZones(char.zoneId, char.x || 0, char.y || 0, searchRadius);
        return {
          worldX: worldPos.x,
          worldY: worldPos.y,
          zoneCenter: { x: atlas.worldX, y: atlas.worldY },
          zoneSize: { width: atlas.width, height: atlas.height },
          continent: atlas.continent,
          terrain: atlas.terrain,
          neighbors: neighbors,
        };
      })(),
      abilityCooldowns: session.abilityCooldowns || {},
      availableAbilities: availableAbilities,
      availableSkills: availableSkills,
      skills: char.skills || {},
      practices: char.practices || 0,
      copper: char.copper || 0,
      extendedTargets: extendedTargets,
      target: session.combatTarget ? {
        id: session.combatTarget.id,
        name: session.combatTarget.name,
        hp: session.combatTarget.hp,
        level: session.combatTarget.level,
        maxHp: session.combatTarget.maxHp,
        targetTarget: (() => {
          let mt = session.combatTarget.target;
          // If target is a player session, they use combatTarget
          if (!mt && session.combatTarget.char) mt = session.combatTarget.combatTarget;
          
          if (!mt) return null;
          
          if (mt === session) {
            return { name: session.char.name, hp: session.char.hp, maxHp: session.effectiveStats.hp };
          }
          if (mt.char) {
            return { name: mt.char.name, hp: mt.char.hp, maxHp: mt.effectiveStats.hp };
          }
          return { name: mt.name, hp: mt.hp, maxHp: mt.maxHp };
        })(),
        buffs: (session.combatTarget.buffs || []).map(b => ({
          name: b.name,
          duration: b.duration,
          maxDuration: b.maxDuration,
          beneficial: b.beneficial !== false,
          icon: b.icon || 0,
          memIcon: b.memIcon || 0
        }))
      } : null,
      vision: (() => {
        const zoneInst = zoneInstances[session.char.zoneId];
        const v = VisionSystem.getVisionState(session, zoneInst ? zoneInst.def : null);
        return {
          mode: v.mode,
          modeName: v.modeName,
          renderStyle: v.renderStyle,
          effectiveness: v.effectiveness,
          isBlind: v.isBlind,
          viewDistance: v.viewDistance,
          ambientLight: v.ambientLight,
          sensitivityPenalty: v.sensitivityPenalty,
          timeOfDay: v.timeOfDay,
          weather: v.weather,
          weatherName: v.weatherName,
          weatherIntensity: v.weatherIntensity,
          weatherRenderEffect: v.weatherRenderEffect,
          worldHour: v.worldHour,
          isOutdoor: v.isOutdoor,
          hasLightSource: v.hasLightSource,
          canSeeUnlit: v.canSeeUnlit,
          availableModes: v.availableModes,
          season: v.season,
          dawn: v.dawn,
          dusk: v.dusk,
          moons: v.moons,
        };
      })(),
      calendar: {
        date: Calendar.formatDate(worldCalendar),
        time: Calendar.formatTime(worldCalendar.hour),
        hour: worldCalendar.hour,
        day: worldCalendar.day,
        month: Calendar.getMonth(worldCalendar.month).name,
        monthIndex: worldCalendar.month,
        year: worldCalendar.year,
        season: Calendar.getSeason(worldCalendar.month).name,
        dayOfWeek: Calendar.getDayOfWeek(worldCalendar.totalDays),
      },
      pet: session.pet ? {
        id: session.pet.id,
        name: session.pet.name,
        hp: session.pet.hp,
        maxHp: session.pet.maxHp,
        level: session.pet.level,
        state: session.pet.state,
        taunting: session.pet.taunting,
        isCharmed: session.pet.isCharmed || false,
        isMercenary: session.pet.isMercenary || false,
        target: session.pet.target ? session.pet.target.name : null,
        x: session.pet.x,
        y: session.pet.y,
        race: session.pet.race,
        raceStr: session.pet.raceStr || "Unknown",
        classStr: session.pet.classStr || "Warrior",
        mana: session.pet.mana || 0,
        maxMana: session.pet.maxMana || 100,
        endurance: session.pet.endurance || 0,
        maxEndurance: session.pet.maxEndurance || 100,
        hate: session.pet.target ? (session.pet.hateList.find(h => h.mob === session.pet.target)?.hate || 0) : 0,
        buffs: (session.pet.buffs || []).map(b => ({
          name: b.name,
          duration: b.duration,
          maxDuration: b.maxDuration,
          beneficial: b.beneficial !== false,
          icon: b.icon || 0,
          memIcon: b.memIcon || 0
        }))
      } : null,
    },
  });
  
  // Clear the teleport queue once sent to client
  if (session.pendingTeleport) {
      session.pendingTeleport = null;
  }
}

function sendInventory(session) {
  const inventory = session.inventory.map(row => {
    // item_key is now a numeric EQEmu item ID
    const def = ItemDB.getById(row.item_key) || ITEMS[row.item_key] || {};
    const itemName = def.name || String(row.item_key);
    const legacyKey = ItemDB.generateKey(itemName);
    return {
      item_id: row.id,
      eq_item_id: row.item_key,
      itemKey: legacyKey,
      itemName: itemName,
      equipped: row.equipped,
      slotId: row.slot,
      slot: row.equipped ? row.slot : (def.slot || 0),
      quantity: row.quantity || 1,
      type: def.type || 'misc',
      damage: def.damage || 0,
      delay: def.delay || 0,
      ac: def.ac || 0,
      hp: def.hp || 0,
      mana: def.mana || 0,
      str: def.str || 0, sta: def.sta || 0, agi: def.agi || 0,
      dex: def.dex || 0, wis: def.wis || 0, int: def.intel || 0,
      cha: def.cha || 0,
      weight: def.weight || 0,
      value: def.value || 0,
      sellValue: Math.max(1, Math.floor((def.value || 1) * 0.25 * StatsSystem.getChaSellMod(session))),
      classes: def.classes || 0,
      races: def.races || 0,
      itemtype: def.itemtype || 0,
      equipSlot: def.slot || 0,
      icon: def.icon || 0,
      clicky: def.scrolleffect || 0,
      lore: def.lore || "",
      bookText: def.bookText || "",
      magic: def.magic || 0,
      nodrop: def.nodrop || 0,
      norent: def.norent || 0,
      size: def.size || 0,
      endur: def.endur || 0,
      fr: def.fr || 0, cr: def.cr || 0, mr: def.mr || 0, pr: def.pr || 0, dr: def.dr || 0,
      elemdmgtype: def.elemdmgtype || 0, elemdmgamt: def.elemdmgamt || 0,
      banedmgrace: def.banedmgrace || 0, banedmgamt: def.banedmgamt || 0,
      placeable: def.placeable || 0, reqlevel: def.reqlevel || 0, reclevel: def.reclevel || 0,
      augslot1type: def.augslot1type || 0, augslot2type: def.augslot2type || 0,
      augslot3type: def.augslot3type || 0, augslot4type: def.augslot4type || 0,
      augslot5type: def.augslot5type || 0, augslot6type: def.augslot6type || 0,
    };
  });

  send(session.ws, { type: 'INVENTORY_UPDATE', inventory });
}

// ── Spellbook Persistence (file-based) ──────────────────────────────

// ── Spell System extracted to systems/spells.js ──────────────────────
function sendCombatLog(session, events) {
  send(session.ws, { type: 'COMBAT_LOG', events });
}

// ── Skill Cooldown Processing ───────────────────────────────────────

function processSkillCooldowns(session, dt) {
  if (!session.skillCooldowns) return;
  for (const key of Object.keys(session.skillCooldowns)) {
    if (session.skillCooldowns[key] > 0) {
      session.skillCooldowns[key] -= dt;
      if (session.skillCooldowns[key] <= 0) {
        session.skillCooldowns[key] = 0;
      }
    }
  }
}

// ── Main Game Loop ──────────────────────────────────────────────────

let saveCounter = 0;

function startGameLoop() {
  let tickCount = 0;
  setInterval(() => {
    const dt = TICK_RATE / 1000;
    tickCount++;
    processEnvironment();

    for (const [ws, session] of sessions) {
      StatsSystem.processRegen(session, dt);
      if (session.bot) session.bot.tick();
      processCasting(session, dt);
      CombatSystem.processCombatTick(session, dt);
      StatsSystem.processBuffs(session, dt);
      SurvivalSystem.processSurvival(session, dt, sendCombatLog, sendStatus);
      processSkillCooldowns(session, dt);
      sendStatus(session);

      // --- Proximity Sync ---
      // Periodically refresh the world state to handle LoadRadius pop-ins/outs
      if (tickCount % SYNC_RATE === 0) {
          handleLook(session, true); // forceSync = true
      }

      // --- Tracking Updates ---
      if (tickCount % 20 === 0 && session.trackingTargetId) {
          const zone = zoneInstances[session.char.zoneId];
          let target = null;
          if (zone) {
              if (zone.mobs && zone.mobs[session.trackingTargetId]) target = zone.mobs[session.trackingTargetId];
              if (!target && activeSessions) {
                  for (const p of Object.values(activeSessions)) {
                      if (p.char && p.char.id === session.trackingTargetId) { target = p.char; break; }
                  }
              }
          }

          if (target && target.hp > 0) {
              // Calculate direction relative to player's heading
              // In EQ, North is positive Y? Actually let's just output angle relative to player heading
              const dx = target.x - session.char.x;
              const dy = target.y - session.char.y;
              // Target angle from player
              let angleToTarget = Math.atan2(dx, dy) * 180 / Math.PI; // Assuming standard Cartesian, but EQ axes might vary.
              // Normalize angleToTarget to 0-360
              if (angleToTarget < 0) angleToTarget += 360;
              
              let playerHeading = session.char.heading || 0;
              // Player heading might be 0-360 or 0-512 (EQ uses 0-512). Let's assume degrees for now or EQ 0-512?
              // Standardizing to degrees for the message string.
              // We'll just output straight direction or left/right.
              // For simplicity, just use cardinal directions.
              let dirStr = '';
              if (angleToTarget > 337.5 || angleToTarget <= 22.5) dirStr = 'North';
              else if (angleToTarget > 22.5 && angleToTarget <= 67.5) dirStr = 'Northeast';
              else if (angleToTarget > 67.5 && angleToTarget <= 112.5) dirStr = 'East';
              else if (angleToTarget > 112.5 && angleToTarget <= 157.5) dirStr = 'Southeast';
              else if (angleToTarget > 157.5 && angleToTarget <= 202.5) dirStr = 'South';
              else if (angleToTarget > 202.5 && angleToTarget <= 247.5) dirStr = 'Southwest';
              else if (angleToTarget > 247.5 && angleToTarget <= 292.5) dirStr = 'West';
              else if (angleToTarget > 292.5 && angleToTarget <= 337.5) dirStr = 'Northwest';

              sendCombatLog(session, [{ event: 'MESSAGE', text: `To track ${target.name || target.originalName}, head ${dirStr}.` }]);
          } else {
              sendCombatLog(session, [{ event: 'MESSAGE', text: `You have lost your tracking target.` }]);
              session.trackingTargetId = null;
          }
      }

      // --- Bind Sight Updates (SPA 73) ---
      if (tickCount % 5 === 0 && session.bindSightTarget) {
        const bst = session.bindSightTarget;
        const isPlayer = !!bst.char;
        const alive = isPlayer ? (bst.char.hp > 0) : (bst.hp > 0);
        if (alive) {
          const tX = isPlayer ? bst.char.x : bst.x;
          const tY = isPlayer ? bst.char.y : bst.y;
          const tZ = isPlayer ? (bst.char.z || 0) : (bst.z || 0);
          const tH = isPlayer ? (bst.char.heading || 0) : (bst.heading || 0);
          send(session.ws, {
            type: 'BIND_SIGHT',
            active: true,
            targetName: isPlayer ? bst.char.name : bst.name,
            x: tX, y: tY, z: tZ, heading: tH
          });
        } else {
          // Target died — break bind sight
          session.bindSightTarget = null;
          session.bindSightTargetId = null;
          session.buffs = (session.buffs || []).filter(b => !b.isBindSight);
          send(session.ws, { type: 'BIND_SIGHT', active: false });
          sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your sight returns to normal.' }]);
          SpellSystem.sendBuffs(session);
        }
      }

      // --- Group Stat Sync (SPA parity) ---
      if (tickCount % 20 === 0 && session.group && session.group.leaderId === session.char.id) {
        // Only one person per group needs to trigger the update for the whole group
        GroupManager.updateGroupPresence(session.group);
      }
    }

    const aiApi = {
      broadcastMobMove, processPetAI, handlePetDeath, sendCombatLog,
      sessions, handleMobDeath, getWeaponStats: StatsSystem.getWeaponStats, tryInterruptCasting,
      breakSneak: MovementSystem.breakSneak, breakHide: MovementSystem.breakHide, despawnPet,
      breakMez: SpellSystem.breakMez
    };

    for (const zoneId of Object.keys(zoneInstances)) {
      AISystem.processMobAI(zoneInstances[zoneId], zoneId, dt, aiApi);
      SpawningSystem.processRespawns(zoneId, TICK_RATE);
      MiningSystem.processMiningRespawns(zoneId, dt);
    }

    // Process mining cooldowns
    for (const [, session] of sessions) {
      if (session.miningCooldown && session.miningCooldown > 0) {
        session.miningCooldown -= dt;
        if (session.miningCooldown < 0) session.miningCooldown = 0;
      }
    }

    // Persist every 10 ticks (~20 seconds)
    saveCounter++;
    if (saveCounter >= 10) {
      saveCounter = 0;
      for (const [, session] of sessions) {
        DB.updateCharacterState(session.char);
        DB.saveCharacterSkills(session.char.id, session.char.skills);
        SpellSystem.saveBuffsToFile(session);
      }
    }
  }, TICK_RATE);

  console.log(`[ENGINE] Game loop started (${TICK_RATE}ms tick rate).`);
}

// ── AI System moved to systems/ai.js ────────────────────────────────
function processEnvironment() {
  EnvironmentSystem.processEnvironment({
    zoneInstances,
    sessions,
    getZoneDef: ZoneSystem.getZoneDef,
    sendCombatLog
  });

  const now = Date.now();
  for (const zoneKey in zoneInstances) {
      const zone = zoneInstances[zoneKey];
      if (zone.corpses) {
          zone.corpses = zone.corpses.filter(c => {
              if (now >= c.decayTime) {
                  // Poof!
                  return false;
              }
              return true;
          });
      }
  }
}

function handleLook(session, forceSync = false) {
  try {
  const char = session.char;
  const zoneDef = ZoneSystem.getZoneDef(char.zoneId);
  if (!zoneDef) { console.log('[ENGINE] handleLook: no zoneDef for', char.zoneId); return; }

  // Vision Calculation (uses extracted getVisionState)
  const vision = VisionSystem.getVisionState(session, zoneDef);

  // Mobs
  const instance = zoneInstances[char.zoneId];
  const entities = [];

  // Random color helper
  const rHex = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
  
  if (instance) {
      // Send ALL zone mobs to the 3D client — the 3D world is open space, not rooms
      for (const mob of instance.liveMobs) {
          // Distance Check: loadRadius (Robust)
          const distSq = getDistanceSq(mob.x, mob.y, char.x, char.y);
          if (distSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;

          if (!mob.networkData) {
              if (!mob.appearance) {
                  mob.appearance = {
                      hat: rHex(), skin: rHex(), torso: rHex(), legs: rHex(), feet: rHex()
                  };
              }
              // Map npcType to client-side entity type for rendering
              let clientType = 'enemy';
              if (mob.isPet) {
                clientType = 'pet';
              } else if (mob.npcType && mob.npcType !== NPC_TYPES.MOB) {
                clientType = 'npc'; // All non-mob NPCs render as friendly
              }
              mob.networkData = {
                  id: mob.id, name: mob.name, type: clientType, npcType: mob.npcType || NPC_TYPES.MOB,
                  race: mob.race || 1, gender: mob.gender || 0, appearance: mob.appearance,
                  isPet: mob.isPet || false, ownerName: mob.ownerSession ? mob.ownerSession.char.name : null,
                  size: mob.size || 6,
                  maxHp: mob.maxHp,
                  equipVisuals: {
                      head: mob.textures?.h || 0, chest: mob.textures?.t || 0,
                      arms: mob.textures?.a || 0, wrist: mob.textures?.b || 0,
                      hands: mob.textures?.hnd || 0, legs: mob.textures?.l || 0,
                      feet: mob.textures?.f || 0, primaryWeapon: mob.textures?.w1 ? `it${mob.textures.w1}` : '',
                      secondaryWeapon: mob.textures?.w2 ? `it${mob.textures.w2}` : ''
                  }
              };
          }
          entities.push({ ...mob.networkData, x: mob.x, y: mob.y, z: mob.z || 0, heading: mob.heading || 0, hp: mob.hp });
      }

      // ── Corpses ──
      if (instance.corpses) {
          for (const corpse of instance.corpses) {
              const distSq = getDistanceSq(corpse.x, corpse.y, char.x, char.y);
              if (distSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;

              if (!corpse.networkData) {
                  corpse.networkData = {
                      id: corpse.id,
                      name: corpse.name,
                      type: 'corpse',
                      race: corpse.race || 1,
                      gender: corpse.gender || 0,
                      face: corpse.face || 0,
                      appearance: corpse.appearance || {},
                      equipVisuals: corpse.equipVisuals || {},
                      size: corpse.size || 6
                  };
              }
              entities.push({ ...corpse.networkData, x: corpse.x, y: corpse.y, z: corpse.z || 0, heading: corpse.heading || 0, hp: 0 });
          }
      }

      // ── Mining Nodes ──
      if (instance.liveNodes) {
        for (const node of instance.liveNodes) {
          if (!node.alive) continue;
          const nodeDistSq = getDistanceSq(node.x, node.y, char.x, char.y);
          if (nodeDistSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;

          if (!node.networkData) {
            node.networkData = {
              id: node.id,
              name: node.name,
              type: 'mining_node',
              nodeType: node.nodeType,
              tier: node.tier,
              maxHp: node.maxHp
            };
          }
          entities.push({
            ...node.networkData,
            hp: node.hp,
            x: node.x,
            y: node.y,
            z: node.z || 0,
          });
        }
      }
  }

  // Other players (skip self — we already have a local player capsule)
  // Helper for invisibility checks
  const hasBuffSpa = (s, spaId) => s.buffs && s.buffs.some(b => b.effects && b.effects.some(e => e.spa === spaId));
  const hasSeeInvis = hasBuffSpa(session, 13);

  for (const [ws, other] of sessions) {
      if (other.char.zoneId === char.zoneId && other.char.id !== char.id) {
          // Distance check for other players (Robust)
          const pDistSq = getDistanceSq(other.char.x, other.char.y, char.x, char.y);
          if (pDistSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;
          
          // Invisibility Check
          const hasInvis = other.char.isHidden || hasBuffSpa(other, 12) || hasBuffSpa(other, 28) || hasBuffSpa(other, 29);
          if (hasInvis && !hasSeeInvis) {
              continue; // Do not send invisible players to clients who cannot see them
          }

          if (!other.char.appearance) {
              other.char.appearance = {
                  hat: rHex(), skin: rHex(), torso: rHex(), legs: rHex(), feet: rHex()
              };
          }
          if (!other.char.networkData) {
              other.char.networkData = {
                  id: `player_${other.char.id}`, name: other.char.name, type: 'player',
                  race: other.char.raceId || 1, gender: other.char.gender || 0,
                  face: other.char.face || 0, appearance: other.char.appearance
              };
          }
          entities.push({
              ...other.char.networkData,
              pvpFaction: other.char.pvpFaction || 0,
              sizeMod: other.char.sizeMod || 100,
              sneaking: other.char.isSneaking, hidden: other.char.isHidden,
              equipVisuals: getEquipVisuals(other),
              x: other.char.x, y: other.char.y, z: other.char.z || 0, heading: other.char.heading || 0
          });
      }
  }

  const ambienceTrack = (zoneDef && zoneDef.ambience) ? zoneDef.ambience : (char.zoneId + "am");

  if (!session.lastZoneStateEntities) session.lastZoneStateEntities = new Map();
  const currentEntityIds = new Set();
  const deltaEntities = [];
  const removedEntityIds = [];

  for (const ent of entities) {
    currentEntityIds.add(ent.id);
    const oldEnt = session.lastZoneStateEntities.get(ent.id);
    
    // Check if changed
    let changed = forceSync || !oldEnt;
    if (!changed) {
      changed = (
        oldEnt.x !== ent.x || oldEnt.y !== ent.y || oldEnt.z !== ent.z ||
        oldEnt.heading !== ent.heading || oldEnt.hp !== ent.hp ||
        oldEnt.sneaking !== ent.sneaking || oldEnt.hidden !== ent.hidden ||
        oldEnt.appearance !== ent.appearance || oldEnt.equipVisuals !== ent.equipVisuals
      );
    }

    if (changed) {
      deltaEntities.push(ent);
      // store shallow copy of tracked fields to avoid mem leak
      session.lastZoneStateEntities.set(ent.id, {
        x: ent.x, y: ent.y, z: ent.z, heading: ent.heading, hp: ent.hp,
        sneaking: ent.sneaking, hidden: ent.hidden,
        appearance: ent.appearance, equipVisuals: ent.equipVisuals
      });
    }
  }

  // Find removed entities
  for (const oldId of session.lastZoneStateEntities.keys()) {
    if (!currentEntityIds.has(oldId)) {
      removedEntityIds.push(oldId);
      session.lastZoneStateEntities.delete(oldId);
    }
  }

  const payload = { 
    type: 'ZONE_STATE', 
    isDelta: !forceSync,
    entities: forceSync ? entities : deltaEntities, 
    removed: forceSync ? [] : removedEntityIds,
    doors: instance ? (instance.doors || []) : [], 
    ambience: ambienceTrack, 
    vision: {
    renderStyle: vision.renderStyle,
    effectiveness: vision.effectiveness,
    isBlind: vision.isBlind,
    viewDistance: vision.viewDistance,
    ambientLight: vision.ambientLight,
    sensitivityPenalty: vision.sensitivityPenalty,
    timeOfDay: vision.timeOfDay,
    weather: vision.weather,
    weatherName: vision.weatherName,
    weatherIntensity: vision.weatherIntensity,
    weatherRenderEffect: vision.weatherRenderEffect,
    worldHour: vision.worldHour,
    isOutdoor: vision.isOutdoor,
    hasLightSource: vision.hasLightSource,
    availableModes: vision.availableModes,
    season: vision.season,
    dawn: vision.dawn,
    dusk: vision.dusk,
    moons: vision.moons,
  }};
  send(session.ws, payload);
  } catch (err) {
    console.error('[ENGINE] handleLook crashed:', err);
  }
}

// ── Vision Mode Selection ───────────────────────────────────────────

function handleSetVisionMode(session, msg) {
  const requestedMode = msg.mode;

  // 'auto' resets to automatic mode selection (racial/spell)
  if (requestedMode === 'auto' || requestedMode === null) {
    session.activeVisionMode = null;
    const zoneDef = ZoneSystem.getZoneDef(session.char.zoneId);
    const vision = VisionSystem.getVisionState(session, zoneDef);
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=cyan]Vision mode set to automatic. Currently using ${vision.modeName}.[/color]`
    }]);
    sendStatus(session);
    return;
  }

  // Validate the requested mode exists
  if (!VISION_MODES[requestedMode]) {
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=red]Unknown vision mode: ${requestedMode}.[/color]`
    }]);
    return;
  }

  // Validate the player has access to this mode
  const available = VisionSystem.getAvailableVisionModes(session);
  if (!available.includes(requestedMode)) {
    const modeObj = VISION_MODES[requestedMode];
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=red]You do not have access to ${modeObj.name}. Available modes: ${available.join(', ')}.[/color]`
    }]);
    return;
  }

  // Set the mode
  session.activeVisionMode = requestedMode;
  const zoneDef = ZoneSystem.getZoneDef(session.char.zoneId);
  const vision = VisionSystem.getVisionState(session, zoneDef);
  const modeObj = VISION_MODES[requestedMode];

  // Send flavor text + status update
  sendCombatLog(session, [{
    event: 'MESSAGE',
    text: `[color=cyan]${modeObj.description}[/color]`
  }]);

  // Warn about light sensitivity if switching to a sensitive mode in bright conditions
  if (vision.sensitivityPenalty < 0) {
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=yellow]Warning: ${modeObj.name} is impaired in bright conditions (${vision.sensitivityPenalty} penalty).[/color]`
    }]);
  }

  sendStatus(session);
}

function handleSenseHeading(session) {
    const char = session.char;
    const skillName = 'sense_heading';
    
    // Check if character actually knows the skill
    const skillLevel = char.skills && char.skills[skillName] ? char.skills[skillName] : 0;

    // Roll against their skill
    const roll = Math.floor(Math.random() * 200) + 1;
    
    let success = false;
    if (skillLevel > 0) {
        success = roll <= (skillLevel + 20);
    }

    const directions = ["North", "South", "East", "West", "Northwest", "Southeast"];
    const fakeDir = directions[Math.floor(Math.random() * directions.length)];

    let text = "";
    if (success) {
        text = `You are certain that you are facing ${fakeDir}.`;
        combat.trySkillUp(session, skillName);
    } else {
        text = `You have no idea what direction you are facing.`;
    }

    flushSkillUps(session);
    sendCombatLog(session, [{ event: 'MESSAGE', text: text }]);
}

// ── Consider System ─────────────────────────────────────────────────
function handleConsider(session) {
  if (!session.combatTarget) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must have a target to consider.' }]);
  }

  const mob = session.combatTarget;
  
  // Corpse Consider
  if (mob.type === 'corpse') {
      const remainingMs = mob.decayTime - Date.now();
      const remainingMins = Math.floor(remainingMs / 60000);
      const remainingSecs = Math.floor((remainingMs % 60000) / 1000);
      return sendCombatLog(session, [{
          event: 'MESSAGE',
          text: `This corpse will decay in ${remainingMins} minute(s) and ${remainingSecs} second(s).`
      }]);
  }

  const playerLvl = session.char.level;
  const mobLvl = mob.level || 1;
  const diff = mobLvl - playerLvl;

  let color, message;

  if (diff >= 3) {
    color = 'red';
    message = `${mob.name} — what would you like your tombstone to say?`;
  } else if (diff >= 1) {
    color = 'yellow';
    message = playerLvl >= 18
      ? `${mob.name} looks like it would wipe the floor with you!`
      : `${mob.name} looks like quite a gamble.`;
  } else if (diff === 0) {
    color = 'white';
    message = playerLvl >= 18
      ? `${mob.name} appears to be quite formidable.`
      : `${mob.name} looks like an even fight.`;
  } else {
    const blueThreshold = playerLvl < 14 ? -3 : -Math.floor(playerLvl * 0.25);
    if (diff >= blueThreshold) {
      color = 'blue';
      message = playerLvl >= 18
        ? `${mob.name} looks kind of dangerous.`
        : `${mob.name} looks like you would have the upper hand.`;
    } else {
      color = 'green';
      message = `${mob.name} looks like a reasonably safe opponent.`;
    }
  }

  sendCombatLog(session, [{
    event: 'CONSIDER',
    target: mob.name,
    level: mobLvl,
    color: color,
    text: message
  }]);
}

// ── Emote System ────────────────────────────────────────────────────
function handleEmote(session, msg) {
  const emote = msg.emote || '';
  const anim = msg.anim || null;
  if (!emote) return;

  const zoneId = session.char.zoneId;
  for (const [, s] of sessions) {
    if (s.char && s.char.zoneId === zoneId) {
      send(s.ws, {
        type: 'EMOTE',
        charName: session.char.name,
        emote: emote,
        anim: anim
      });
    }
  }
}

// ── Admin Succor (F8) — teleport to zone safe point ──────────────────


//  Teleporter Pad Logic 

async function initZones() {
  return ZoneSystem.initZones();
}

function handleGetTrackingList(session) {
  const char = session.char;
  const skill = combat.getCharSkill(char, 'tracking');
  if (skill <= 0) return;

  let multiplier = 7; // Bard
  if (char.class === 'Ranger') multiplier = 12;
  if (char.class === 'Druid') multiplier = 10;
  const maxRangeSq = (skill * multiplier) * (skill * multiplier);

  const zone = zoneInstances[char.zoneId];
  if (!zone) return;

  const list = [];
  const charLvl = char.level;

  const checkAddEntity = (ent, isPlayer) => {
    if (ent.id === char.id) return;
    const distSq = getDistanceSq(char.x, char.y, ent.x, ent.y);
    if (distSq <= maxRangeSq) {
      const diff = ent.level - charLvl;
      let con = 'green';
      if (diff >= 3) con = 'red';
      else if (diff >= 1) con = 'yellow';
      else if (diff === 0) con = 'white';
      else if (diff >= -2) con = 'blue';
      else if (diff >= -5) con = 'lightblue';
      else if (diff < -5) {
         if (charLvl < 10) con = 'green';
         else con = 'gray'; // trivial
      }

      list.push({
        id: ent.id,
        name: ent.name || ent.originalName,
        dist: Math.sqrt(distSq),
        con: con,
        isPlayer: isPlayer
      });
    }
  };

  if (zone.mobs) {
    for (const mob of Object.values(zone.mobs)) {
      if (mob.hp > 0) checkAddEntity(mob, false);
    }
  }
  for (const p of Object.values(activeSessions)) {
    if (p.char && p.char.zoneId === char.zoneId && p.char.hp > 0) {
      checkAddEntity(p.char, true);
    }
  }

  // Sort by spawn order / default (ID works for now)
  send(session.ws, { type: 'TRACKING_LIST', targets: list });
}

function handleSetTrackingTarget(session, msg) {
  session.trackingTargetId = msg.targetId;
}

function handleClearTracking(session) {
  session.trackingTargetId = null;
}

async function handleHireStudentConfig(session, msg) {
  // msg has: name, raceId, classId, level
  const char = {
    id: 'bot_' + Math.floor(Math.random() * 1000000),
    name: msg.name,
    class: msg.classId,
    race: msg.raceId,
    level: msg.level,
    hp: 100, maxHp: 100, mana: 100, maxMana: 100,
    zoneId: session.char.zoneId,
    x: session.char.x,
    y: session.char.y,
    z: session.char.z || 0,
    heading: session.char.heading || 0,
  };
  
  // Fake WebSocket for the bot
  const fakeWs = { id: char.id, send: () => {}, on: () => {} };
  const botSession = await createSession(fakeWs, char);
  botSession.isBot = true;
  
  // Create AI profile
  if (msg.classId === 2) { // Cleric
    botSession.bot = new ClericBot(botSession);
  } else {
    // Fallback to ClericBot for now
    botSession.bot = new ClericBot(botSession);
  }
  
  // Join the inviter's group
  GroupManager.handleInvite(session, botSession.char.name);
  GroupManager.handleInviteResponse(botSession, true);
  
  // Broadcast entity state to the zone
  const ZoneSystem = require('./systems/zones');
  const zoneDef = ZoneSystem.getZoneDef(char.zoneId);
  const zoneInstances = State.zoneInstances;
  if (!zoneInstances[char.zoneId]) zoneInstances[char.zoneId] = { mobs: {}, pvs: {} };
  
  const MovementSystem = require('./systems/movement');
  MovementSystem.broadcastEntityState(botSession.char, 'spawn');
  
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You have successfully hired ${msg.name}!` }]);
}

module.exports = {
  initZones,
  startGameLoop,
  handleMessage,
  createSession,
  removeSession,
  sessions,
};






