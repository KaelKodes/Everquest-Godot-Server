/**
 * Simple anti-spam: same normalized line repeated back-to-back.
 * Applies to everyone (including GMs) on say / shout / ooc / yell / emote-RP.
 * GM accounts: use `/announcement` for unrestricted global admin text (no spam guard there).
 * Escalates to "mouth exhaustion" (temporary mute) and, if they keep talking while muted,
 * XP drain — meant as a server-side joke + real cost for treating Norrath like IRC.
 */

const DB = require('../db');

/** If they pause this long, the repeat chain resets (same phrase later is fine). */
const REPEAT_RESET_MS = 45000;
/** This many identical lines in a row → no RP credit for this line + whisper. */
const CONSECUTIVE_SOFT = 3;
/** This many identical lines in a row → mute; this line is blocked from broadcast. */
const CONSECUTIVE_MUTE = 5;

const MUTE_SOFT_MS = 90 * 1000;
const MUTE_MUTED_HAMMER_MS = 45 * 1000;
const STRIKES_BEFORE_DRAIN = 3;

function nowMs() {
  return Date.now();
}

function normalizeLine(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240);
}

function setMute(session, untilMs, sendCombatLog, message) {
  session.chatMuteUntil = Math.max(session.chatMuteUntil || 0, untilMs);
  if (message && sendCombatLog) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: message }]);
  }
}

function xpLossMurmur(loss) {
  if (loss < 90) return 'only a sliver of what you had gathered';
  if (loss < 400) return 'a stretch of memory you would rather have kept';
  return 'more ground than you care to name aloud';
}

function applyXpDrain(session, sendCombatLog) {
  const char = session.char;
  if (!char) return;
  const pct = 0.02;
  const loss = Math.max(40, Math.min(5000, Math.floor(char.experience * pct)));
  char.experience = Math.max(0, char.experience - loss);
  if (sendCombatLog) {
    const murmur = xpLossMurmur(loss);
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=red]The world notices how you used your voice. Something slips away—${murmur}.[/color]`,
    }]);
  }
  void DB.updateCharacterState(char).catch(() => {});
}

function resetRepeatChain(session) {
  session._repeatKey = null;
  session._repeatCount = 0;
  session._repeatLastTs = 0;
}

/**
 * @returns {{ block: boolean, skipRp: boolean }}
 * - block: do not echo / broadcast / NPC say this line
 * - skipRp: allow line but do not feed RP buffer (soft tier)
 */
function onPublicMessage(session, text, sendCombatLog) {
  if (!session || !session.char || session.isBot) return { block: false, skipRp: false };

  const key = normalizeLine(text);
  if (!key) return { block: false, skipRp: false };

  const t = nowMs();
  const lastTs = session._repeatLastTs || 0;
  if (lastTs && t - lastTs > REPEAT_RESET_MS) {
    resetRepeatChain(session);
  }
  session._repeatLastTs = t;

  if (session._repeatKey === key) {
    session._repeatCount = (session._repeatCount || 0) + 1;
  } else {
    session._repeatKey = key;
    session._repeatCount = 1;
  }

  const c = session._repeatCount;

  if (c >= CONSECUTIVE_MUTE) {
    setMute(session, t + MUTE_SOFT_MS, sendCombatLog, '[color=orange]Your jaw locks until it forgives you. Wait before calling out again.[/color]');
    resetRepeatChain(session);
    return { block: true, skipRp: true };
  }

  if (c >= CONSECUTIVE_SOFT) {
    if (sendCombatLog) {
      sendCombatLog(session, [{
        event: 'MESSAGE',
        text: '[color=gray]You speak faster than anyone can inhabit. The moment passes without teaching you anything.[/color]',
      }]);
    }
    return { block: false, skipRp: true };
  }

  return { block: false, skipRp: false };
}

/** @returns {boolean} true if the line was consumed (caller should return). */
function onMutedChatAttempt(session, sendCombatLog) {
  if (!session || !session.char || session.isBot) return false;
  const now = nowMs();
  if (!session.chatMuteUntil || now >= session.chatMuteUntil) return false;

  session._mouthExhaustStrikes = (session._mouthExhaustStrikes || 0) + 1;
  session.chatMuteUntil = Math.max(session.chatMuteUntil || 0, now) + MUTE_MUTED_HAMMER_MS;
  if (sendCombatLog) {
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: '[color=red]Your jaw is still spent. The void answers anyway—and not in your favor.[/color]',
    }]);
  }
  if (session._mouthExhaustStrikes >= STRIKES_BEFORE_DRAIN) {
    applyXpDrain(session, sendCombatLog);
    session._mouthExhaustStrikes = 0;
  }
  return true;
}

function isMuted(session) {
  if (!session) return false;
  if (!session.chatMuteUntil) return false;
  return nowMs() < session.chatMuteUntil;
}

module.exports = {
  onPublicMessage,
  onMutedChatAttempt,
  isMuted,
};
