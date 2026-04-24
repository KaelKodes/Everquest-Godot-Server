const combat = require('./combat');
const { Skills } = require('./data/skills');

const session = {
  char: {
    class: 'warrior',
    level: 1,
    skills: {
      '1h_slashing': 1,
      'offense': 1,
      'defense': 1
    }
  },
  effectiveStats: {
    intel: 75,
    wis: 75
  },
  skillUpMessages: []
};

let hitCount = 0;
let skillUps = 0;

for (let i = 0; i < 40; i++) {
  hitCount++;
  if (combat.trySkillUp(session, '1h_slashing')) {
    skillUps++;
  }
  if (combat.trySkillUp(session, 'offense')) {
    skillUps++;
  }
}

console.log('Swings:', hitCount);
console.log('Skill Ups:', skillUps);
console.log('Messages:', session.skillUpMessages);
