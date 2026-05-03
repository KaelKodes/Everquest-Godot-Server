const Skills = {
    // Vision Abilities
  'normal_vision': {
    name: 'Normal Vision',
    type: 'skill',
    classes: {}
  },
  'weak_normal_vision': {
    name: 'Weak Normal Vision',
    type: 'skill',
    classes: {}
  },
  'infravision': {
    name: 'Infravision',
    type: 'skill',
    classes: {}
  },
  'ultravision': {
    name: 'Ultravision',
    type: 'skill',
    classes: {}
  },
  'cat_eye': {
    name: 'Cat-Eye',
    type: 'skill',
    classes: {}
  },
  'serpent_sight': {
    name: 'Serpent Sight',
    type: 'skill',
    classes: {}
  },

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

  // ══════════════════════════════════════════════════════════════════
  // Active Combat Abilities  (type: 'ability')
  //   → These go on the ABILITIES tab of the Action Panel
  // ══════════════════════════════════════════════════════════════════

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
  },
  'disarm': {
    name: 'Disarm',
    type: 'ability',
    classes: {
      warrior: { levelGranted: 35, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 27, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 27, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 35, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 35, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'double_attack': {
    name: 'Double Attack',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 15, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 15, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 16, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 51, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      beastlord: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'dual_wield': {
    name: 'Dual Wield',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 13, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 13, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      beastlord: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'round_kick': {
    name: 'Round Kick',
    type: 'ability',
    classes: {
      monk: { levelGranted: 5, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'tiger_claw': {
    name: 'Tiger Claw',
    type: 'ability',
    classes: {
      monk: { levelGranted: 10, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'eagle_strike': {
    name: 'Eagle Strike',
    type: 'ability',
    classes: {
      monk: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'dragon_punch': {
    name: 'Dragon Punch',
    type: 'ability',
    classes: {
      monk: { levelGranted: 25, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'flying_kick': {
    name: 'Flying Kick',
    type: 'ability',
    classes: {
      monk: { levelGranted: 30, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'feign_death': {
    name: 'Feign Death',
    type: 'ability',
    classes: {
      monk: { levelGranted: 17, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      necromancer: { levelGranted: 16, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      shadowknight: { levelGranted: 27, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
    }
  },
  'mend': {
    name: 'Mend',
    type: 'ability',
    classes: {
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
    }
  },
  'intimidation': {
    name: 'Intimidation',
    type: 'ability',
    classes: {
      warrior: { levelGranted: 22, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 22, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 18, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'slam': {
    name: 'Slam',
    type: 'ability',
    // Racial ability for large races (Barbarian, Ogre, Troll) — not class-trained
    classes: {}
  },
  'harm_touch': {
    name: 'Harm Touch',
    type: 'ability',
    classes: {
      shadowknight: { levelGranted: 1, capFormula: () => 1, maxCap: 1 },
    }
  },
  'lay_on_hands': {
    name: 'Lay on Hands',
    type: 'ability',
    classes: {
      paladin: { levelGranted: 1, capFormula: () => 1, maxCap: 1 },
    }
  },
  'instill_doubt': {
    name: 'Instill Doubt',
    type: 'ability',
    classes: {
      monk: { levelGranted: 30, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
    }
  },
  'riposte': {
    name: 'Riposte',
    type: 'ability',
    classes: {
      warrior: { levelGranted: 25, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 25, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 30, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 35, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 30, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 30, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 58, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      beastlord: { levelGranted: 25, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },

  // ══════════════════════════════════════════════════════════════════
  // Utility Skills  (type: 'skill')
  //   → These go on the SKILLS tab of the Action Panel
  //   → Non-combat actions the player actively triggers
  // ══════════════════════════════════════════════════════════════════

  'hide': {
    name: 'Hide',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 3, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      bard: { levelGranted: 25, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
      ranger: { levelGranted: 25, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
      shadowknight: { levelGranted: 35, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
    }
  },
  'sneak': {
    name: 'Sneak',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      bard: { levelGranted: 17, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
      ranger: { levelGranted: 10, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
      monk: { levelGranted: 8, capFormula: (level) => Math.min((level * 5) + 5, 113), maxCap: 113 },
      beastlord: { levelGranted: 20, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
    }
  },
  'tracking': {
    name: 'Tracking',
    type: 'skill',
    classes: {
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      druid: { levelGranted: 20, capFormula: (level) => Math.min((level * 5) + 5, 50), maxCap: 50 },
      bard: { levelGranted: 1, capFormula: (level) => Math.min((level * 5) + 5, 100), maxCap: 100 },
    }
  },
  'foraging': {
    name: 'Forage',
    type: 'skill',
    classes: {
      ranger: { levelGranted: 3, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      druid: { levelGranted: 5, capFormula: (level) => Math.min((level * 5) + 5, 55), maxCap: 55 },
      bard: { levelGranted: 12, capFormula: (level) => Math.min((level * 5) + 5, 55), maxCap: 55 },
      beastlord: { levelGranted: 3, capFormula: (level) => Math.min((level * 5) + 5, 55), maxCap: 55 },
    }
  },
  'bind_wound': {
    name: 'Bind Wound',
    type: 'skill',
    classes: {} // Given to all classes at level 1, handled in ALL_CLASSES loop below
  },
  'sense_heading': {
    name: 'Sense Heading',
    type: 'skill',
    classes: {} // Given to all classes at level 1, handled in ALL_CLASSES loop below
  },
  'swimming': {
    name: 'Swimming',
    type: 'skill',
    classes: {} // Given to all classes at level 1, handled in ALL_CLASSES loop below
  },
  'fishing': {
    name: 'Fishing',
    type: 'skill',
    classes: {} // Given to all classes at level 1, handled in ALL_CLASSES loop below
  },
  'begging': {
    name: 'Begging',
    type: 'skill',
    classes: {} // Given to all classes at level 1, handled in ALL_CLASSES loop below
  },
  'alcohol_tolerance': {
    name: 'Alcohol Tolerance',
    type: 'skill',
    classes: {} // Given to all classes at level 1, handled in ALL_CLASSES loop below
  },
  'pick_lock': {
    name: 'Pick Lock',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 6, capFormula: (level) => (level * 5) + 5, maxCap: 210 },
      bard: { levelGranted: 40, capFormula: (level) => Math.min((level * 5) + 5, 210), maxCap: 210 },
    }
  },
  'pick_pocket': {
    name: 'Pick Pocket',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 7, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
    }
  },
  'sense_traps': {
    name: 'Sense Traps',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 10, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      bard: { levelGranted: 20, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
    }
  },
  'disarm_traps': {
    name: 'Disarm Traps',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 15, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      bard: { levelGranted: 25, capFormula: (level) => Math.min((level * 5) + 5, 75), maxCap: 75 },
    }
  },
  'safe_fall': {
    name: 'Safe Fall',
    type: 'skill',
    classes: {
      monk: { levelGranted: 3, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
      rogue: { levelGranted: 12, capFormula: (level) => Math.min((level * 5) + 5, 94), maxCap: 94 },
      bard: { levelGranted: 24, capFormula: (level) => Math.min((level * 5) + 5, 40), maxCap: 40 },
    }
  },
  'apply_poison': {
    name: 'Apply Poison',
    type: 'skill',
    classes: {
      rogue: { levelGranted: 18, capFormula: (level) => (level * 5) + 5, maxCap: 200 },
    }
  },

  // ══════════════════════════════════════════════════════════════════
  // Bard Instrument Skills  (type: 'skill')
  //   → Performance skills usable from the Skills tab
  // ══════════════════════════════════════════════════════════════════

  'singing': {
    name: 'Singing',
    type: 'skill',
    classes: {
      bard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'brass_instruments': {
    name: 'Brass Instruments',
    type: 'skill',
    classes: {
      bard: { levelGranted: 5, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'percussion': {
    name: 'Percussion Instruments',
    type: 'skill',
    classes: {
      bard: { levelGranted: 5, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'stringed_instruments': {
    name: 'Stringed Instruments',
    type: 'skill',
    classes: {
      bard: { levelGranted: 5, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'wind_instruments': {
    name: 'Wind Instruments',
    type: 'skill',
    classes: {
      bard: { levelGranted: 5, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },

  // ══════════════════════════════════════════════════════════════════
  // Additional Spell / Casting Skills  (type: 'magic')
  // ══════════════════════════════════════════════════════════════════

  'divination': {
    name: 'Divination',
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
  'conjuration': {
    name: 'Conjuration',
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
  'channeling': {
    name: 'Channeling',
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
      bard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'meditate': {
    name: 'Meditate',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      druid: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      shaman: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      enchanter: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      wizard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      magician: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      necromancer: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      paladin: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      shadowknight: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      ranger: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
      beastlord: { levelGranted: 9, capFormula: (level) => (level * 5) + 5, maxCap: 300 },
    }
  },

  // Spell Specializations (pure casters + priests, level 20+)
  'specialize_abjure': {
    name: 'Specialize Abjure',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'specialize_alteration': {
    name: 'Specialize Alteration',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'specialize_conjuration': {
    name: 'Specialize Conjuration',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'specialize_divination': {
    name: 'Specialize Divination',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'specialize_evocation': {
    name: 'Specialize Evocation',
    type: 'magic',
    classes: {
      cleric: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shaman: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      enchanter: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      wizard: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      magician: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      necromancer: { levelGranted: 20, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },

  // Additional combat skills
  '2h_slashing': {
    name: '2H Slashing',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      bard: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  '2h_blunt': {
    name: '2H Blunt',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      cleric: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      druid: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      monk: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'archery': {
    name: 'Archery',
    type: 'combat',
    classes: {
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      paladin: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      shadowknight: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'throwing': {
    name: 'Throwing',
    type: 'combat',
    classes: {
      warrior: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      rogue: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
      ranger: { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },
  'block': {
    name: 'Block',
    type: 'defense',
    classes: {
      monk: { levelGranted: 12, capFormula: (level) => (level * 5) + 5, maxCap: 255 },
    }
  },

  // ══════════════════════════════════════════════════════════════════
  // Language Skills  (type: 'language')
  //   → All languages cap at 100, available to all classes at level 1
  // ══════════════════════════════════════════════════════════════════

  'lang_common_tongue': { name: 'Common Tongue', type: 'language', classes: {} },
  'lang_barbarian': { name: 'Barbarian', type: 'language', classes: {} },
  'lang_erudian': { name: 'Erudian', type: 'language', classes: {} },
  'lang_elvish': { name: 'Elvish', type: 'language', classes: {} },
  'lang_dark_elvish': { name: 'Dark Elvish', type: 'language', classes: {} },
  'lang_dwarvish': { name: 'Dwarvish', type: 'language', classes: {} },
  'lang_troll': { name: 'Troll', type: 'language', classes: {} },
  'lang_ogre': { name: 'Ogre', type: 'language', classes: {} },
  'lang_gnomish': { name: 'Gnomish', type: 'language', classes: {} },
  'lang_halfling': { name: 'Halfling', type: 'language', classes: {} },
  'lang_thieves_cant': { name: 'Thieves Cant', type: 'language', classes: {} },
  'lang_old_erudian': { name: 'Old Erudian', type: 'language', classes: {} },
  'lang_elder_elvish': { name: 'Elder Elvish', type: 'language', classes: {} },
  'lang_froglok': { name: 'Froglok', type: 'language', classes: {} },
  'lang_goblin': { name: 'Goblin', type: 'language', classes: {} },
  'lang_gnoll': { name: 'Gnoll', type: 'language', classes: {} },
  'lang_combine_tongue': { name: 'Combine Tongue', type: 'language', classes: {} },
  'lang_elder_dragon': { name: 'Elder Dragon', type: 'language', classes: {} },
  'lang_dark_speech': { name: 'Dark Speech', type: 'language', classes: {} },
  'lang_vah_shir': { name: 'Vah Shir', type: 'language', classes: {} },

  // ══════════════════════════════════════════════════════════════════
  // Tradeskills  (type: 'tradeskill')
  //   → Future crafting system; tracked but not assigned to Action Panel
  // ══════════════════════════════════════════════════════════════════

  'baking': { name: 'Baking', type: 'tradeskill', classes: {} },
  'blacksmithing': { name: 'Blacksmithing', type: 'tradeskill', classes: {} },
  'brewing_ts': { name: 'Brewing', type: 'tradeskill', classes: {} },
  'fletching': { name: 'Fletching', type: 'tradeskill', classes: {} },
  'jewelcrafting': { name: 'Jewelcrafting', type: 'tradeskill', classes: {} },
  'pottery_ts': { name: 'Pottery', type: 'tradeskill', classes: {} },
  'tailoring': { name: 'Tailoring', type: 'tradeskill', classes: {} },
  'alchemy': {
    name: 'Alchemy',
    type: 'tradeskill',
    classes: {
      shaman: { levelGranted: 25, capFormula: () => 250, maxCap: 250 },
    }
  },
  'poison_making': {
    name: 'Poison Making',
    type: 'tradeskill',
    classes: {
      rogue: { levelGranted: 20, capFormula: () => 250, maxCap: 250 },
    }
  },
  'research': {
    name: 'Research',
    type: 'tradeskill',
    classes: {
      magician: { levelGranted: 16, capFormula: () => 200, maxCap: 200 },
      necromancer: { levelGranted: 16, capFormula: () => 200, maxCap: 200 },
      enchanter: { levelGranted: 16, capFormula: () => 200, maxCap: 200 },
      wizard: { levelGranted: 16, capFormula: () => 200, maxCap: 200 },
    }
  },
  'tinkering': {
    name: 'Tinkering',
    type: 'tradeskill',
    // Gnome racial tradeskill — handled by race, not class
    classes: {}
  },
  'mining': {
    name: 'Mining',
    type: 'tradeskill',
    // Universal gathering skill — all classes, flat cap 250 (level-scaling TBD)
    classes: {}
  },
};

const ALL_CLASSES = [
  'warrior', 'cleric', 'paladin', 'ranger', 'shadowknight', 'druid', 'monk', 
  'bard', 'rogue', 'shaman', 'necromancer', 'wizard', 'magician', 'enchanter', 'beastlord'
];

// ── Universal skills: give to all classes ──
const universalSkills = ['offense', 'defense', 'bind_wound', 'sense_heading', 'swimming', 'fishing', 'begging', 'alcohol_tolerance'];
ALL_CLASSES.forEach(c => {
  universalSkills.forEach(skillKey => {
    if (Skills[skillKey] && !Skills[skillKey].classes[c]) {
      Skills[skillKey].classes[c] = { levelGranted: 1, capFormula: (level) => (level * 5) + 5, maxCap: 200 };
    }
  });
});

// ── All tradeskills available to all classes (level 1, cap 250) ──
const universalTradeskills = ['baking', 'blacksmithing', 'brewing_ts', 'fletching', 'jewelcrafting', 'pottery_ts', 'tailoring', 'mining'];
ALL_CLASSES.forEach(c => {
  universalTradeskills.forEach(skillKey => {
    if (Skills[skillKey] && !Skills[skillKey].classes[c]) {
      Skills[skillKey].classes[c] = { levelGranted: 1, capFormula: () => 250, maxCap: 250 };
    }
  });
});

// ── All languages available to all classes (level 1, cap 100) ──
const universalLanguages = Object.keys(Skills).filter(k => k.startsWith('lang_'));
ALL_CLASSES.forEach(c => {
  universalLanguages.forEach(skillKey => {
    if (Skills[skillKey] && !Skills[skillKey].classes[c]) {
      Skills[skillKey].classes[c] = { levelGranted: 1, capFormula: () => 100, maxCap: 100 };
    }
  });
});
// ── Racial innate skills (race-based, not class-based) ──
// These grant the skill at level 1 with a hard cap, regardless of class.
// If the class ALSO has the skill, the class cap takes precedence (it's always higher).
const RACIAL_SKILLS = {
  dark_elf: {
    hide: { levelGranted: 1, capFormula: () => 50, maxCap: 50 }
  },
  wood_elf: {
    hide: { levelGranted: 1, capFormula: () => 50, maxCap: 50 }
  },
  halfling: {
    hide:  { levelGranted: 1, capFormula: () => 50, maxCap: 50 },
    sneak: { levelGranted: 1, capFormula: () => 50, maxCap: 50 }
  }
};

// ── Racial Starting Skill Bonuses ───────────────────────────────────
// Some races begin with higher skill values in certain tradeskills.
// These are applied once during character creation.
const RACIAL_STARTING_SKILLS = {
  barbarian: { 'normal_vision': 1 },
  dark_elf:  { 'weak_normal_vision': 1, 'infravision': 1, 'ultravision': 1 },
  dwarf:     { 'normal_vision': 1, 'infravision': 1, 'mining': 10 },
  erudite:   { 'normal_vision': 1 },
  gnome:     { 'normal_vision': 1, 'ultravision': 1, 'mining': 5 },
  half_elf:  { 'normal_vision': 1, 'infravision': 1 },
  halfling:  { 'normal_vision': 1, 'infravision': 1 },
  high_elf:  { 'normal_vision': 1, 'infravision': 1 },
  human:     { 'normal_vision': 1 },
  iksar:     { 'normal_vision': 1, 'serpent_sight': 1 },
  ogre:      { 'weak_normal_vision': 1, 'infravision': 1 },
  troll:     { 'normal_vision': 1, 'ultravision': 1 },
  vah_shir:  { 'normal_vision': 1, 'cat_eye': 1 },
  wood_elf:  { 'normal_vision': 1, 'ultravision': 1 },
  froglok:   { 'normal_vision': 1, 'serpent_sight': 1 },
};

module.exports = { Skills, RACIAL_SKILLS, RACIAL_STARTING_SKILLS };



