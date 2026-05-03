const fs = require('fs');
const path = require('path');

class ItemDatabase {
  constructor() {
    this.itemsById = new Map();
    this.itemsByName = new Map();
    this.itemsByKey = new Map(); // Legacy snake_case keys
    this.isLoaded = false;
    this.EQUIP_SLOTS = {
      'HEAD': 2,
      'ARMS': 7,
      'HANDS': 12,
      'PRIMARY': 13,
      'SECONDARY': 14,
      'CHEST': 17,
      'LEGS': 18,
      'FEET': 19,
      'WAIST': 20,
      'WRIST': 21,
      'FINGERS': 22,
      'NECK': 23,
      'FACE': 24,
      'SHOULDERS': 25,
      'BACK': 26,
      'RANGE': 27,
      'AMMO': 28
    };
    this.isLoaded = false;
  }

  async loadItems() {
    if (this.isLoaded) return;
    
    try {
      const eqemuDB = require('../eqemu_db');
      const rawData = await eqemuDB.getAllItems();


      // Convert eqemu items into adapter entries
      for (const rawItem of rawData) {
        
        let type = 'misc';
        if (rawItem.damage > 0) type = 'weapon';
        else if (rawItem.ac > 0) type = 'armor';

        const adaptedItem = {
          _id: rawItem.item_key,
          name: rawItem.name,
          type: type,
          slot: rawItem.slots, // eqemu slots is a bitmask, we could map it if needed
          damage: rawItem.damage || 0,
          delay: rawItem.delay || 0,
          ac: rawItem.ac || 0,
          weight: rawItem.weight / 10 || 0.1, // eqemu weight is x10
          value: rawItem.price || 1, 
          
          str: rawItem.astr || 0,
          sta: rawItem.asta || 0,
          agi: rawItem.aagi || 0,
          dex: rawItem.adex || 0,
          wis: rawItem.awis || 0,
          intel: rawItem.aint || 0,
          cha: rawItem.acha || 0,
          hp: rawItem.hp || 0,
          mana: rawItem.mana || 0,
          classes: rawItem.classes || 0,
          races: rawItem.races || 0,
          itemtype: rawItem.itemtype || 0,
          material: rawItem.material || 0,
          idfile: rawItem.idfile || '',
          reclevel: rawItem.reclevel || 0,
          reqlevel: rawItem.reqlevel || 0,
          scrolllevel: rawItem.scrolllevel || 0,
          scrolleffect: rawItem.scrolleffect || 0,
          focuseffect: rawItem.focuseffect || 0,
          light: rawItem.light || 0,
          icon: rawItem.icon || 0,
          lore: rawItem.lore,
          magic: rawItem.magic || 0,
          nodrop: rawItem.nodrop || 0,
          norent: rawItem.norent || 0,
          size: rawItem.size || 0,
          endur: rawItem.endur || 0,
          fr: rawItem.fr || 0,
          cr: rawItem.cr || 0,
          mr: rawItem.mr || 0,
          pr: rawItem.pr || 0,
          dr: rawItem.dr || 0,
          elemdmgtype: rawItem.elemdmgtype || 0,
          elemdmgamt: rawItem.elemdmgamt || 0,
          banedmgrace: rawItem.banedmgrace || 0,
          banedmgamt: rawItem.banedmgamt || 0,
          placeable: rawItem.placeable || 0,
          augslot1type: rawItem.augslot1type || 0,
          augslot2type: rawItem.augslot2type || 0,
          augslot3type: rawItem.augslot3type || 0,
          augslot4type: rawItem.augslot4type || 0,
          augslot5type: rawItem.augslot5type || 0,
          augslot6type: rawItem.augslot6type || 0,
          bagslots: rawItem.bagslots || 0,
          bagsize: rawItem.bagsize || 0,
          bagwr: rawItem.bagwr || 0,
          bagtype: rawItem.bagtype || 0,
          bookText: rawItem.bookText || '',
        };

        const legacyKey = this.generateKey(rawItem.name);

        this.itemsById.set(adaptedItem._id, adaptedItem);
        this.itemsByName.set(adaptedItem.name.toLowerCase(), adaptedItem);
        
        // Don't overwrite essential legacy keys if there are duplicate names
        if (!this.itemsByKey.has(legacyKey)) {
            this.itemsByKey.set(legacyKey, adaptedItem);
        }
      }

      this.isLoaded = true;
      console.log(`[ItemDB] Successfully loaded ${this.itemsById.size} authentic P99 items.`);
    } catch (e) {
      console.error(`[ItemDB] Failed to load JSON database:`, e);
    }
  }

  generateKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
  }

  getById(id) {
    return this.itemsById.get(parseInt(id, 10)) || this.itemsById.get(id);
  }

  getByName(name) {
    return this.itemsByName.get(name.toLowerCase());
  }

  getByKey(key) {
    return this.itemsByKey.get(key);
  }

  count() {
    return this.itemsById.size;
  }

  /**
   * Creates a Proxy object that mimics the old static `ITEMS` object.
   * Ensures backward compatibility with `ITEMS['rusty_short_sword']`.
   */
  createLegacyProxy() {
    return new Proxy({}, {
      get: (target, prop) => {
        if (typeof prop !== 'string') return undefined; // Ignore symbols etc.
        // Fallback stub items if they somehow don't exist in P99 DB
        const fallback = {
            'fire_beetle_eye': { name: 'Fire Beetle Eye', type: 'tradeskill', slot: 0, weight: 0.1, value: 1 },
            'water': { name: 'Water Flask', type: 'drink', slot: 0, weight: 0.5, value: 1 },
            'rusty_short_sword': { name: 'Rusty Short Sword', type: 'weapon', slot: 13, damage: 3, delay: 25, weight: 3.5, value: 2 },
            'tattered_tunic': { name: 'Tattered Tunic', type: 'armor', slot: 17, ac: 2, weight: 2.0, value: 3 },
            'cloth_cap': { name: 'Cloth Cap', type: 'armor', slot: 2, ac: 1, weight: 0.3, value: 1 },
            'worn_great_staff': { name: 'Worn Great Staff', type: 'weapon', slot: 13, damage: 5, delay: 30, weight: 5.0, value: 5, wis: 2, mana: 5 },
            'leather_gloves': { name: 'Leather Gloves', type: 'armor', slot: 12, ac: 2, weight: 1.0, value: 4, dex: 1 }
        };
        const item = this.getByKey(prop) || fallback[prop];
        return item;
      },
      has: (target, prop) => {
        return this.itemsByKey.has(prop);
      },
      ownKeys: () => {
        return Array.from(this.itemsByKey.keys());
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (this.itemsByKey.has(prop)) {
          return { enumerable: true, configurable: true, value: this.itemsByKey.get(prop) };
        }
        return undefined;
      }
    });
  }
}

// Export singleton instance
module.exports = new ItemDatabase();
