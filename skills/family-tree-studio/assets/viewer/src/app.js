const byId = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const basis = { documented: 'по документу', reported: 'со слов семьи', hypothesis: 'гипотеза', unknown: 'основание не указано' };
const kinds = { 'parent-child': 'Родительская связь', adoptive: 'Усыновление / удочерение', guardian: 'Опека', partner: 'Партнёры', sibling: 'Брат / сестра' };
const state = { zoom: 1, left: 0, top: 0, selected: null, mode: 'near', target: null, people: [], edges: [], path: [] };
let model, people, cards = new Map(), lines = new Map(), drag = null, overview = true;
let previousViewport = { width: innerWidth, height: innerHeight };
const folded = value => value.toLowerCase().normalize('NFKC').replace(/ё/g, 'е');
function node(tag, value, className) { const n = document.createElement(tag); if (value != null) n.textContent = value; if (className) n.className = className; return n; }
function vector(tag, attrs) { const n = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value)); return n; }
const life = p => `${p.birth || 'Дата рождения неизвестна'}${p.death ? ' — ' + p.death : p.lifeStatus === 'deceased' ? ' — дата смерти неизвестна' : ''}`;
const photoTitle = p => !p.photo ? 'Фотография пока не добавлена' : p.photo.kind === 'generated' ? 'Воображаемый портрет · не историческое фото' : p.photo.kind === 'original' ? 'Подлинная фотография' : 'Фотография, выбранная владельцем';
const relationTitle = e => `${kinds[e.type]} · ${basis[e.confidence]}`;
const openConflicts = item => (item.evidence || []).flatMap(claim => claim.conflicts || []).filter(conflict => conflict.status === 'open');
const claimNames = { 'family-story': 'Семейное сообщение', candidate: 'Кандидат на проверку', hypothesis: 'Гипотеза', documented: 'Есть документальное основание', concluded: 'Оформлен исследовательский вывод' };
const informationNames = { primary: 'Первичная информация', secondary: 'Вторичная информация', undetermined: 'Происхождение информации не определено' };
const evidenceNames = { direct: 'Прямое свидетельство', indirect: 'Косвенное свидетельство', negative: 'Отрицательное свидетельство' };
const formNames = { original: 'Оригинальный источник', derivative: 'Производная копия', authored: 'Авторское изложение', unknown: 'Форма источника не определена' };
function evidenceButton(item, isPerson = false) {
  const button = node('button', isPerson ? 'Почему указаны эти сведения?' : 'Почему эта связь?', 'evidence-button');
  button.type = 'button';
  button.setAttribute('aria-label', isPerson ? `Основания сведений: ${item.name}` : `Почему эта связь: ${people.get(item.a).name} — ${people.get(item.b).name}`);
  button.onclick = () => showEvidence(item, isPerson); return button;
}
function evidenceParagraph(parent, heading, value, className = '') {
  if (!value) return;
  const section = node('section', null, 'evidence-field ' + className); section.append(node('h4', heading), node('p', value)); parent.append(section);
}
function showEvidence(item, isPerson = false) {
  const dialog = byId('evidence-dialog'), body = byId('evidence-body'); body.replaceChildren();
  byId('evidence-title').textContent = isPerson ? 'Основания сведений' : 'Почему эта связь?';
  byId('evidence-subtitle').textContent = isPerson ? item.name : `${people.get(item.a).name} → ${people.get(item.b).name}\n${relationTitle(item)}`;
  if (model.demo) body.append(node('p', 'Учебный пример: все утверждения и документы вымышлены. Ссылки example.invalid не ведут к историческим материалам.', 'evidence-demo'));
  if (openConflicts(item).length) body.append(node('p', 'Есть неразрешённое противоречие. Метка «по документу» не отменяет его и не делает вывод окончательным.', 'evidence-warning'));
  if (!(item.evidence || []).length) body.append(node('p', 'Обоснование пока не прикреплено. Показанная метка сама по себе не подтверждает связь; добавьте конкретное утверждение, источник и объяснение.', 'evidence-empty'));
  for (const claim of item.evidence || []) {
    const article = node('article', null, 'claim-card'); article.dataset.claim = claim.claimId;
    article.append(node('p', claimNames[claim.status] || 'Статус не указан', 'claim-status'), node('h3', claim.statement));
    if (claim.assertionLabel) article.append(node('p', 'Для дерева: ' + claim.assertionLabel, 'assertion-label'));
    if (!claim.sources.length) article.append(node('p', 'Источники к этому утверждению пока не приложены.', 'evidence-empty'));
    for (const source of claim.sources) {
      const box = node('section', null, 'source-card'); box.dataset.source = source.id;
      const heading = node('h4', source.title); box.append(heading);
      if (source.url) {
        let url; try { url = new URL(source.url); } catch { url = null; }
        if (url && ['https:', 'http:'].includes(url.protocol)) { const link = node('a', 'Открыть источник ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link); }
      }
      evidenceParagraph(box, 'Где именно', source.locator || 'Координаты записи пока не указаны.');
      const metadata = [formNames[source.form], source.accessedAt ? 'Проверено: ' + source.accessedAt : ''].filter(Boolean);
      if (metadata.length) box.append(node('p', metadata.join(' · '), 'source-classification'));
      const labels = [informationNames[source.information], evidenceNames[source.type]].filter(Boolean);
      if (labels.length) box.append(node('p', labels.join(' · '), 'source-classification'));
      evidenceParagraph(box, 'Что прочитано в источнике', source.reading, 'source-reading');
      evidenceParagraph(box, 'Как это связано с утверждением', source.reasoning);
      if (source.type === 'negative') evidenceParagraph(box, 'Почему запись ожидалась и какой охват проверен', source.negativeScope || 'Охват отрицательного свидетельства пока не указан. По отсутствию записи нельзя делать окончательный вывод.', !source.negativeScope ? 'evidence-warning' : '');
      article.append(box);
    }
    for (const conflict of claim.conflicts) {
      const box = node('section', null, 'conflict-card ' + conflict.status);
      box.append(node('h4', conflict.status === 'open' ? 'Противоречие ещё открыто' : 'Противоречие разобрано'), node('p', conflict.description));
      evidenceParagraph(box, 'Объяснение решения', conflict.resolution); article.append(box);
    }
    if (claim.conclusion) {
      const conclusion = node('section', null, 'conclusion-card');
      evidenceParagraph(conclusion, 'Вывод исследования', claim.conclusion.text);
      evidenceParagraph(conclusion, 'Почему сделан такой вывод', claim.conclusion.reasoning);
      evidenceParagraph(conclusion, 'Ограничения вывода', claim.conclusion.limitations); article.append(conclusion);
    }
    body.append(article);
  }
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function portrait(p, detail = false) {
  if (p.photo) { const img = new Image(); img.src = p.photo.path; img.alt = p.name; img.className = detail ? 'detail-portrait' : 'portrait'; return img; }
  const letters = p.name.split(/\s+/).slice(0, 2).map(s => s[0]).join('');
  const placeholder = node('span', letters, detail ? 'detail-portrait detail-initials' : 'portrait initials');
  placeholder.setAttribute('aria-label', 'Фото отсутствует'); return placeholder;
}
function branchShape(e) {
  const a = people.get(e.a), b = people.get(e.b), w = model.box.width, h = model.box.height;
  if (['partner', 'sibling'].includes(e.type)) {
    const ax = a.x + w / 2, bx = b.x + w / 2, y = Math.min(a.y, b.y), lift = e.type === 'sibling' ? 65 : 38;
    return `M${ax} ${a.y} C${ax} ${y - lift} ${bx} ${y - lift} ${bx} ${b.y}`;
  }
  const x1 = a.x + w / 2, y1 = a.y + h, x2 = b.x + w / 2, y2 = b.y;
  return `M${x1} ${y1} C${x1} ${y1 + (y2 - y1) * .6} ${x2} ${y2 - (y2 - y1) * .6} ${x2} ${y2}`;
}
function drawFamily() {
  byId('world').style.width = model.width + 'px'; byId('world').style.height = model.height + 'px';
  byId('branches').setAttribute('width', model.width); byId('branches').setAttribute('height', model.height);
  const connected = new Set(model.edges.flatMap(e => [e.a, e.b]));
  for (const e of model.edges) {
    const line = vector('path', { d: branchShape(e), class: 'branch ' + e.confidence + (openConflicts(e).length ? ' has-conflict' : ''), 'data-connection-line': e.id, 'aria-hidden': true });
    byId('branches').append(line); lines.set(e.id, line);
    const hit = vector('path', { d: branchShape(e), class: 'branch-hit', role: 'button', tabindex: 0, 'data-connection': e.id, 'aria-label': `Почему эта связь: ${people.get(e.a).name} — ${people.get(e.b).name}` });
    hit.addEventListener('click', event => { event.stopPropagation(); showEvidence(e); });
    hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showEvidence(e); } });
    byId('branches').append(hit);
  }
  const labels = new Set();
  for (const e of model.edges) {
    const group = e.family || e.id;
    if (labels.has(group)) continue; labels.add(group);
    const a = people.get(e.a), b = people.get(e.b), family = model.families.find(f => f.id === e.family);
    const participants = family ? family.adults.map(id => people.get(id)) : [a, b];
    const x = participants.reduce((sum, p) => sum + p.x + model.box.width / 2, 0) / participants.length;
    const y = ['sibling', 'partner'].includes(e.type) ? Math.min(a.y, b.y) - 44 : a.y + model.box.height + 58;
    const label = vector('text', { x, y, 'text-anchor': 'middle', class: 'branch-label', 'aria-hidden': true });
    label.textContent = openConflicts(e).length ? 'Есть противоречие' : e.family ? relationTitle(e) : `${e.type === 'guardian' || e.type === 'adoptive' ? kinds[e.type] + ' · ' : ''}${basis[e.confidence]}`; byId('branches').append(label);
  }
  for (const p of model.persons) {
    const card = node('button', null, 'leaf' + (p.id === model.rootPerson ? ' root' : ''));
    card.type = 'button'; card.dataset.person = p.id; card.style.left = p.x + 'px'; card.style.top = p.y + 'px';
    card.setAttribute('aria-label', p.name); card.setAttribute('aria-pressed', 'false');
    card.append(portrait(p), node('h2', p.name), node('p', life(p), 'lifespan'));
    if (p.place) { const place = node('p', null, 'place'), icon = new Image(); icon.src = 'assets/icons/map-pin.svg'; icon.alt = ''; place.append(icon, document.createTextNode(p.place)); card.append(place); }
    card.append(node('div', p.photo?.kind === 'generated' ? 'Воображаемый портрет' : basis[p.confidence], 'photo-kind'));
    if (p.id === model.rootPerson) card.append(node('span', 'Вы здесь', 'root-label'));
    if (!connected.has(p.id)) card.append(node('span', 'Пока без установленной связи', 'unknown-badge'));
    card.addEventListener('click', () => choose(p.id)); byId('leaves').append(card); cards.set(p.id, card);
  }
  byId('mini-map').setAttribute('viewBox', `0 0 ${model.width} ${model.height}`);
  for (const p of model.persons) byId('mini-map').append(vector('rect', { x: p.x, y: p.y, width: model.box.width, height: model.box.height, rx: 40, fill: p.id === model.rootPerson ? '#426c47' : '#bdcbaa' }));
  byId('mini-map').append(vector('rect', { id: 'map-window', fill: '#7e9a6920', stroke: '#849a6b', 'stroke-width': 6, rx: 18 }));
}
function paintCamera() {
  byId('world').style.transform = `translate(${state.left}px, ${state.top}px) scale(${state.zoom})`;
  byId('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
  const box = byId('map-window');
  if (box) for (const [key, value] of Object.entries({ x: -state.left / state.zoom, y: -state.top / state.zoom, width: innerWidth / state.zoom, height: innerHeight / state.zoom })) box.setAttribute(key, value);
}
function scaleTo(value, x = innerWidth / 2, y = innerHeight / 2) {
  overview = false;
  const next = Math.min(2.1, Math.max(.15, value)), factor = next / state.zoom;
  state.left = x - (x - state.left) * factor; state.top = y - (y - state.top) * factor; state.zoom = next; paintCamera();
}
function fit() {
  overview = true;
  const left = Math.min(...model.persons.map(p => p.x)) - 24, right = Math.max(...model.persons.map(p => p.x + model.box.width)) + 24;
  const top = Math.min(...model.persons.map(p => p.y)) - 65, bottom = Math.max(...model.persons.map(p => p.y + model.box.height)) + 25;
  const roomWidth = innerWidth - 50, roomHeight = innerHeight - 310;
  state.zoom = Math.min(1.1, roomWidth / (right - left), roomHeight / (bottom - top));
  state.left = (innerWidth - (right - left) * state.zoom) / 2 - left * state.zoom;
  state.top = 190 + (roomHeight - (bottom - top) * state.zoom) / 2 - top * state.zoom; paintCamera();
}
function center(id, zoom = Math.max(state.zoom, .8)) {
  overview = false;
  const p = people.get(id); state.zoom = zoom;
  const x = state.selected && innerWidth > 800 ? (innerWidth - 330) / 2 : innerWidth / 2;
  state.left = x - (p.x + model.box.width / 2) * zoom; state.top = innerHeight * .52 - (p.y + model.box.height / 2) * zoom; paintCamera();
}
function route(start, finish, hypotheses = false) {
  const pending = [{ id: start, nodes: [start], links: [] }], seen = new Set([start]);
  while (pending.length) {
    const current = pending.shift(); if (current.id === finish) return current;
    for (const e of model.edges) {
      if (!hypotheses && (e.confidence === 'hypothesis' || openConflicts(e).length)) continue;
      const id = e.a === current.id ? e.b : e.b === current.id ? e.a : null;
      if (id && !seen.has(id)) { seen.add(id); pending.push({ id, nodes: [...current.nodes, id], links: [...current.links, e] }); }
    }
  }
  return hypotheses ? { nodes: [], links: [] } : route(start, finish, true);
}
function selection() {
  const selected = state.selected, ids = new Set(selected ? [selected] : []), links = [];
  state.path = [];
  if (selected && state.mode === 'path') {
    const found = route(selected, state.target); found.nodes.forEach(id => ids.add(id)); links.push(...found.links); state.path = found.nodes;
  } else if (selected && state.mode === 'near') {
    for (const e of model.edges) if (e.a === selected || e.b === selected) { ids.add(e.a); ids.add(e.b); links.push(e); }
  } else if (selected) {
    const todo = [selected];
    for (const id of todo) for (const e of model.edges) {
      if (!['parent-child', 'adoptive'].includes(e.type)) continue;
      const next = state.mode === 'ancestors' && e.b === id ? e.a : state.mode === 'descendants' && e.a === id ? e.b : null;
      if (next) { if (!links.includes(e)) links.push(e); if (!ids.has(next)) { ids.add(next); todo.push(next); } }
    }
  }
  state.people = [...ids]; state.edges = links.map(e => e.id);
  for (const [id, card] of cards) { card.classList.toggle('selected', id === selected); card.classList.toggle('in-path', ids.has(id) && id !== selected); card.setAttribute('aria-pressed', String(id === selected)); }
  for (const [id, line] of lines) line.classList.toggle('active', state.edges.includes(id));
  const note = byId('selection-note'); note.hidden = !selected;
  if (selected) {
    const messages = [];
    if (state.mode === 'path' && !state.path.length) messages.push('Между людьми пока нет установленной цепочки.');
    else if (state.mode === 'path') messages.push(`Связей в выбранном пути: ${links.length}.`);
    if (links.some(e => e.confidence === 'hypothesis')) messages.push('В пути есть гипотеза. Родство не доказано.');
    else if (links.some(e => e.confidence !== 'documented')) messages.push('Часть связей пока без документального подтверждения.');
    if (links.some(e => e.type === 'guardian' || e.type === 'adoptive')) messages.push('Показаны также социальные семейные связи.');
    if (links.some(e => openConflicts(e).length)) messages.push('Есть неразрешённое противоречие — откройте основания связи.');
    note.textContent = messages.join(' ') || 'Выбраны связи с указанным документальным основанием.';
  }
  if (selected) showDetails();
}
function showDetails() {
  const p = people.get(state.selected), body = byId('detail-body'); body.replaceChildren(portrait(p, true), node('h2', p.name), node('p', life(p)), node('p', p.place), node('p', photoTitle(p), 'detail-muted'));
  body.append(node('p', `Основание сведений: ${basis[p.confidence]}.`, 'detail-muted'));
  if (p.publicNote) body.append(node('p', p.publicNote));
  if (p.sourceLabel) body.append(node('p', p.sourceLabel, 'detail-muted'));
  if (p.evidence?.length) body.append(evidenceButton(p, true));
  if (openConflicts(p).length) body.append(node('p', 'В сведениях об этом человеке есть неразрешённое противоречие.', 'evidence-warning'));
  if (p.sources.length) {
    body.append(node('h3', 'Источники'));
    for (const source of p.sources) {
      let url; try { url = new URL(source.url); } catch { continue; }
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      const a = node('a', source.label); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a, node('br'));
    }
  }
  body.append(node('h3', state.mode === 'path' ? 'Выбранная цепочка' : 'Ближайшие связи'));
  if (state.mode === 'path') {
    const found = route(p.id, state.target);
    if (!found.nodes.length) body.append(node('p', 'Связь ещё не установлена.', 'detail-muted'));
    found.nodes.forEach((id, i) => { const step = node('div', people.get(id).name, 'path-step'); if (found.links[i]) { step.append(node('small', relationTitle(found.links[i]))); if (openConflicts(found.links[i]).length) step.append(node('small', 'Есть открытое противоречие', 'conflict-label')); step.append(evidenceButton(found.links[i])); } body.append(step); });
    if (found.links.some(e => e.confidence === 'hypothesis')) body.append(node('p', 'Эта цепочка содержит гипотезу и не является доказательством родства.', 'evidence-warning'));
  } else {
    const nearby = model.edges.filter(e => e.a === p.id || e.b === p.id);
    if (!nearby.length) body.append(node('p', 'Связи с другими людьми пока не установлены.', 'detail-muted'));
    for (const e of nearby) { const id = e.a === p.id ? e.b : e.a, row = node('div', null, 'relation-row'), button = node('button', people.get(id).name, 'related-person'); button.append(node('small', relationTitle(e))); button.onclick = () => { choose(id); center(id); }; row.append(button); if (openConflicts(e).length) row.append(node('p', 'Есть открытое противоречие', 'conflict-label')); row.append(evidenceButton(e)); body.append(row); }
  }
}
function choose(id) { state.selected = id; byId('details').hidden = false; selection(); const q = new URLSearchParams({ person: id }); history.replaceState(null, '', '#' + q); }
function closeDetails() { state.selected = null; byId('details').hidden = true; selection(); history.replaceState(null, '', location.pathname); }
function search() {
  const query = folded(byId('search').value.trim()), results = byId('matches'); results.replaceChildren(); results.hidden = !query;
  if (!query) return;
  const found = model.persons.filter(p => folded([p.name, ...p.aliases].join(' ')).includes(query)).slice(0, 20);
  for (const p of found) { const button = node('button', p.name); button.onclick = () => { byId('search').value = ''; results.hidden = true; choose(p.id); center(p.id); }; results.append(button); }
  if (!found.length) results.append(node('p', 'Пока не нашли. Попробуйте часть имени.'));
}
async function start() {
  const response = await fetch('tree.json'); if (!response.ok) throw Error('Не удалось загрузить подготовленные данные');
  model = await response.json(); people = new Map(model.persons.map(p => [p.id, p])); state.target = model.rootPerson;
  document.title = model.title + ' · Древо'; byId('tree-title').textContent = model.title;
  byId('summary').textContent = `Людей: ${model.persons.length} · Связей: ${model.edges.length} · история продолжается`;
  byId('demo-label').textContent = model.demo ? 'ВЫМЫШЛЕННЫЙ ПРИМЕР · БЕЗ СЕМЕЙНЫХ ДАННЫХ' : 'СЕМЕЙНАЯ ИСТОРИЯ';
  byId('demo-explanation').textContent = model.demo ? 'Это вымышленная семья. Имена, даты и связи придуманы для знакомства с приложением.' : 'Публичная сборка содержит показанные имена и даты. Публикуйте её только в согласованном составе.';
  for (const p of model.persons) { const option = node('option', p.name); option.value = p.id; byId('target').append(option); } byId('target').value = state.target;
  drawFamily(); if (innerWidth < 800) center(model.rootPerson, .85); else fit();
  const supplied = new URLSearchParams(location.hash.slice(1)).get('person'); if (people.has(supplied)) { choose(supplied); center(supplied); }
  byId('search').addEventListener('input', search); byId('search').addEventListener('keydown', e => { if (e.key === 'Enter') byId('matches').querySelector('button')?.click(); if (e.key === 'Escape') byId('matches').hidden = true; });
  byId('mode').onchange = e => { state.mode = e.target.value; byId('target').hidden = state.mode !== 'path'; if (!state.selected) choose(model.rootPerson); else selection(); };
  byId('target').onchange = e => { state.target = e.target.value; selection(); };
  byId('fit').onclick = fit; byId('brand').onclick = e => { e.preventDefault(); fit(); };
  byId('zoom-in').onclick = () => scaleTo(state.zoom * 1.25); byId('zoom-out').onclick = () => scaleTo(state.zoom / 1.25); byId('zoom-level').onclick = () => scaleTo(1);
  byId('close-details').onclick = closeDetails; byId('about').onclick = () => byId('guide').showModal(); byId('close-guide').onclick = () => byId('guide').close();
  byId('close-evidence').onclick = () => byId('evidence-dialog').close();
  const garden = byId('garden');
  garden.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('button,[data-connection]')) return; overview = false; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: state.left, top: state.top }; garden.setPointerCapture(e.pointerId); garden.classList.add('dragging'); });
  garden.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; state.left = drag.left + e.clientX - drag.x; state.top = drag.top + e.clientY - drag.y; paintCamera(); });
  const end = () => { drag = null; garden.classList.remove('dragging'); }; garden.addEventListener('pointerup', end); garden.addEventListener('pointercancel', end);
  garden.addEventListener('wheel', e => { e.preventDefault(); overview = false; if (e.ctrlKey || e.metaKey) scaleTo(state.zoom * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); else { state.left -= e.deltaX; state.top -= e.deltaY; paintCamera(); } }, { passive: false });
  byId('map-button').onclick = e => { overview = false; const r = byId('mini-map').getBoundingClientRect(), scale = Math.min(r.width / model.width, r.height / model.height); const x = (e.clientX - r.left - (r.width - model.width * scale) / 2) / scale, y = (e.clientY - r.top - (r.height - model.height * scale) / 2) / scale; state.left = innerWidth / 2 - x * state.zoom; state.top = innerHeight / 2 - y * state.zoom; paintCamera(); };
  window.addEventListener('resize', () => { if (overview) fit(); else { state.left += (innerWidth - previousViewport.width) / 2; state.top += (innerHeight - previousViewport.height) / 2; paintCamera(); } previousViewport = { width: innerWidth, height: innerHeight }; });
  document.addEventListener('keydown', e => { if (byId('evidence-dialog').open || byId('guide').open) return; if (e.key === 'Escape') closeDetails(); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); byId('search').focus(); } });
  window.drevo = { getState: () => structuredClone({ ...state, personCount: model.persons.length }), fit, center };
}
start().catch(error => { byId('error').hidden = false; byId('error').textContent = 'Не удалось открыть древо: ' + error.message; console.error(error); });
