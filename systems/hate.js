/**
 * systems/hate.js
 * 
 * The EQMUD Threat Engine
 * Translated and adapted from EQEmu's hate_list.cpp
 */

class HateEntry {
    constructor(entityId) {
        this.entityId = entityId;
        this.hateAmount = 0;
        this.damageAmount = 0;
        this.lastModified = Date.now();
        this.isFrenzy = false;
    }
}

class HateList {
    constructor() {
        this.entries = []; // Array of HateEntry
    }

    /**
     * Add or update an entity on the hate list.
     * @param {string} entityId - The ID of the character/pet to add
     * @param {number} hate - Amount of pure threat to add
     * @param {number} damage - Amount of HP damage dealt (for XP/Loot rights)
     * @param {boolean} isFrenzy - If true, this entity ignores normal aggro distance rules
     */
    addEntToHateList(entityId, hate = 0, damage = 0, isFrenzy = false) {
        let entry = this.entries.find(e => e.entityId === entityId);
        
        if (!entry) {
            entry = new HateEntry(entityId);
            this.entries.push(entry);
        }

        entry.hateAmount += hate;
        entry.damageAmount += damage;
        entry.lastModified = Date.now();
        if (isFrenzy) entry.isFrenzy = true;
    }

    /**
     * Get the current highest threat target.
     * @returns {string|null} The entityId of the top hate target, or null if list is empty.
     */
    getMobWithMostHateOnList() {
        if (this.entries.length === 0) return null;

        // Sort by frenzy first, then by highest hate amount
        this.entries.sort((a, b) => {
            if (a.isFrenzy && !b.isFrenzy) return -1;
            if (!a.isFrenzy && b.isFrenzy) return 1;
            return b.hateAmount - a.hateAmount;
        });

        return this.entries[0].entityId;
    }

    /**
     * Get the entity that dealt the most damage (for XP/Loot rights).
     * @returns {string|null} The entityId of the top damage dealer
     */
    getDamageTopOnHateList() {
        if (this.entries.length === 0) return null;

        let topDmg = -1;
        let topEnt = null;

        for (const entry of this.entries) {
            if (entry.damageAmount > topDmg) {
                topDmg = entry.damageAmount;
                topEnt = entry.entityId;
            }
        }

        return topEnt;
    }

    /**
     * Remove entities that haven't generated threat in a long time (e.g. out of range / zoned).
     * @param {number} maxAgeMs - Maximum age in milliseconds before dropping aggro
     */
    removeStaleEntries(maxAgeMs = 300000) { // Default 5 minutes
        const now = Date.now();
        this.entries = this.entries.filter(e => (now - e.lastModified) < maxAgeMs);
    }

    /**
     * Manually remove an entity from the list (e.g., Feign Death success, Zoning, Death).
     */
    removeEntFromHateList(entityId) {
        this.entries = this.entries.filter(e => e.entityId !== entityId);
    }

    /**
     * Set a specific hate amount for an entity (used for Taunt and complete aggro wipes).
     */
    setHateAmount(entityId, hateAmount) {
        const entry = this.entries.find(e => e.entityId === entityId);
        if (entry) {
            entry.hateAmount = hateAmount;
            entry.lastModified = Date.now();
        } else if (hateAmount > 0) {
            this.addEntToHateList(entityId, hateAmount, 0);
        }
    }

    /**
     * Calculate the relative hate percentage of a specific entity compared to the top hate entity.
     * Used for the Aggro Meter UI (Hate Bubbles).
     * @param {string} entityId 
     * @returns {number} 0-100 percentage.
     */
    getHateRatio(entityId) {
        if (this.entries.length === 0) return 0;
        
        const topHateId = this.getMobWithMostHateOnList();
        if (topHateId === entityId) return 100; // You are the target

        const topEntry = this.entries.find(e => e.entityId === topHateId);
        const myEntry = this.entries.find(e => e.entityId === entityId);

        if (!myEntry || !topEntry || topEntry.hateAmount <= 0) return 0;

        // Calculate percentage, capped at 99% (since 100% means you have aggro)
        let ratio = (myEntry.hateAmount / topEntry.hateAmount) * 100;
        return Math.min(Math.floor(ratio), 99);
    }

    /**
     * Wipe the entire hate list (e.g., Memory Blur, Leash).
     */
    wipeHateList() {
        this.entries = [];
    }
}

module.exports = HateList;
