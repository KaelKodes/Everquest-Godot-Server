/**
 * Tradeskill System
 * Handles recipe lookups, combining, and experimentation.
 */

const State = require('../state');
const { send } = require('../utils');
const DB = require('../db');
const eqemuDB = require('../eqemu_db');

let ItemDB, ITEMS, sendCombatLog, sendInventory, sendStatus;

const TRADESKILL_ID = {
  BAKING: 60,
  TAILORING: 61,
  BLACKSMITHING: 63,
  BREWING: 65,
  POTTERY: 69,
  JEWELRY: 68,
  FLETCHING: 64,
  POISON_MAKING: 56,
  ALCHEMY: 59,
  RESEARCH: 58
};

function init(deps) {
  ItemDB = deps.itemDb;
  ITEMS = deps.items;
  sendCombatLog = deps.sendCombatLog;
  sendInventory = deps.sendInventory;
  sendStatus = deps.sendStatus;
}

/**
 * Loads recipes for a specific station type.
 * @param {number} tradeskillId
 */
async function getRecipesForStation(tradeskillId) {
  // We'll add this to eqemu_db.js
  return await eqemuDB.getRecipesByTradeskill(tradeskillId);
}

/**
 * Handles opening a tradeskill station.
 */
async function handleOpenStation(session, msg) {
  const { stationType, npcId } = msg; // stationType is name or ID
  const tradeskillId = TRADESKILL_ID[String(stationType).toUpperCase()] || parseInt(stationType);

  if (isNaN(tradeskillId)) {
    console.error(`[TRADESKILL] Invalid station type: ${stationType}`);
    return;
  }

  // Get known recipes for this character and station
  const recipes = await eqemuDB.getRecipesByTradeskill(tradeskillId);
  const learnedRows = await eqemuDB.getLearnedRecipes(session.char.id);
  const learnedIds = new Set(learnedRows.map(l => l.recipe_id));
  
  // Filter: show if !must_learn OR if already learned
  const knownRecipes = recipes.filter(r => r.must_learn === 0 || learnedIds.has(r.id));

  // Send to client
  send(session.ws, {
    type: 'TRADESKILL_STATION_OPEN',
    tradeskillId,
    stationName: stationType,
    recipes: knownRecipes.map(r => ({
      id: r.id,
      name: r.name,
      trivial: r.trivial,
      skillNeeded: r.skillneeded
    }))
  });
}

/**
 * Handles the combine attempt.
 */
async function handleCombine(session, msg) {
  const { tradeskillId, components } = msg; // components: array of { itemId, qty }
  const char = session.char;

  // 1. Identify the recipe
  const recipe = await identifyRecipe(tradeskillId, components);

  if (!recipe) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot combine these items in this way.' }]);
    return;
  }

  // 2. Perform skill check
  const skillName = getSkillName(tradeskillId);
  const currentSkill = require('../combat').getCharSkill(char, skillName);
  
  const successChance = calculateSuccessChance(currentSkill, recipe.skillneeded, recipe.trivial);
  const isSuccess = Math.random() * 100 < successChance;

  // 3. Process results
  const results = isSuccess ? recipe.successResults : recipe.failResults;
  
  // Consume ingredients
  await consumeIngredients(session, components);

  if (isSuccess) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You have fashioned a ${recipe.name}!` }]);
    
    // Record that they made/learned this recipe
    await eqemuDB.addLearnedRecipe(char.id, recipe.id);

    // Add results to inventory
    for (const res of results) {
      await DB.addInventoryItem(char.id, res.itemId, 0, -1, res.count);
    }
    
    // Check for skill up
    if (currentSkill < recipe.trivial) {
      require('../combat').trySkillUp(session, skillName);
    }
  } else {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You lacked the skill to fashion the items together.' }]);
    // Give back failed items if any
    for (const res of results) {
      if (res.count > 0) {
        await DB.addInventoryItem(char.id, res.itemId, 0, -1, res.count);
      }
    }
  }

  // Refresh inventory
  session.inventory = await DB.getInventory(char.id);
  sendInventory(session);
  sendStatus(session);
}

async function identifyRecipe(tradeskillId, components) {
  // 1. Get all recipes for this station
  const recipes = await eqemuDB.getRecipesByTradeskill(tradeskillId);

  // 2. Count component occurrences in the combine request
  const componentCounts = new Map();
  for (const c of components) {
    componentCounts.set(c.itemId, (componentCounts.get(c.itemId) || 0) + c.qty);
  }

  // 3. Find a recipe where the components match exactly
  for (const recipe of recipes) {
    if (recipe.components.length === 0) continue;

    let match = true;
    const recipeCounts = new Map();
    for (const entry of recipe.components) {
      recipeCounts.set(entry.itemId, (recipeCounts.get(entry.itemId) || 0) + entry.componentCount);
    }

    // Check if counts match
    if (recipeCounts.size !== componentCounts.size) continue;

    for (const [itemId, count] of recipeCounts) {
      if (componentCounts.get(itemId) !== count) {
        match = false;
        break;
      }
    }

    if (match) return recipe;
  }

  return null;
}

function calculateSuccessChance(skill, minReq, trivial) {
  if (skill < minReq) return 0;
  if (skill >= trivial) return 95; // Always 5% fail chance in classic
  
  const diff = trivial - minReq;
  if (diff <= 0) return 95;
  
  const progress = (skill - minReq) / diff;
  return 25 + (progress * 70); // 25% at min, 95% at trivial
}

function getSkillName(tradeskillId) {
  const map = {
    [TRADESKILL_ID.BAKING]: 'baking',
    [TRADESKILL_ID.TAILORING]: 'tailoring',
    [TRADESKILL_ID.BLACKSMITHING]: 'blacksmithing',
    [TRADESKILL_ID.BREWING]: 'brewing',
    [TRADESKILL_ID.POTTERY]: 'pottery',
    [TRADESKILL_ID.JEWELRY]: 'jewelry_making',
    [TRADESKILL_ID.FLETCHING]: 'fletching',
    [TRADESKILL_ID.POISON_MAKING]: 'make_poison',
    [TRADESKILL_ID.ALCHEMY]: 'alchemy',
    [TRADESKILL_ID.RESEARCH]: 'research'
  };
  return map[tradeskillId] || 'alchemy';
}

async function consumeIngredients(session, components) {
  const char = session.char;
  for (const c of components) {
    // If slot is provided (e.g. from a specific station UI slot), use it.
    if (c.slot !== undefined) {
      await DB.deleteItem(char.id, c.itemId, c.slot);
    } else {
      // Find the first matching item in inventory
      const invRow = session.inventory.find(i => i.item_key === c.itemId || i.item_id === c.itemId);
      if (invRow) {
        await DB.deleteItem(char.id, invRow.item_key, invRow.slot);
      }
    }
  }
}

module.exports = {
  init,
  handleOpenStation,
  handleCombine
};
