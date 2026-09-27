'use strict';

const BaseBot = require('./baseBot');
const ClericBot = require('./profiles/cleric');
const EnchanterBot = require('./profiles/enchanter');
const RogueBot = require('./profiles/rogue');

/**
 * Class brain for a bot session. A class without a profile yet follows
 * and meds, and does not borrow the cleric spell list.
 */
function createClassBot(session) {
  const cls = session && session.char && session.char.class;
  if (cls === 'enchanter') return new EnchanterBot(session);
  if (cls === 'cleric') return new ClericBot(session);
  if (cls === 'rogue') return new RogueBot(session);
  return new BaseBot(session);
}

module.exports = { createClassBot };
