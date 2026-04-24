const Skills = {
  // Combat Skills
  '1h_slashing': {
    name: '1H Slashing',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  '1h_blunt': {
    name: '1H Blunt',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      cleric: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      beastlord: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'piercing': {
    name: 'Piercing',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'hand_to_hand': {
    name: 'Hand To Hand',
    type: 'combat',
    classes: {
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      beastlord: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'offense': {
    name: 'Offense',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'defense': {
    name: 'Defense',
    type: 'defense',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'dodge': {
    name: 'Dodge',
    type: 'defense',
    classes: {
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 4, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      warrior: { levelGranted: 6, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 8, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 10, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 10, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      beastlord: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      cleric: { levelGranted: 15, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 15, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 15, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 22, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 22, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 22, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 22, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'parry': {
    name: 'Parry',
    type: 'defense',
    classes: {
      warrior: { levelGranted: 10, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 12, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 53, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  
  // Spell Skills
  'evocation': {
    name: 'Evocation',
    type: 'magic',
    classes: {
      wizard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      cleric: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'alteration': {
    name: 'Alteration',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'abjuration': {
    name: 'Abjuration',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  
  // Active Abilities
  'kick': {
    name: 'Kick',
    type: 'ability',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 5, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'bash': {
    name: 'Bash',
    type: 'ability',
    classes: {
      warrior: { levelGranted: 6, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 6, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 6, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'taunt': {
    name: 'Taunt',
    type: 'ability',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'backstab': {
    name: 'Backstab',
    type: 'ability',
    classes: {
      rogue: { levelGranted: 10, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  }
};

const ALL_CLASSES = [
  'warrior', 'cleric', 'paladin', 'ranger', 'shadowknight', 'druid', 'monk', 
  'bard', 'rogue', 'shaman', 'necromancer', 'wizard', 'magician', 'enchanter', 'beastlord'
];

// Give offense and defense to everyone
ALL_CLASSES.forEach(c => {
  if (!Skills['offense'].classes[c]) Skills['offense'].classes[c] = { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 };
  if (!Skills['defense'].classes[c]) Skills['defense'].classes[c] = { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 };
});

module.exports = { Skills };
