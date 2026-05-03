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
        roles: {
          mainTank: inviter.char.id,
          mainAssist: inviter.char.id,
          puller: null,
          markNpc: null,
          masterLooter: inviter.char.id
        }
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
    const memberData = group.members.map(m => ({
      id: m.char.id,
      name: m.char.name,
      level: m.char.level,
      hp: m.char.hp,
      maxHp: m.effectiveStats ? m.effectiveStats.hp : m.char.maxHp,
      mana: m.char.mana,
      maxMana: m.effectiveStats ? m.effectiveStats.mana : m.char.maxMana,
      endurance: m.char.endurance || 0,
      maxEndurance: m.char.maxEndurance || 100,
      isLeader: m.char.id === group.leaderId,
      zoneId: m.char.zoneId
    }));

    this.broadcastToGroup(group, {
      type: 'GROUP_UPDATE',
      members: memberData,
      roles: group.roles
    });
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
    if (!args || args.length === 0 || args[0] === 'list') {
      let msg = "Group Roles:\n";
      msg += `1. Main Tank: ${this.getMemberName(group, group.roles.mainTank)}\n`;
      msg += `2. Main Assist: ${this.getMemberName(group, group.roles.mainAssist)}\n`;
      msg += `3. Puller: ${this.getMemberName(group, group.roles.puller)}\n`;
      msg += `4. Mark NPC: ${this.getMemberName(group, group.roles.markNpc)}\n`;
      msg += `5. Master Looter: ${this.getMemberName(group, group.roles.masterLooter)}`;
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
      const roleId = parseInt(args[2]);
      
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
        default:
          this.sendSystemMessage(session, "Invalid Role ID (1-5).");
          return;
      }

      this.broadcastToGroup(group, {
        type: 'CHAT',
        channel: 'system',
        text: `${target.char.name} has been assigned role ID ${roleId}.`
      });
      this.updateGroupPresence(group);
    }
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
  }

  sendSystemMessage(session, text) {
    send(session.ws, { type: 'CHAT', channel: 'system', text: text });
  }
}

module.exports = new GroupManager();
