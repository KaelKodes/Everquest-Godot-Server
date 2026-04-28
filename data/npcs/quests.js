// ── Quest Dialog System ──────────────────────────────────────────────
// Keyword-based dialog trees for Quest NPCs.
//
// FORMAT:
//   Each NPC key maps to a dialog object with:
//     - hail:     The initial response when a player hails the NPC.
//     - keywords: A map of [keyword] → response text.
//                 Keywords in response text are wrapped in [brackets] to
//                 indicate clickable/typeable keywords for the player.
//
// The server parses player /say text for keywords and returns the
// matching response. Keywords are case-insensitive.
//
// Substitution tokens:
//   {player}  → replaced with the player's character name
//   {class}   → replaced with the player's class name
//   {race}    → replaced with the player's race

const NPC_DIALOGS = {

  // ─── Qeynos Hills ─────────────────────────────────────────────────

  yollis_jenkins: {
    hail: 'Hail, {player}! Be careful out here in the hills. The [gnolls] have been more aggressive lately, and the [undead] stir at night.',
    keywords: {
      gnolls: 'The gnolls from Blackburrow have been raiding the countryside. If you could bring me four [gnoll fangs], I would reward you for your efforts.',
      undead: 'The skeletons wander these hills after dark. Nobody knows where they come from. Some say the necromancer [Neclo] has something to do with it.',
      neclo: 'Neclo Rheslar... that dark man camps somewhere in the hills. I would not approach him if I were you, but if you are brave, perhaps you can learn something.',
      'gnoll fangs': 'Yes! Bring me four gnoll fangs and I shall reward you handsomely. The people of Qeynos will be in your debt.',
    },
  },

  neclo_rheslar: {
    hail: 'What do you want? Can you not see I am [busy]? Leave me be unless you have something [useful] to offer.',
    keywords: {
      busy: 'I am conducting research into the nature of undeath. The [bone chips] scattered across these hills are of particular interest to me.',
      useful: 'If you have [bone chips], I would be willing to trade for them. The dead hold many secrets.',
      'bone chips': 'Yes, bone chips. Bring me four bone chips and I will share some of my... knowledge with you. The dead speak to those who listen.',
    },
  },

  sir_edwin_motte: {
    hail: 'Well met, {player}. I am Sir Edwin Motte, Knight of the Thunder. Are you here to serve the [people of Qeynos]?',
    keywords: {
      'people of qeynos': 'The people need brave souls to defend them. The [gnolls] threaten our borders and the [undead] menace our roads at night. Will you help?',
      gnolls: 'Blackburrow is a festering pit of gnoll activity. We need warriors to thin their numbers. Bring me proof of your deeds — [gnoll scalps] will suffice.',
      undead: 'The walking dead are an abomination. If you can destroy them, bring me [bone chips] as proof. You will be rewarded.',
      'gnoll scalps': 'Bring me gnoll scalps and I will see that you are properly compensated for your service to Qeynos.',
    },
  },

  hadden: {
    hail: 'Hello there, {player}. Beautiful day for [fishing], wouldn\'t you say?',
    keywords: {
      fishing: 'Aye, I spend my days here at the lake. The fishing is good, though the [bears] sometimes come too close for comfort.',
      bears: 'The brown bears around here are mostly harmless unless you get too close. But I have heard rumors of a [rabid grizzly] deeper in the hills.',
      'rabid grizzly': 'A terrible beast, foaming at the mouth. If someone were to put it down, the hills would be safer for everyone.',
    },
  },

  konem_matse: {
    hail: 'Greetings, {player}. I study the [wildlife] of these hills. There is much to learn from observing nature.',
    keywords: {
      wildlife: 'The ecosystem here is fascinating. The [wolves], [snakes], and [bears] all play their part. But something has been [disrupting] the balance.',
      wolves: 'The gray wolves are native to these hills. They are generally not aggressive unless provoked. But the [rabid wolves] are another matter entirely.',
      snakes: 'The king snakes here are quite venomous. Be careful where you step. Their [venom sacs] are valuable to alchemists.',
      bears: 'Brown bears and grizzlies roam the hillsides. They are magnificent creatures, but dangerous when startled.',
      disrupting: 'I believe the gnoll incursions from Blackburrow are disrupting the natural order. The animals are becoming more aggressive as their territory shrinks.',
      'rabid wolves': 'Something has infected some of the wolves with a terrible disease. They foam at the mouth and attack anything that moves.',
      'venom sacs': 'If you can collect king snake venom sacs, I would be very interested in studying them. Bring me some and I will compensate you.',
    },
  },

  buzzlin_bornahm: {
    hail: 'Hail, traveler! Name\'s Buzzlin. I\'m a [merchant] of sorts, though I\'ve fallen on hard times.',
    keywords: {
      merchant: 'I used to run a caravan between Qeynos and Highpass Hold, but the [bandits] and [gnolls] have made the roads too dangerous.',
      bandits: 'Aye, brigands lurk along the roads through Karana. A strong adventurer might clear the way for honest folk like me.',
      gnolls: 'Those mangy dogs from Blackburrow have been raiding travelers on the road. It\'s not safe anymore.',
    },
  },

  // ─── West Karana ───────────────────────────────────────────────────

  brother_estle: {
    hail: 'Blessings of Quellious upon you, {player}. I am Brother Estle of the [Monks of the Silent Fist].',
    keywords: {
      'monks of the silent fist': 'We walk the path of discipline and inner peace. If you seek [training] in the martial arts, speak with our masters in Qeynos.',
      training: 'The path of the monk requires dedication. We train our bodies as weapons and our minds as shields.',
    },
  },

  brother_trintle: {
    hail: 'Peace be with you, {player}. The [plains] hold both beauty and danger.',
    keywords: {
      plains: 'West Karana stretches far and wide. Beware the [wolves] that hunt in packs and the [undead] that rise at dusk.',
      wolves: 'The shadow wolves here are far more dangerous than the gray wolves of the hills. They hunt with cunning intelligence.',
      undead: 'Zombie yeomen wander these fields — the restless dead of farmers long past.',
    },
  },

  brother_chintle: {
    hail: 'Walk in peace, {player}. Have you come seeking [wisdom]?',
    keywords: {
      wisdom: 'True wisdom comes from understanding the world around you. Observe the [treants] and learn patience. Watch the [lions] and learn courage.',
      treants: 'The treants of Karana are ancient beings. They protect the groves and do not take kindly to those who harm the forest.',
      lions: 'The plains lions are noble predators. They hunt only what they need and protect their pride fiercely.',
    },
  },

  misty_storyswapper: {
    hail: 'Oh hello, {player}! Would you like to hear a [story]? I collect tales from all across Norrath!',
    keywords: {
      story: 'I have heard tales of a great [cyclops] that roams these plains, and of [hill giants] that come down from the mountains to hunt.',
      cyclops: 'They say a cyclops named Grepdo wanders the southern reaches. He carries treasures from raiders he has crushed.',
      'hill giants': 'The hill giants are massive brutes. They are slow but incredibly strong. Many an adventurer has met their end underestimating one.',
    },
  },

  ollysa_bladefinder: {
    hail: 'Hail, {player}. I am Ollysa Bladefinder. I seek the legendary [Qeynos Claymore] — have you heard of it?',
    keywords: {
      'qeynos claymore': 'The Qeynos Claymore is a weapon of great power, forged in the early days of the city. It was lost when its bearer fell in [battle] against the gnolls.',
      battle: 'The battle took place near Blackburrow, long ago. The blade may still be somewhere in those dark tunnels, guarded by the gnoll chieftain.',
    },
  },

  konia_swiftfoot: {
    hail: 'Well met, {player}. I am Konia Swiftfoot, ranger of the Jaggedpine. The [plains] are my home.',
    keywords: {
      plains: 'I patrol these grasslands, keeping watch for [threats] to the travelers and farmers who live here.',
      threats: 'Bandits, ogres, and worse prowl these lands. If you seek to help, speak to the [guards] at the outpost.',
      guards: 'The outpost guards can always use help. Speak with them if you wish to lend your blade to the defense of Karana.',
    },
  },

  mistrana_two_notes: {
    hail: 'Hello, {player}! I am Mistrana Two-Notes, bard extraordinaire! Shall I play you a [song]?',
    keywords: {
      song: 'Music is the language of the soul. I travel these lands collecting [melodies] and spreading joy wherever I go.',
      melodies: 'Each region of Norrath has its own musical traditions. The farmers here sing working songs, while the monks chant in meditation.',
    },
  },

  thurgen_thunderhead: {
    hail: 'Hail, {player}! By Brell\'s beard, you look like someone who can handle themselves. Are you looking for [work]?',
    keywords: {
      work: 'The [ogres] from the south have been stirring up trouble. And those blasted [scarecrows] in the fields have come alive somehow!',
      ogres: 'Ogre raiders come from Oggok sometimes, looking for easy prey. If you can drive them back, the farmers would be grateful.',
      scarecrows: 'Something foul has animated the scarecrows in the fields. They attack anyone who gets close. Might be dark magic at work.',
    },
  },

  // ─── North Karana ──────────────────────────────────────────────────

  cordelia_minster: {
    hail: 'Ah, {player}. Welcome to North Karana. These grasslands are home to many [dangers], but also great beauty.',
    keywords: {
      dangers: 'The [griffons] circle overhead, always watching. And the [ghouls] lurk in the shadows, waiting for prey.',
      griffons: 'Magnificent creatures, but deadly. They will snatch up a halfling without a second thought. Best to avoid [Grimfeather] — the alpha.',
      ghouls: 'The undead here are stronger than those in the southern zones. Be well-prepared before engaging them.',
      grimfeather: 'Grimfeather is the most powerful griffon in all of Karana. Only the bravest adventurers dare challenge him.',
    },
  },

  cory_bumbleye: {
    hail: 'Hiya, {player}! I\'m Cory Bumbleye! I\'m looking for [bugs]!',
    keywords: {
      bugs: 'I love collecting [beetles]! The pincer beetles and borer beetles here are so fascinating! Do you have any [beetle legs] for me?',
      beetles: 'The beetles in North Karana come in many varieties. My favorite are the scythe beetles — so pointy!',
      'beetle legs': 'If you bring me beetle legs, I\'ll trade you something nice! I just love studying how they walk.',
    },
  },

  fixxin_followig: {
    hail: 'Greetings, {player}. I am Fixxin Followig. I study the [ecology] of the Karana plains.',
    keywords: {
      ecology: 'The balance of nature here is delicate. The [treants] protect the groves while the [lions] keep the prey populations in check.',
      treants: 'Ancient guardians of the forest. Approach them with respect and they may share their wisdom.',
      lions: 'The highland lions here are the apex predators of the plains. Magnificent and deadly.',
    },
  },

  brother_nallin: {
    hail: 'Peace, {player}. I travel the road between Qeynos and the eastern lands, spreading the word of [Quellious].',
    keywords: {
      quellious: 'The Goddess of Tranquility teaches us that inner peace leads to outer strength. Would you like to hear a [prayer]?',
      prayer: 'May Quellious grant you serenity in battle and clarity in judgment. Walk in peace, {player}.',
    },
  },

  bunu_stoutheart: {
    hail: 'Well met, {player}! I am Bunu Stoutheart, and I seek [adventure]!',
    keywords: {
      adventure: 'I have heard tales of great [treasure] guarded by the griffons of the northern reaches. Care to join my expedition?',
      treasure: 'They say the griffons hoard shiny objects in their nests atop the cliffs. But getting there alive is the real challenge!',
    },
  },

  tak_whistler: {
    hail: 'Hey there, {player}. I\'m Tak. I keep an eye on things around here. Seen anything [suspicious]?',
    keywords: {
      suspicious: 'There have been reports of [raiders] moving through the area at night. And some of the [farmers] have gone missing.',
      raiders: 'Armed brigands, well-organized. They seem to be working for someone, but I haven\'t figured out who yet.',
      farmers: 'Good honest folk who work the land. If any harm comes to them, I intend to find who is responsible.',
    },
  },

  bilbis_briar: {
    hail: 'Shh! Keep your voice down, {player}! I\'m tracking a [rare creature].',
    keywords: {
      'rare creature': 'There is a silver griffon that has been spotted in these parts. Extremely rare — some say it is a [divine messenger].',
      'divine messenger': 'Legend says the Silver Griffon serves Karana himself, the Rainkeeper. To see it is an omen of great fortune.',
    },
  },

  // ─── Mining Supply NPC (all starting zones) ────────────────────────

  dougal_coalbeard: {
    hail: "Oi there, {player}! Dougal Coalbeard at yer service! I sell the finest [picks] in all o' Norrath, and I know where every vein o' [ore] hides! What can I do fer ye?",
    keywords: {
      'picks': "I carry [Rusty Mining Picks] fer beginners, [Forged Picks] fer them what's gettin' serious, and [Silvered Picks] fer the dedicated miners. Ye want somethin' stronger than that? Ye'll have t' find it on yer own — or talk to the right [people]!",
      'people': "There be smiths and enchanters out there who can forge ye somethin' truly special. But that's beyond me humble shop, {player}.",
      'wares': "Take a look at me goods! I sell minin' picks of various qualities. And if ye've got [ore] or smithin' materials t' sell, I'll give ye a fair price — better than those general merchants, I guarantee it!",
      'ore': "Oi, I know where ya should be look'n! Are ye after [Small Metal Veins], [Metal Veins], [Large Metal Veins], [Fine Metal Veins], [Precious Metal Veins], or [Velium Crystals]?",
      'small metal veins': "Small Metal Veins? Aye, that's starter stuff! Ye'll find 'em scattered through Qeynos Hills, Butcherblock Mountains, and Steamfont Mountains. Any T1 pick'll do the job. Perfect fer learnin' the trade! Want to know about [other] ore?",
      'metal veins': "Metal Veins are a step up! Ye'll need at least a [Forged Pick] t' crack those properly. Head to the deeper parts of Butcherblock Mountains — the dwarves have been minin' there fer ages. Want to know about [other] ore?",
      'large metal veins': "Large Metal Veins, eh? Now yer talkin'! Those hide deep in Steamfont Mountains, near the minotaur caves. Ye'll want a [Silvered Pick] at minimum. Want to know about [other] ore?",
      'fine metal veins': "Fine Metal Veins... now that's proper minin'! I hear tell they can be found in the mountain passes and deep caverns. Ye'll need a Miner's Pick or better — can't buy those from me, I'm afraid. Want to know about [other] ore?",
      'precious metal veins': "Precious Metal Veins! Gold, platinum, the works! Only the most skilled miners can extract from those. I've heard rumors of veins deep in the mountains of Kunark and Velious. Want to know about [other] ore?",
      'velium crystals': "Velium! By Brell's beard, that's the rarest stuff in all o' Norrath! Only found in the frozen wastes of Velious. Ye'll need a Coldain Velium-Pick and master-level minin' skill. That's the pinnacle o' the craft, {player}!",
      'other': "I know about all kinds o' ore! Ask me about [Small Metal Veins], [Metal Veins], [Large Metal Veins], [Fine Metal Veins], [Precious Metal Veins], or [Velium Crystals]!",
      'mining': "So ye want to learn the trade, eh? First, ye need a [pick]. Equip it in yer primary hand, find a minin' node, target it, and use yer Mining skill. Every swing has a chance t' strike true — the better yer skill, the more often ye'll connect! Keep at it and yer skill will improve over time.",
      'rusty mining pick': "A Rusty Mining Pick is where every miner starts. Cheap, a bit slow, but it gets the job done on Small Metal Veins. I've got 'em right here in me shop!",
      'forged pick': "Now a Forged Pick — that's a proper tool! Faster swing, harder hit, and it can handle Metal Veins without breakin' a sweat. Worth every copper!",
      'silvered pick': "The Silvered Pick is me finest wares. Silver-tipped fer extra bite against tougher ore. Handles Large Metal Veins beautifully. A serious miner's best friend!",
    },
  },
};

// ── Dialog Engine Utilities ─────────────────────────────────────────

/**
 * Get the hail response for an NPC, with token substitution.
 * @param {string} npcKey - The NPC's key
 * @param {object} char - The player character object
 * @returns {string|null} The response text, or null if no dialog exists
 */
function getHailResponse(npcKey, char) {
  const dialog = NPC_DIALOGS[npcKey];
  if (!dialog) return null;
  return substituteTokens(dialog.hail, char);
}

/**
 * Get the keyword response for an NPC, with token substitution.
 * @param {string} npcKey - The NPC's key
 * @param {string} keyword - The keyword the player said
 * @param {object} char - The player character object
 * @returns {string|null} The response text, or null if keyword not found
 */
function getKeywordResponse(npcKey, keyword, char) {
  const dialog = NPC_DIALOGS[npcKey];
  if (!dialog || !dialog.keywords) return null;

  // Case-insensitive keyword lookup
  const lowerKey = keyword.toLowerCase();
  for (const [key, response] of Object.entries(dialog.keywords)) {
    if (key.toLowerCase() === lowerKey) {
      return substituteTokens(response, char);
    }
  }
  return null;
}

/**
 * Extract all [keywords] from a response string.
 * @param {string} text - The NPC response text
 * @returns {string[]} Array of keyword strings
 */
function extractKeywords(text) {
  const matches = text.match(/\[([^\]]+)\]/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1));
}

/**
 * Replace substitution tokens in dialog text.
 */
function substituteTokens(text, char) {
  if (!text || !char) return text;
  return text
    .replace(/\{player\}/gi, char.name || 'adventurer')
    .replace(/\{class\}/gi, char.class || 'adventurer')
    .replace(/\{race\}/gi, char.race || 'human');
}

module.exports = {
  NPC_DIALOGS,
  getHailResponse,
  getKeywordResponse,
  extractKeywords,
};
