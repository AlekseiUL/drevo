const parental = type => type === 'parent-child' || type === 'adoptive';
const peer = type => type === 'partner' || type === 'sibling';
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const stable = (a, b) => a.localeCompare(b, 'en');
const card = { width: 230, height: 170 };
const coupleGap = 24, familyGap = 52, rowStep = 310;

function sets(ids) {
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => { if (parent.get(id) !== id) parent.set(id, find(parent.get(id))); return parent.get(id); };
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(stable(x, y) < 0 ? y : x, stable(x, y) < 0 ? x : y); };
  return { find, join };
}

// Start at the selected person, not at whichever branch has the most known ancestors.
// This puts cousins and grandparents on the same rows even when one lineage is deeper.
function generations(persons, edges, root) {
  const adjacency = new Map(persons.map(p => [p.id, []]));
  for (const e of edges) {
    if (!parental(e.type) && !peer(e.type)) continue;
    const delta = parental(e.type) ? 1 : 0;
    adjacency.get(e.a).push({ id: e.b, delta });
    adjacency.get(e.b).push({ id: e.a, delta: -delta });
  }
  for (const neighbors of adjacency.values()) neighbors.sort((a, b) => stable(a.id, b.id) || a.delta - b.delta);
  const rank = new Map(), components = [], warnings = [];
  for (const start of [root, ...persons.map(p => p.id).filter(id => id !== root).sort(stable)]) {
    if (rank.has(start)) continue;
    const ids = [start]; rank.set(start, 0);
    let conflict = false;
    for (const id of ids) for (const next of adjacency.get(id)) {
      const needed = rank.get(id) + next.delta;
      if (rank.has(next.id)) { if (rank.get(next.id) !== needed) conflict = true; continue; }
      rank.set(next.id, needed); ids.push(next.id);
    }
    if (conflict) {
      // Pedigree collapse can put a person in more than one genealogical generation.
      // Keep all edges; use extra vertical space instead of rejecting a valid pedigree.
      const included = new Set(ids), equal = sets(ids);
      for (const e of edges) if (included.has(e.a) && peer(e.type)) equal.join(e.a, e.b);
      const parents = new Map();
      for (const e of edges) if (included.has(e.a) && parental(e.type)) {
        if (!parents.has(e.b)) parents.set(e.b, []);
        parents.get(e.b).push(e.a);
      }
      for (const group of parents.values()) for (const id of group.slice(1)) equal.join(group[0], id);
      const levels = new Map(ids.map(id => [equal.find(id), 0]));
      const vertical = edges.filter(e => included.has(e.a) && parental(e.type));
      for (const e of vertical) if (equal.find(e.a) === equal.find(e.b)) throw Error('Родительская связь конфликтует с одним поколением');
      for (let step = 0; step <= levels.size; step++) {
        let changed = false;
        for (const e of vertical) {
          const a = equal.find(e.a), b = equal.find(e.b), needed = levels.get(a) + 1;
          if (levels.get(b) < needed) { levels.set(b, needed); changed = true; }
        }
        if (!changed) break;
        if (step === levels.size) throw Error('Обнаружен цикл родительских связей');
      }
      const origin = levels.get(equal.find(start));
      for (const id of ids) rank.set(id, levels.get(equal.find(id)) - origin);
      warnings.push('В одной из ветвей несколько путей родства задают разные поколения. Для сохранения всех связей оставлены дополнительные промежутки между рядами.');
    }
    components.push(ids);
  }
  return { rank, components, adjacency, warnings };
}

// Weighted isotonic packing: stay close to the family centres without overlapping cards.
function pack(blocks, targets, lower = -Infinity, upper = Infinity) {
  if (!blocks.length) return;
  let offset = 0;
  const slots = blocks.map((block, i) => {
    if (i) offset += (blocks[i - 1].width + block.width) / 2 + familyGap;
    return { block, offset, target: targets.get(block.id) ?? block.x };
  });
  const pools = [];
  for (const slot of slots) {
    pools.push({ slots: [slot], sum: slot.target - slot.offset, weight: 1 });
    while (pools.length > 1 && pools.at(-2).sum / pools.at(-2).weight > pools.at(-1).sum / pools.at(-1).weight) {
      const right = pools.pop(), left = pools.pop();
      pools.push({ slots: [...left.slots, ...right.slots], sum: left.sum + right.sum, weight: left.weight + right.weight });
    }
  }
  const minimum = lower + blocks[0].width / 2;
  const maximum = upper - blocks.at(-1).width / 2 - slots.at(-1).offset;
  for (const pool of pools) {
    const value = Math.max(minimum, Math.min(maximum, pool.sum / pool.weight));
    for (const slot of pool.slots) slot.block.x = value + slot.offset;
  }
}

function arrange(ids, model, generation, adjacency, focus, splitBranches) {
  const included = new Set(ids), edges = model.edges.filter(e => included.has(e.a) && included.has(e.b));
  const rootParents = [...new Set(edges.filter(e => parental(e.type) && e.b === focus).map(e => e.a))].sort(stable);
  const distance = new Map([[focus, 0]]), visit = [focus];
  for (const id of visit) for (const next of adjacency.get(id)) if (!distance.has(next.id)) {
    distance.set(next.id, distance.get(id) + 1); visit.push(next.id);
  }
  const descendants = new Set([focus]), descend = [focus];
  for (const id of descend) for (const e of edges) if (parental(e.type) && e.a === id && !descendants.has(e.b)) {
    descendants.add(e.b); descend.push(e.b);
  }
  const branch = new Map(), branchVisit = [];
  if (splitBranches && rootParents.length === 2) {
    rootParents.forEach((id, i) => { branch.set(id, i ? 1 : -1); branchVisit.push(id); });
    for (const id of branchVisit) for (const next of adjacency.get(id)) {
      if (descendants.has(next.id) || rootParents.includes(next.id) || branch.has(next.id)) continue;
      branch.set(next.id, branch.get(id)); branchVisit.push(next.id);
    }
  }
  const household = sets(ids), coParents = new Map();
  for (const e of edges) {
    if (e.type === 'partner' && generation.get(e.a) === generation.get(e.b)) household.join(e.a, e.b);
    if (parental(e.type)) { if (!coParents.has(e.b)) coParents.set(e.b, []); coParents.get(e.b).push(e.a); }
  }
  for (const parents of coParents.values()) for (const id of parents.slice(1)) {
    if (generation.get(parents[0]) === generation.get(id)) household.join(parents[0], id);
  }
  const blocksById = new Map();
  for (const id of ids) {
    const key = household.find(id);
    if (!blocksById.has(key)) blocksById.set(key, { id: key, members: [], x: 0, generation: generation.get(id) });
    blocksById.get(key).members.push(id);
  }
  const blocks = [...blocksById.values()], blockFor = new Map(), offsetFor = new Map(), rows = new Map();
  for (const block of blocks) {
    block.members.sort((a, b) => (branch.get(a) || 0) - (branch.get(b) || 0) || stable(a, b));
    block.width = block.members.length * card.width + (block.members.length - 1) * coupleGap;
    block.members.forEach((id, i) => { blockFor.set(id, block); offsetFor.set(id, -block.width / 2 + card.width / 2 + i * (card.width + coupleGap)); });
    const sides = new Set(block.members.map(id => branch.get(id) || 0));
    block.side = sides.size === 1 ? [...sides][0] : 0;
    block.distance = Math.min(...block.members.map(id => distance.get(id) ?? 1000));
    if (!rows.has(block.generation)) rows.set(block.generation, []);
    rows.get(block.generation).push(block);
  }
  const tie = (a, b) => (a.side < 0 ? b.distance - a.distance : a.distance - b.distance) || stable(a.id, b.id);
  const siblingSets = sets(ids), children = new Map();
  for (const e of edges) {
    if (e.type === 'sibling') siblingSets.join(e.a, e.b);
    if (parental(e.type)) { if (!children.has(e.a)) children.set(e.a, []); children.get(e.a).push(e.b); }
  }
  for (const siblings of children.values()) for (const id of siblings.slice(1)) if (generation.get(id) === generation.get(siblings[0])) siblingSets.join(siblings[0], id);
  // Keep each sibling family together, with the two partners' siblings on either
  // side of the couple. Barycentre sorting alone interleaves unrelated siblings.
  function familyOrder(group, targets, reorder) {
    const available = new Set(group), cohortBlocks = new Map(), visited = new Set(), clusters = [];
    for (const block of group) for (const id of block.members) {
      const cohort = siblingSets.find(id);
      if (!cohortBlocks.has(cohort)) cohortBlocks.set(cohort, new Set());
      cohortBlocks.get(cohort).add(block);
    }
    const byProximity = (a, b) => a.distance - b.distance || b.members.length - a.members.length || stable(a.id, b.id);
    for (const start of [...group].sort(byProximity)) {
      if (visited.has(start)) continue;
      const cluster = [];
      function walk(block, via = null) {
        if (visited.has(block) || !available.has(block)) return;
        visited.add(block);
        const cohorts = [...new Set(block.members.map(id => siblingSets.find(id)))];
        function relatives(cohort) {
          if (cohort === via) return;
          for (const next of [...cohortBlocks.get(cohort)].sort(byProximity)) walk(next, cohort);
        }
        if (cohorts.length > 1) {
          for (const cohort of cohorts.slice(0, -1)) relatives(cohort);
          cluster.push(block); relatives(cohorts.at(-1));
        } else if (block.side < 0) { relatives(cohorts[0]); cluster.push(block); }
        else { cluster.push(block); relatives(cohorts[0]); }
      }
      walk(start); clusters.push(cluster);
    }
    clusters.sort((a, b) => (reorder ? mean(a.map(x => targets.get(x.id) ?? x.x)) - mean(b.map(x => targets.get(x.id) ?? x.x)) : 0) || tie(a[0], b[0]));
    return clusters.flat();
  }
  const orderedRows = [...rows.keys()].sort((a, b) => a - b);
  const span = blocks => blocks.reduce((sum, block) => sum + block.width, 0) + Math.max(0, blocks.length - 1) * familyGap;
  const laneWidth = side => Math.max(0, ...[...rows.values()].map(row => span(row.filter(b => b.side === side)) + span(row.filter(b => !b.side)) / 2 + familyGap));
  const leftBound = -laneWidth(-1), rightBound = laneWidth(1);
  function place(row, targets, reorder) {
    const groups = [-1, 0, 1].map(side => familyOrder(row.filter(block => block.side === side), targets, reorder));
    const centre = groups[1]; pack(centre, targets);
    const leftLimit = centre.length ? centre[0].x - centre[0].width / 2 - familyGap : -familyGap;
    const rightLimit = centre.length ? centre.at(-1).x + centre.at(-1).width / 2 + familyGap : familyGap;
    pack(groups[0], targets, leftBound, leftLimit);
    pack(groups[2], targets, rightLimit, rightBound);
  }
  for (const row of rows.values()) place(row, new Map(), false);
  const position = id => blockFor.get(id).x + offsetFor.get(id);
  for (let pass = 0; pass < 20; pass++) {
    const downward = pass % 2 === 0, levels = downward ? orderedRows : [...orderedRows].reverse();
    for (const level of levels) {
      const row = rows.get(level), targets = new Map();
      for (const block of row) {
        const values = [];
        for (const e of edges) {
          const a = blockFor.get(e.a), b = blockFor.get(e.b);
          if (a === b) continue;
          if (parental(e.type)) {
            if (downward && b === block) values.push(position(e.a) - offsetFor.get(e.b));
            if (!downward && a === block) values.push(position(e.b) - offsetFor.get(e.a));
          }
        }
        // A terminal ancestor stays over their children. Do not let their collateral
        // siblings pull the whole branch farther outward on every alternating sweep.
        if (!values.length) for (const e of edges) if (parental(e.type)) {
          if (blockFor.get(e.a) === block) values.push(position(e.b) - offsetFor.get(e.a));
          if (blockFor.get(e.b) === block) values.push(position(e.a) - offsetFor.get(e.b));
        }
        // A childless sibling follows the sibling closer to the selected person.
        if (!values.length) for (const e of edges) if (e.type === 'sibling') {
          if (blockFor.get(e.a) === block && blockFor.get(e.b).distance < block.distance) values.push(position(e.b) - offsetFor.get(e.a));
          if (blockFor.get(e.b) === block && blockFor.get(e.a).distance < block.distance) values.push(position(e.a) - offsetFor.get(e.b));
        }
        targets.set(block.id, values.length ? mean(values) : block.x);
      }
      place(row, targets, true);
    }
  }
  const points = new Map(ids.map(id => [id, { x: position(id) - card.width / 2, generation: generation.get(id), branch: branch.get(id) || 0 }]));
  const min = Math.min(...[...points.values()].map(p => p.x)), max = Math.max(...[...points.values()].map(p => p.x + card.width));
  return { points, min, max, rootParents };
}

function connectionRoutes(persons, edges) {
  const byId = new Map(persons.map(p => [p.id, p])), parents = new Map(), bands = new Map(), routes = Object.create(null);
  for (const edge of edges) if (parental(edge.type)) {
    if (!parents.has(edge.b)) parents.set(edge.b, []);
    parents.get(edge.b).push(edge.a);
  }
  for (const edge of edges) if (parental(edge.type)) {
    const a = byId.get(edge.a), b = byId.get(edge.b), bandKey = `${a.y}:${b.y}`;
    if (b.y <= a.y + card.height) continue;
    if (!bands.has(bandKey)) bands.set(bandKey, new Map());
    const families = bands.get(bandKey), familyKey = [...parents.get(edge.b)].sort(stable).join(':');
    if (!families.has(familyKey)) families.set(familyKey, { id: familyKey, edges: [], left: Infinity, right: -Infinity, top: a.y + card.height, bottom: b.y });
    const family = families.get(familyKey); family.edges.push(edge.id);
    family.left = Math.min(family.left, a.x + card.width / 2, b.x + card.width / 2);
    family.right = Math.max(family.right, a.x + card.width / 2, b.x + card.width / 2);
  }
  for (const families of bands.values()) {
    const channels = [];
    for (const family of [...families.values()].sort((a, b) => a.left - b.left || stable(a.id, b.id))) {
      let channel = channels.findIndex(right => right + 24 < family.left);
      if (channel < 0) { channel = channels.length; channels.push(-Infinity); }
      channels[channel] = family.right; family.channel = channel;
    }
    for (const family of families.values()) {
      const viaY = family.top + 35 + (family.bottom - family.top - 70) * (family.channel + 1) / (channels.length + 1);
      for (const id of family.edges) routes[id] = { viaY };
    }
  }
  return routes;
}

function generationTitle(value) {
  if (value === 0) return 'Ваше поколение';
  if (value === -1) return 'Родители';
  if (value === -2) return 'Бабушки и дедушки';
  if (value === -3) return 'Прабабушки и прадедушки';
  if (value < -3) return `${-value} поколения до вас`;
  if (value === 1) return 'Дети';
  if (value === 2) return 'Внуки';
  return `${value} поколения после вас`;
}

export function layoutFamily(model) {
  const persons = model.persons.map(p => ({ ...p }));
  const { rank, components, adjacency, warnings } = generations(persons, model.edges, model.rootPerson);
  const main = arrange(components[0], model, rank, adjacency, model.rootPerson, true);
  const topGeneration = Math.min(...components[0].map(id => rank.get(id)));
  const shiftX = 260 - main.min, positions = new Map();
  for (const [id, point] of main.points) positions.set(id, { ...point, x: point.x + shiftX, y: 160 + (point.generation - topGeneration) * rowStep, layoutComponent: 'main' });
  const mainRight = main.max + shiftX, zones = [];
  let otherBottom = 160, otherRight = mainRight;
  const singles = components.slice(1).filter(ids => ids.length === 1);
  for (const [index, ids] of singles.entries()) {
    const column = index % 2, row = Math.floor(index / 2), x = mainRight + 180 + column * (card.width + familyGap), y = 160 + row * (card.height + 90);
    positions.set(ids[0], { x, y, generation: null, branch: 0, layoutComponent: 'other' });
    otherBottom = Math.max(otherBottom, y + card.height); otherRight = Math.max(otherRight, x + card.width);
  }
  let componentTop = 160 + Math.ceil(singles.length / 2) * (card.height + 90);
  for (const ids of components.slice(1).filter(ids => ids.length > 1)) {
    const component = arrange(ids, model, rank, adjacency, ids[0], false);
    const minRank = Math.min(...ids.map(id => rank.get(id)));
    for (const [id, point] of component.points) {
      const x = point.x - component.min + mainRight + 180, y = componentTop + (point.generation - minRank) * rowStep;
      positions.set(id, { ...point, x, y, generation: null, layoutComponent: 'other' });
      otherBottom = Math.max(otherBottom, y + card.height); otherRight = Math.max(otherRight, x + card.width);
    }
    componentTop = otherBottom + 100;
  }
  for (const person of persons) Object.assign(person, positions.get(person.id));
  if (components.length > 1) zones.push({ x: mainRight + 130, y: 85, width: otherRight - mainRight - 80, height: otherBottom - 45, title: 'Отдельные записи' });
  const generationRows = [...new Set(components[0].map(id => rank.get(id)))].sort((a, b) => a - b).map(value => ({ generation: value, y: 160 + (value - topGeneration) * rowStep, title: generationTitle(value), x: 22, endX: mainRight + 35 }));
  return { ...model, persons, width: Math.max(950, otherRight + 100), height: Math.max(...persons.map(p => p.y + card.height)) + 170,
    box: { ...card }, layout: 'generations', generationRows, layoutZones: zones, connectionRoutes: connectionRoutes(persons, model.edges), layoutWarnings: [...new Set(warnings)] };
}
