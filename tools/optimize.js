const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'gameEngine.js');
let content = fs.readFileSync(file, 'utf8');

// 1. Math.sqrt distance checks
content = content.replace(
  /const dx = \(char\.x \|\| 0\) \- node\.x;\s*const dy = \(char\.y \|\| 0\) \- node\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*if \(dist > 25\)/g,
  'const dx = (char.x || 0) - node.x;\n  const dy = (char.y || 0) - node.y;\n  const distSq = dx * dx + dy * dy;\n  if (distSq > 625)'
);

content = content.replace(
  /const dx = session\.char\.x \- mob\.x;\s*const dy = session\.char\.y \- mob\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*if \(dist > spellRange\)/g,
  'const dx = session.char.x - mob.x;\n      const dy = session.char.y - mob.y;\n      const distSq = dx * dx + dy * dy;\n      if (distSq > spellRange * spellRange)'
);

content = content.replace(
  /const dist = getDistance\(char\.x, char\.y, target\.x, target\.y\);\s*if \(dist > HAIL_RANGE\)/g,
  'const distSq = getDistanceSq(char.x, char.y, target.x, target.y);\n  if (distSq > HAIL_RANGE * HAIL_RANGE)'
);

content = content.replace(
  /const pDist = getDistance\(other\.char\.x, other\.char\.y, char\.x, char\.y\);\s*if \(pDist <= radius\)/g,
  'const pDistSq = getDistanceSq(other.char.x, other.char.y, char.x, char.y);\n      if (pDistSq <= radius * radius)'
);

content = content.replace(
  /const guardDist = getDistance\(mob\.x, mob\.y, char\.x, char\.y\);\s*if \(guardDist > 400\)/g,
  'const guardDistSq = getDistanceSq(mob.x, mob.y, char.x, char.y);\n    if (guardDistSq > 160000)'
);

content = content.replace(
  /const dist = getDistance\(char\.x, char\.y, merchant\.x, merchant\.y\);\s*if \(dist > HAIL_RANGE\)/g,
  'const distSq = getDistanceSq(char.x, char.y, merchant.x, merchant.y);\n  if (distSq > HAIL_RANGE * HAIL_RANGE)'
);

content = content.replace(
  /const dx = session\.char\.x \- session\.casting\.startPos\.x;\s*const dy = session\.char\.y \- session\.casting\.startPos\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*if \(dist > 5\)/g,
  'const dx = session.char.x - session.casting.startPos.x;\n      const dy = session.char.y - session.casting.startPos.y;\n      const distSq = dx * dx + dy * dy;\n      if (distSq > 25)'
);

content = content.replace(
  /const dx = pet\.target\.x \- pet\.x;\s*const dy = pet\.target\.y \- pet\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*if \(dist > MELEE_RANGE\)/g,
  'const dx = pet.target.x - pet.x;\n    const dy = pet.target.y - pet.y;\n    const distSq = dx * dx + dy * dy;\n\n    if (distSq > MELEE_RANGE * MELEE_RANGE)'
);

content = content.replace(
  /const dx = owner\.char\.x \- pet\.x;\s*const dy = owner\.char\.y \- pet\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*if \(dist > FOLLOW_DISTANCE\) {/g,
  'const dx = owner.char.x - pet.x;\n      const dy = owner.char.y - pet.y;\n      const distSq = dx * dx + dy * dy;\n      if (distSq > FOLLOW_DISTANCE * FOLLOW_DISTANCE) {\n        const dist = Math.sqrt(distSq);'
);

content = content.replace(
  /const dx = pet\.guardX \- pet\.x;\s*const dy = pet\.guardY \- pet\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*if \(dist > 3\) {/g,
  'const dx = pet.guardX - pet.x;\n      const dy = pet.guardY - pet.y;\n      const distSq = dx * dx + dy * dy;\n      if (distSq > 9) {\n        const dist = Math.sqrt(distSq);'
);

content = content.replace(
  /const dx = targetNode\.x \- mob\.x;\s*const dy = targetNode\.y \- mob\.y;\s*const dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);/g,
  'const dx = targetNode.x - mob.x;\n  const dy = targetNode.y - mob.y;\n  const distSq = dx * dx + dy * dy;\n  const dist = Math.sqrt(distSq);'
);

content = content.replace(
  /dist = Math\.sqrt\(dx \* dx \+ dy \* dy\);\s*inMeleeRange = dist <= MELEE_RANGE;/g,
  'dist = Math.sqrt(dx * dx + dy * dy);\n        inMeleeRange = (dx * dx + dy * dy) <= (MELEE_RANGE * MELEE_RANGE);'
);

fs.writeFileSync(file, content, 'utf8');
console.log('Math optimizations applied.');
