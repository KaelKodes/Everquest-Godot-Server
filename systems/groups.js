const { send } = require('../utils');
const State = require('../state');

/**
 * GroupManager handles EverQuest-style grouping logic.
 * Groups have a max size of 6 members.
 */
class GroupManager {
  constructor() {
    this.groups = new Map(); // groupId -> Group object
    this.playerToGroup = new Map(); // charId -> groupId
    this.nextGroupId = 1;
    this.invites = new Map(); // targetCharId -> { inviterSession, groupId }
  }

  /**
   * Invites a player to a group. Creates a new group if inviter is solo.
   */
  handleInvite(inviter, targetName) {
    const { sessions } = State;
    
    // Find target session
    let target = null;
    for (const [ws, session] of sessions) {
      if (session.char.name.toLowerCase() === targetName.toLowerCase()) {
        target = session;
        break;
      }
    }

    if (!target) {
      this.sendSystemMessage(inviter, `Player '${targetName}' not found.`);
      return;
    }

    if (target === inviter) {
      this.sendSystemMessage(inviter, "You cannot invite yourself.");
      return;
    }

    if (this.playerToGroup.has(target.char.id)) {
      this.sendSystemMessage(inviter, `${target.char.name} is already in a group.`);
      return;
    }

    let groupId = this.playerToGroup.get(inviter.char.id);
    let group = groupId ? this.groups.get(groupId) : null;

    // Logic: If inviter is solo, create a new group.
    if (!group) {
      groupId = this.nextGroupId++;
      group = {
        id: groupId,
        leaderId: inviter.char.id,
        members: [inviter],
        roles: this.createDefaultRoles(inviter.char.id)
      };
      this.groups.set(groupId, group);
      this.playerToGroup.set(inviter.char.id, groupId);
      inviter.group = group; // Link session
    }

    if (group.members.length >= 6) {
      this.sendSystemMessage(inviter, "Your group is full.");
      return;
    }

    // Store pending invite
    this.invites.set(target.char.id, { inviter, groupId });

    if (target.isCompanion) {
      const partner = Number(inviter.char.accountId) === 10000 || String(inviter.char.name || '').toLowerCase() === 'kuldaien';
      if (partner || target.mayGroupWithStrangers) {
        this.handleInviteResponse(target, true);
      } else {
        this.sendSystemMessage(inviter, `${target.char.name} does not join.`);
        this.invites.delete(target.char.id);
      }
      return;
    }

    // Notify target
    send(target.ws, {
      type: 'GROUP_INVITE',
      inviterName: inviter.char.name
    });

    this.sendSystemMessage(inviter, `You have invited ${target.char.name} to join your group.`);
  }

  /**
   * Responds to a group invite.
   */
  handleInviteResponse(target, accepted) {
    const invite = this.invites.get(target.char.id);
    if (!invite) return;

    this.invites.delete(target.char.id);

    if (!accepted) {
      this.sendSystemMessage(invite.inviter, `${target.char.name} has declined your group invite.`);
      return;
    }

    const group = this.groups.get(invite.groupId);
    if (!group || group.members.length >= 6) {
      this.sendSystemMessage(target, "That group no longer exists or is full.");
      return;
    }

    // Join group
    group.members.push(target);
    this.playerToGroup.set(target.char.id, group.id);
    target.group = group;

    this.broadcastToGroup(group, {
      type: 'CHAT',
      channel: 'system',
      text: `${target.char.name} has joined the group.`
    });

    this.updateGroupPresence(group);
  }

  /**
   * Leaves or disbands the group.
   */
  handleDisband(session) {
    const groupId = this.playerToGroup.get(session.char.id);
    if (!groupId) return;

    const group = this.groups.get(groupId);
    if (!group) return;

    // Remove player
    group.members = group.members.filter(m => m !== session);
    this.playerToGroup.delete(session.char.id);
    session.group = null;
    this.clearRolesForChar(group, session.char.id);

    this.sendSystemMessage(session, "You have left the group.");
    
    // Notify others
    this.broadcastToGroup(group, {
      type: 'CHAT',
      channel: 'system',
      text: `${session.char.name} has left the group.`
    });

    // If only one person left, dissolve the group
    if (group.members.length <= 1) {
      const lastMember = group.members[0];
      if (lastMember) {
        this.playerToGroup.delete(lastMember.char.id);
        lastMember.group = null;
        this.sendSystemMessage(lastMember, "The group has been disbanded.");
        send(lastMember.ws, { type: 'GROUP_UPDATE', members: [] });
      }
      this.groups.delete(groupId);
    } else {
      // If leader left, assign new leader
      if (group.leaderId === session.char.id) {
        group.leaderId = group.members[0].char.id;
        this.broadcastToGroup(group, {
          type: 'CHAT',
          channel: 'system',
          text: `${group.members[0].char.name} is now the group leader.`
        });
      }
      this.updateGroupPresence(group);
    }
    
    // Clear client UI for the leaver
    send(session.ws, { type: 'GROUP_UPDATE', members: [] });
  }

  /** Alias used by gameEngine / bot dismiss paths. */
  handleLeave(session) {
    this.handleDisband(session);
  }

  /**
   * Promote a group member to leader. Leader-only.
   */
  handlePromote(session, targetName) {
    const group = this.getGroupFor(session);
    if (!group) {
      this.sendSystemMessage(session, "You are not in a group.");
      return;
    }
    if (session.char.id !== group.leaderId) {
      this.sendSystemMessage(session, "Only the group leader can promote.");
      return;
    }
    const target = group.members.find(m => m.char.name.toLowerCase() === String(targetName || '').toLowerCase());
    if (!target) {
      this.sendSystemMessage(session, `Player '${targetName}' is not in your group.`);
      return;
    }
    if (target.char.id === group.leaderId) {
      this.sendSystemMessage(session, `${target.char.name} is already the group leader.`);
      return;
    }
    group.leaderId = target.char.id;
    this.broadcastToGroup(group, {
      type: 'CHAT',
      channel: 'system',
      text: `${target.char.name} is now the group leader.`
    });
    this.updateGroupPresence(group);
  }

  /**
   * Assign a combat role by friendly name (tank/puller/healer/dps/cc). Leader-only.
   */
  handleSetRole(session, targetName, roleName) {
    const group = this.getGroupFor(session);
    if (!group) {
      this.sendSystemMessage(session, "You are not in a group.");
      return;
    }
    if (session.char.id !== group.leaderId) {
      this.sendSystemMessage(session, "Only the group leader can change roles.");
      return;
    }
    this.ensureRoles(group);

    const target = group.members.find(m => m.char.name.toLowerCase() === String(targetName || '').toLowerCase());
    if (!target) {
      this.sendSystemMessage(session, `Player '${targetName}' is not in your group.`);
      return;
    }

    const key = this.roleKeyFromName(roleName);
    if (!key) {
      this.sendSystemMessage(session, "Unknown role. Use: tank, puller, healer, dps, cc.");
      return;
    }

    group.roles[key] = target.char.id;
    // Tank is the default kill-focus assist target unless an explicit MA is set later.
    if (key === 'mainTank' && !group.roles.mainAssist) {
      group.roles.mainAssist = target.char.id;
    }
    // DPS is the group's focus-fire lead (classic Main Assist).
    if (key === 'dps') {
      group.roles.mainAssist = target.char.id;
    }

    const label = this.roleDisplayName(key);
    this.broadcastToGroup(group, {
      type: 'CHAT',
      channel: 'system',
      text: `${target.char.name} is now the group ${label}.`
    });
    this.updateGroupPresence(group);
  }

  /**
   * Clear a combat role from a member. Leader-only.
   */
  handleUnsetRole(session, targetName, roleName) {
    const group = this.getGroupFor(session);
    if (!group) {
      this.sendSystemMessage(session, "You are not in a group.");
      return;
    }
    if (session.char.id !== group.leaderId) {
      this.sendSystemMessage(session, "Only the group leader can change roles.");
      return;
    }
    this.ensureRoles(group);

    const target = group.members.find(m => m.char.name.toLowerCase() === String(targetName || '').toLowerCase());
    if (!target) {
      this.sendSystemMessage(session, `Player '${targetName}' is not in your group.`);
      return;
    }

    const key = this.roleKeyFromName(roleName);
    if (!key) {
      this.sendSystemMessage(session, "Unknown role. Use: tank, puller, healer, dps, cc.");
      return;
    }

    if (group.roles[key] !== target.char.id) {
      this.sendSystemMessage(session, `${target.char.name} is not the group ${this.roleDisplayName(key)}.`);
      return;
    }

    group.roles[key] = null;
    if (key === 'dps' && group.roles.mainAssist === target.char.id) {
      group.roles.mainAssist = group.roles.mainTank || null;
    }

    this.broadcastToGroup(group, {
      type: 'CHAT',
      channel: 'system',
      text: `${target.char.name} is no longer the group ${this.roleDisplayName(key)}.`
    });
    this.updateGroupPresence(group);
  }

  /**
   * Sends group chat messages.
   */
  handleGroupChat(session, text) {
    const groupId = this.playerToGroup.get(session.char.id);
    if (!groupId) {
      this.sendSystemMessage(session, "You are not in a group.");
      return;
    }

    const group = this.groups.get(groupId);
    this.broadcastToGroup(group, {
      type: 'CHAT',
      channel: 'group',
      sender: session.char.name,
      text: text
    });
  }

  /**
   * Broadcasts stats of all members to everyone in the group.
   */
  updateGroupPresence(group) {
    this.ensureRoles(group);
    const memberData = group.members.map(m => ({
      id: m.char.id,
      name: m.char.name,
      level: m.char.level,
      hp: m.char.hp,
      maxHp: m.effectiveStats ? m.effectiveStats.hp : m.char.maxHp,
      mana: m.char.mana,
      maxMana: m.effectiveStats ? m.effectiveStats.mana : m.char.maxMana,
      endurance: Math.max(0, 100 - (m.char.fatigue || 0)),
      maxEndurance: 100,
      isLeader: m.char.id === group.leaderId,
      zoneId: m.char.zoneId,
      roles: this.rolesForChar(group, m.char.id),
    }));

    // Aggro meter is relative to each recipient's own target (EQ group window behavior).
    for (const recipient of group.members) {
      const target = recipient.combatTarget;
      const hateList = target && typeof target === 'object' && target.hateList ? target.hateList : null;
      // TEMP aggro-meter debug: remove once the meter/attack mismatch is understood.
      if (!recipient.isBot) {
        const attacking = target && target.target ? (target.target.char ? target.target.char.name : target.target.name) : 'none';
        const entries = hateList
          ? hateList.entries.map(e => `${typeof e.entityId === 'string' ? e.entityId : '<' + typeof e.entityId + '>'}:${Math.round(e.hateAmount)}`).join(', ')
          : 'no hate list';
        const line = `[AGGRO] ${recipient.char.name} target=${target ? (target.name || (target.char && target.char.name) || typeof target) : 'none'} (id ${target && target.id}) attacking=${attacking} hate=[${entries}]`;
        if (line !== recipient._lastAggroDebug) {
          recipient._lastAggroDebug = line;
          console.log(line);
        }
      }
      send(recipient.ws, {
        type: 'GROUP_UPDATE',
        members: memberData.map((md, i) => ({
          ...md,
          hatePct: hateList ? hateList.getHateRatio(group.members[i].char.name) : 0
        })),
        roles: group.roles
      });
    }
  }

  /**
   * Handles /grouproles command.
   */
  handleRoles(session, args) {
    const groupId = this.playerToGroup.get(session.char.id);
    if (!groupId) {
      this.sendSystemMessage(session, "You are not in a group.");
      return;
    }

    const group = this.groups.get(groupId);
    this.ensureRoles(group);

    if (!args || args.length === 0 || args[0] === 'list') {
      let msg = "Group Roles:\n";
      msg += `Tank: ${this.getMemberName(group, group.roles.mainTank)}\n`;
      msg += `Puller: ${this.getMemberName(group, group.roles.puller)}\n`;
      msg += `Healer: ${this.getMemberName(group, group.roles.healer)}\n`;
      msg += `DPS: ${this.getMemberName(group, group.roles.dps)}\n`;
      msg += `CC: ${this.getMemberName(group, group.roles.cc)}\n`;
      msg += `Main Assist: ${this.getMemberName(group, group.roles.mainAssist)}\n`;
      msg += `Mark NPC: ${this.getMemberName(group, group.roles.markNpc)}\n`;
      msg += `Master Looter: ${this.getMemberName(group, group.roles.masterLooter)}`;
      this.sendSystemMessage(session, msg);
      return;
    }

    if (session.char.id !== group.leaderId) {
      this.sendSystemMessage(session, "Only the group leader can change roles.");
      return;
    }

    const action = args[0].toLowerCase();
    if (action === 'set' && args.length >= 3) {
      const targetName = args[1];
      const roleArg = args[2];
      const roleId = parseInt(roleArg, 10);

      // Legacy numeric IDs still work; named roles preferred.
      if (!Number.isNaN(roleId) && String(roleId) === String(roleArg)) {
        const target = group.members.find(m => m.char.name.toLowerCase() === targetName.toLowerCase());
        if (!target) {
          this.sendSystemMessage(session, `Player '${targetName}' is not in your group.`);
          return;
        }
        switch (roleId) {
          case 1: group.roles.mainTank = target.char.id; break;
          case 2: group.roles.mainAssist = target.char.id; break;
          case 3: group.roles.puller = target.char.id; break;
          case 4: group.roles.markNpc = target.char.id; break;
          case 5: group.roles.masterLooter = target.char.id; break;
          case 6: group.roles.healer = target.char.id; break;
          case 7: group.roles.dps = target.char.id; group.roles.mainAssist = target.char.id; break;
          case 8: group.roles.cc = target.char.id; break;
          default:
            this.sendSystemMessage(session, "Invalid Role ID (1-8).");
            return;
        }
        this.broadcastToGroup(group, {
          type: 'CHAT',
          channel: 'system',
          text: `${target.char.name} has been assigned role ID ${roleId}.`
        });
        this.updateGroupPresence(group);
        return;
      }

      this.handleSetRole(session, targetName, roleArg);
      return;
    }

    if (action === 'unset' && args.length >= 3) {
      const targetName = args[1];
      const key = this.roleKeyFromName(args[2]) || this.roleKeyFromId(parseInt(args[2], 10));
      if (!key) {
        this.sendSystemMessage(session, "Unknown role to unset.");
        return;
      }
      const target = group.members.find(m => m.char.name.toLowerCase() === targetName.toLowerCase());
      if (!target) {
        this.sendSystemMessage(session, `Player '${targetName}' is not in your group.`);
        return;
      }
      if (group.roles[key] === target.char.id) {
        group.roles[key] = null;
        this.broadcastToGroup(group, {
          type: 'CHAT',
          channel: 'system',
          text: `${target.char.name} is no longer the group ${this.roleDisplayName(key)}.`
        });
        this.updateGroupPresence(group);
      }
    }
  }

  createDefaultRoles(leaderCharId) {
    return {
      mainTank: leaderCharId,
      mainAssist: leaderCharId,
      puller: null,
      markNpc: null,
      masterLooter: leaderCharId,
      healer: null,
      dps: null,
      cc: null,
    };
  }

  ensureRoles(group) {
    if (!group.roles) {
      group.roles = this.createDefaultRoles(group.leaderId);
      return;
    }
    const defaults = this.createDefaultRoles(null);
    for (const key of Object.keys(defaults)) {
      if (group.roles[key] === undefined) group.roles[key] = null;
    }
  }

  clearRolesForChar(group, charId) {
    if (!group || !group.roles) return;
    for (const key of Object.keys(group.roles)) {
      if (group.roles[key] === charId) group.roles[key] = null;
    }
  }

  getGroupFor(session) {
    const groupId = this.playerToGroup.get(session.char.id);
    return groupId ? this.groups.get(groupId) : null;
  }

  roleKeyFromName(name) {
    const n = String(name || '').toLowerCase().replace(/[\s_-]/g, '');
    const map = {
      tank: 'mainTank',
      maintank: 'mainTank',
      mt: 'mainTank',
      puller: 'puller',
      healer: 'healer',
      mainhealer: 'healer',
      dps: 'dps',
      damage: 'dps',
      cc: 'cc',
      crowdcontrol: 'cc',
      mainassist: 'mainAssist',
      ma: 'mainAssist',
      assist: 'mainAssist',
      marknpc: 'markNpc',
      mark: 'markNpc',
      masterlooter: 'masterLooter',
      looter: 'masterLooter',
    };
    return map[n] || null;
  }

  roleKeyFromId(roleId) {
    switch (roleId) {
      case 1: return 'mainTank';
      case 2: return 'mainAssist';
      case 3: return 'puller';
      case 4: return 'markNpc';
      case 5: return 'masterLooter';
      case 6: return 'healer';
      case 7: return 'dps';
      case 8: return 'cc';
      default: return null;
    }
  }

  roleDisplayName(key) {
    const names = {
      mainTank: 'Tank',
      mainAssist: 'Main Assist',
      puller: 'Puller',
      markNpc: 'Mark NPC',
      masterLooter: 'Master Looter',
      healer: 'Healer',
      dps: 'DPS',
      cc: 'CC',
    };
    return names[key] || key;
  }

  rolesForChar(group, charId) {
    const roles = [];
    if (!group || !group.roles || charId == null) return roles;
    if (group.roles.mainTank === charId) roles.push('tank');
    if (group.roles.puller === charId) roles.push('puller');
    if (group.roles.healer === charId) roles.push('healer');
    if (group.roles.dps === charId) roles.push('dps');
    if (group.roles.cc === charId) roles.push('cc');
    return roles;
  }

  getMemberName(group, charId) {
    if (!charId) return "None";
    const member = group.members.find(m => m.char.id === charId);
    return member ? member.char.name : "Unknown";
  }

  broadcastToGroup(group, payload) {
    for (const member of group.members) {
      send(member.ws, payload);
    }
    if (payload && payload.type === 'CHAT' && payload.channel === 'group' && payload.text) {
      for (const member of group.members) {
        if (!member || !member.bot || typeof member.bot.handleChat !== 'function') continue;
        if (member.char && member.char.name === payload.sender) continue;
        try {
          member.bot.handleChat(payload.text, payload.sender);
        } catch (e) { /* ignore */ }
      }
    }
  }

  sendSystemMessage(session, text) {
    send(session.ws, { type: 'CHAT', channel: 'system', text: text });
  }
}

module.exports = new GroupManager();
