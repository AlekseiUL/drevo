const byId = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const compactViewport = () => innerWidth <= 800 || (innerWidth <= 950 && innerHeight <= 500);
const basis = { documented: 'по документу', reported: 'со слов семьи', hypothesis: 'гипотеза', unknown: 'основание не указано' };
const kinds = { 'parent-child': 'Родительская связь', adoptive: 'Усыновление / удочерение', guardian: 'Опека', partner: 'Партнёры', sibling: 'Брат / сестра' };
const state = { zoom: 1, left: 0, top: 0, selected: null, mode: 'near', target: null, people: [], edges: [], path: [], dossierTab: 'overview' };
let model, people, cards = new Map(), lines = new Map(), overview = true;
const pointers = new Map();
let gesture = null, suppressTreeClickUntil = 0;
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
  if (e.type === 'guardian' || y2 <= y1) return `M${x1} ${y1} C${x1} ${y1 + 65} ${x2} ${y2 - 65} ${x2} ${y2}`;
  const middle = model.connectionRoutes?.[e.id]?.viaY ?? (y1 + y2) / 2, direction = Math.sign(x2 - x1), radius = Math.min(12, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} V${middle - radius} Q${x1} ${middle} ${x1 + direction * radius} ${middle} H${x2 - direction * radius} Q${x2} ${middle} ${x2} ${middle + radius} V${y2}`;
}
function drawFamily() {
  byId('world').style.width = model.width + 'px'; byId('world').style.height = model.height + 'px';
  byId('branches').setAttribute('width', model.width); byId('branches').setAttribute('height', model.height);
  for (const row of model.generationRows || []) {
    byId('branches').append(vector('line', { x1: row.x, x2: row.endX, y1: row.y - 55, y2: row.y - 55, class: 'generation-rule', 'aria-hidden': true }));
    const caption = vector('text', { x: row.x, y: row.y + 20, class: 'generation-caption', 'aria-hidden': true });
    caption.textContent = row.title; byId('branches').append(caption);
  }
  for (const zone of model.layoutZones || []) {
    byId('branches').append(vector('rect', { x: zone.x, y: zone.y, width: zone.width, height: zone.height, rx: 24, class: 'records-zone', 'aria-hidden': true }));
    const caption = vector('text', { x: zone.x + 24, y: zone.y + 34, class: 'generation-caption', 'aria-hidden': true });
    caption.textContent = zone.title; byId('branches').append(caption);
  }
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
    const group = e.family || (['parent-child', 'adoptive'].includes(e.type) ? [e.a, e.type, e.confidence, openConflicts(e).length > 0].join(':') : e.id);
    if (labels.has(group)) continue; labels.add(group);
    const a = people.get(e.a), b = people.get(e.b), family = model.families.find(f => f.id === e.family);
    const participants = family ? family.adults.map(id => people.get(id)) : [a, b];
    const x = participants.reduce((sum, p) => sum + p.x + model.box.width / 2, 0) / participants.length;
    const y = ['sibling', 'partner'].includes(e.type) ? Math.min(a.y, b.y) - 44 : a.y + model.box.height + 25;
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
function treeViewport() {
  if (!compactViewport()) return { left: 25, right: innerWidth - 25, top: 190, bottom: Math.max(240, innerHeight - 120) };
  const heading = document.querySelector('.heading').getBoundingClientRect();
  const tools = document.querySelector('.tools').getBoundingClientRect();
  const top = Math.max(innerHeight <= 500 ? 80 : 150, heading.bottom + 16), bottom = Math.max(top + 170, tools.top - 30);
  return { left: 14, right: innerWidth - 14, top, bottom };
}
function fit() {
  overview = true;
  const left = Math.min(...model.persons.map(p => p.x), ...(model.generationRows || []).map(row => row.x)) - 24, right = Math.max(...model.persons.map(p => p.x + model.box.width)) + 24;
  const top = Math.min(...model.persons.map(p => p.y)) - 65, bottom = Math.max(...model.persons.map(p => p.y + model.box.height)) + 25;
  const viewport = treeViewport(), roomWidth = viewport.right - viewport.left, roomHeight = viewport.bottom - viewport.top;
  state.zoom = Math.min(1.1, roomWidth / (right - left), roomHeight / (bottom - top));
  state.left = viewport.left + (roomWidth - (right - left) * state.zoom) / 2 - left * state.zoom;
  state.top = viewport.top + (roomHeight - (bottom - top) * state.zoom) / 2 - top * state.zoom; paintCamera();
}
function center(id, zoom = Math.max(state.zoom, .8)) {
  overview = false;
  const p = people.get(id); state.zoom = zoom;
  const x = state.selected && !compactViewport() ? (innerWidth - 470) / 2 : innerWidth / 2;
  const viewport = treeViewport();
  const y = compactViewport() ? Math.max(viewport.top + model.box.height * zoom / 2, viewport.bottom - model.box.height * zoom / 2 - 16) : innerHeight * .52;
  state.left = x - (p.x + model.box.width / 2) * zoom; state.top = y - (p.y + model.box.height / 2) * zoom; paintCamera();
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
const materialKinds = { photo: 'Фотография', document: 'Документ', audio: 'Аудиозапись', video: 'Видео', other: 'Материал' };
const dossierTabs = ['overview', 'materials', 'findings'];
const dossierNames = { overview: 'Обзор', materials: 'Материалы', findings: 'Находки' };
const emptyDossier = () => ({ biography: '', activity: '', materials: [], findings: [] });
let session = null, editorState = null, materialFilter = 'all';
const fileLimit = 20 * 1024 * 1024;
function safeWebLink(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function materialPath(value) { return typeof value === 'string' && /^assets\/materials\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(value) ? value : null; }
function externalLink(label, value) { const url = safeWebLink(value); if (!url) return null; const a = node('a', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function bytes(size) { return !Number.isFinite(size) ? '' : size < 1024 ? `${size} Б` : size < 1024 * 1024 ? `${Math.round(size / 1024)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`; }
function actionButton(label, handler, className = '') { const button = node('button', label, 'dossier-action ' + className); button.type = 'button'; button.onclick = handler; return button; }
function announce(message) { const status = byId('case-status'); status.textContent = message; status.hidden = false; clearTimeout(announce.timer); announce.timer = setTimeout(() => { status.hidden = true; }, 6500); }
function dossierFor(p) { return { ...emptyDossier(), ...(p.dossier || {}) }; }
function textSection(parent, title, text, empty) { const section = node('section', null, 'dossier-section'); section.append(node('h3', title)); section.append(node('p', text || empty, text ? 'dossier-prose' : 'dossier-empty')); parent.append(section); }
function findingsFor(p) { const all = [...(dossierFor(p).findings || []), ...(p.evidence || [])], seen = new Set(); return all.filter(item => { if (seen.has(item.claimId)) return false; seen.add(item.claimId); return true; }); }
function showDetails() {
  const p = people.get(state.selected), dossier = dossierFor(p), body = byId('detail-body');
  const header = node('div', null, 'person-header'); header.append(portrait(p, true));
  const heading = node('div', null, 'person-heading'); heading.append(node('span', 'ЛИЧНАЯ ИСТОРИЯ', 'eyebrow'), node('h2', p.name), node('p', life(p), 'person-dates'));
  if (p.place) heading.append(node('p', p.place, 'person-place')); header.append(heading); body.replaceChildren(header);
  if (session?.editable) body.append(node('p', 'Частное дело · изменения сохраняются локально', 'local-case-label'));
  const tabs = node('div', null, 'dossier-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Разделы карточки человека');
  const active = state.dossierTab || 'overview';
  for (const key of dossierTabs) {
    const count = key === 'materials' ? dossier.materials.length : key === 'findings' ? findingsFor(p).length : null;
    const button = node('button', dossierNames[key] + (count === null ? '' : ` ${count}`), 'dossier-tab'); button.type = 'button'; button.id = `tab-${key}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(key === active)); button.setAttribute('aria-controls', 'dossier-panel'); button.tabIndex = key === active ? 0 : -1;
    button.onclick = () => { state.dossierTab = key; showDetails(); byId(`tab-${key}`).focus(); };
    button.onkeydown = event => { let index = dossierTabs.indexOf(key); if (event.key === 'ArrowRight') index = (index + 1) % dossierTabs.length; else if (event.key === 'ArrowLeft') index = (index + dossierTabs.length - 1) % dossierTabs.length; else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = dossierTabs.length - 1; else return; event.preventDefault(); state.dossierTab = dossierTabs[index]; showDetails(); byId(`tab-${state.dossierTab}`).focus(); };
    tabs.append(button);
  }
  body.append(tabs);
  const panel = node('div', null, 'dossier-panel'); panel.id = 'dossier-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `tab-${active}`); body.append(panel);
  if (active === 'materials') renderMaterials(p, panel);
  else if (active === 'findings') renderFindings(p, panel);
  else renderOverview(p, panel);
}
function renderOverview(p, body) {
  const dossier = dossierFor(p);
  if (session?.editable) body.append(actionButton('Редактировать описание', () => editBiography(p), 'primary-soft'));
  textSection(body, 'О человеке', dossier.biography, 'Здесь можно сохранить рассказ о человеке — характер, семейные воспоминания, важные подробности.');
  textSection(body, 'Жизнь и деятельность', dossier.activity, 'Учёба, работа, служба, увлечения и важные события пока не описаны.');
  const archive = node('button', null, 'archive-entry'); archive.type = 'button'; archive.append(node('span', 'Архив человека'), node('strong', `${dossier.materials.length} ${dossier.materials.length === 1 ? 'материал' : dossier.materials.length > 1 && dossier.materials.length < 5 ? 'материала' : 'материалов'}`), node('small', 'Фотографии, документы и сохранённые ссылки →'));
  archive.onclick = () => { state.dossierTab = 'materials'; showDetails(); byId('tab-materials').focus(); }; body.append(archive);
  body.append(node('p', photoTitle(p), 'detail-muted'), node('p', `Основание сведений: ${basis[p.confidence]}.`, 'detail-muted'));
  if (p.publicNote) body.append(node('p', p.publicNote));
  if (p.sourceLabel) body.append(node('p', p.sourceLabel, 'detail-muted'));
  if (p.evidence?.length) body.append(evidenceButton(p, true));
  if (openConflicts(p).length) body.append(node('p', 'В сведениях об этом человеке есть неразрешённое противоречие.', 'evidence-warning'));
  if (p.sources.length) {
    body.append(node('h3', 'Источники'));
    for (const source of p.sources) { const a = externalLink(source.label, source.url); if (a) body.append(a, node('br')); }
  }
  renderRelations(p, body);
}
function renderFindings(p, body) {
  const findings = findingsFor(p);
  body.append(node('p', 'Здесь собраны утверждения и находки по этому человеку. Их статус сохраняется: совпадение имени и кандидат ещё не означают установленную связь.', 'dossier-intro'));
  if (!findings.length) body.append(node('p', 'Находок пока нет. Когда к человеку будет привязана запись, семейный рассказ или результат исследования, они появятся здесь вместе с основаниями.', 'dossier-empty'));
  for (const claim of findings) {
    const article = node('article', null, 'finding-card'); article.dataset.claim = claim.claimId;
    article.append(node('span', claimNames[claim.status] || 'Статус не указан', 'finding-status ' + claim.status), node('h3', claim.statement));
    if (claim.assertionLabel) article.append(node('p', claim.assertionLabel, 'finding-label'));
    if ((claim.conflicts || []).some(x => x.status === 'open')) article.append(node('p', 'Есть открытое противоречие', 'conflict-label'));
    article.append(node('p', `Источников: ${(claim.sources || []).length}`, 'detail-muted'));
    article.append(actionButton('Открыть находку и источники', () => showEvidence({name:p.name,evidence:[claim]}, true)));
    body.append(article);
  }
}
function renderMaterials(p, body) {
  const materials = dossierFor(p).materials;
  const top = node('div', null, 'materials-toolbar');
  if (session?.editable) top.append(actionButton('Прикрепить материал', () => editMaterial(p), 'primary-soft'));
  const label = node('label', 'Показать ', 'material-filter'); label.htmlFor = 'material-filter';
  const filter = node('select'); filter.id = 'material-filter';
  for (const [value, title] of [['all','Все материалы'],['photo','Фотографии'],['document','Документы'],['audio','Аудио'],['video','Видео'],['links','Ссылки'],['other','Другие файлы']]) { const option = node('option', title); option.value = value; filter.append(option); }
  filter.value = materialFilter; filter.onchange = () => { materialFilter = filter.value; showDetails(); byId('material-filter').focus(); }; label.append(filter); top.append(label); body.append(top);
  if (!materials.length) { body.append(node('div', null, 'archive-empty')); const box = body.lastChild; box.append(node('span', '✧', 'archive-empty-icon'), node('h3', 'Пока пустая папка'), node('p', session?.editable ? 'Прикрепите фотографию, скан, PDF или другой файл. Можно сохранить и ссылку на архивную запись.' : 'Здесь будут фотографии, документы, записи и ссылки, сохранённые для этого человека.')); return; }
  const visible = materials.filter(m => materialFilter === 'all' || (materialFilter === 'links' ? !m.path && m.url : m.kind === materialFilter));
  body.append(node('p', `Показано ${visible.length} из ${materials.length}`, 'material-count'));
  if (!visible.length) body.append(node('p', 'В этом разделе материалов пока нет. Выберите другой фильтр.', 'dossier-empty'));
  const grid = node('div', null, 'material-grid'); body.append(grid);
  for (const material of visible) {
    const card = node('article', null, 'material-card'); card.dataset.material = material.id;
    const button = node('button', null, 'material-open'); button.type = 'button'; button.setAttribute('aria-label', `${material.path || material.url ? 'Открыть материал' : 'Открыть описание'}: ${material.title}`); button.onclick = () => showMaterial(p, material);
    const thumb = node('div', null, 'material-thumbnail');
    const local = materialPath(material.path);
    if (local && material.preview === 'image') { const loading = node('span', 'Загружаем фото…', 'material-file-label thumbnail-loading'); thumb.append(loading); const img = new Image(); img.src = local; img.alt = material.title; img.loading = 'lazy'; img.onload = () => loading.remove(); img.onerror = () => { thumb.replaceChildren(node('span', 'Фото недоступно', 'material-file-label')); }; thumb.append(img); }
    else { thumb.classList.add('file-thumbnail'); thumb.append(node('span', !local && material.url ? '↗' : material.preview === 'audio' ? '♫' : material.preview === 'video' ? '▷' : '▤', 'material-symbol'), node('span', local ? (material.fileName?.split('.').pop() || materialKinds[material.kind] || 'Файл').toUpperCase() : material.url ? 'ССЫЛКА' : 'ОПИСАНИЕ', 'material-file-label')); }
    button.append(thumb, node('span', material.title, 'material-title')); card.append(button);
    card.append(node('p', [materialKinds[material.kind] || 'Материал',material.date].filter(Boolean).join(' · '), 'material-meta'));
    if (material.description) card.append(node('p', material.description, 'material-description'));
    if (material.sourceLabel || material.locator) card.append(node('p', material.sourceLabel || material.locator, 'material-source'));
    grid.append(card);
  }
}
function showMaterial(p, material) {
  const dialog = byId('material-dialog'), body = byId('material-body'); body.replaceChildren();
  byId('material-title').textContent = material.title; byId('material-subtitle').textContent = [p.name,materialKinds[material.kind] || 'Материал',material.date].filter(Boolean).join(' · ');
  const local = materialPath(material.path), external = safeWebLink(material.url);
  const actions = node('div', null, 'material-actions');
  if (local) { const download = node('a', 'Скачать исходный файл ↓', 'dossier-action primary-soft'); download.href = local; download.download = material.fileName || ''; actions.append(download); }
  if (external) actions.append(externalLink('Открыть исходную страницу ↗',external));
  if (session?.editable) { actions.append(actionButton('Изменить описание', () => editMaterial(p,material))); }
  body.append(actions);
  const preview = node('div', null, 'material-preview'); body.append(preview);
  if (local && material.preview === 'image') {
    const loading = node('p', 'Загружаем изображение…', 'detail-muted'); preview.append(loading);
    const img = new Image(); img.src = local; img.alt = material.description || material.title; img.onload = () => loading.remove(); img.onerror = () => { preview.replaceChildren(node('p','Не удалось открыть изображение. Можно скачать исходный файл.','dossier-empty')); }; preview.append(img);
  } else if (local && material.preview === 'pdf') {
    const frame = node('iframe'); frame.title = material.title; frame.src = local + '#view=FitH'; preview.append(frame);
    preview.append(node('p', 'Если PDF не отображается в браузере, скачайте исходный файл.', 'detail-muted'));
  } else if (local && ['audio','video'].includes(material.preview)) {
    const media = node(material.preview); media.controls = true; media.preload = 'metadata'; media.src = local; media.onerror = () => { preview.append(node('p','Браузер не смог воспроизвести файл. Скачайте оригинал для открытия в другом приложении.','dossier-empty')); }; preview.append(media);
  } else if (local && material.preview === 'text' && (!material.size || material.size <= 1024 * 1024)) {
    const pre = node('pre','Загружаем текст…','material-text'); preview.append(pre);
    fetch(local).then(response=>{if(!response.ok)throw Error('load');return response.text();}).then(text=>{if(pre.isConnected)pre.textContent=text.length>50000?text.slice(0,50000)+'\n\n…Показан фрагмент; полный текст — в исходном файле.':text;}).catch(()=>{if(pre.isConnected)pre.textContent='Текст не удалось загрузить. Скачайте исходный файл.';});
  } else preview.append(node('p', local ? 'Этот формат хранится как оригинальный файл. Скачайте его, чтобы открыть в подходящем приложении.' : external ? 'Это сохранённая ссылка. Исходная страница откроется отдельно; её содержимое не загружается автоматически.' : 'Здесь сохранено описание материала. Сам файл не включён в эту версию.', 'dossier-empty'));
  if (material.description) textSection(body,'Описание',material.description,'');
  const metadata = node('dl',null,'material-metadata');
  for (const [label,value] of [['Источник',material.sourceLabel],['Шифр / страница',material.locator],['Права и условия',material.rights],['Файл',material.fileName],['Размер',bytes(material.size)]]) if(value){metadata.append(node('dt',label),node('dd',value));}
  if (material.sourceUrl) { const link = externalLink('Открыть источник ↗',material.sourceUrl); if(link){metadata.append(node('dt','Ссылка на источник'));const dd=node('dd');dd.append(link);metadata.append(dd);} }
  body.append(metadata);
  if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0;
}
async function apiPost(url, payload) {
  if (!session?.editable || !session.token) throw Error('Редактирование доступно только в локальном семейном деле.');
  const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Drevo-Token':session.token},body:JSON.stringify({caseVersion:session.caseVersion,...payload})});
  let result; try {result=await response.json();}catch {result={error:'Не удалось прочитать ответ локального дела.'};}
  if (!response.ok) throw Error(response.status===409 ? 'Дело изменилось в другой вкладке или на диске. Ваш текст остаётся в форме. Сохраните его копию и обновите страницу перед повторным сохранением.' : result.error || `Не удалось сохранить изменения (${response.status}).`);
  if (!result.tree || typeof result.caseVersion !== 'string') throw Error('Локальное дело вернуло неполный результат. Обновите страницу для проверки сохранённых данных.');
  session.caseVersion=result.caseVersion; replaceModel(result.tree); return result;
}
function replaceModel(next) {
  const selected=state.selected; model=next; people=new Map(model.persons.map(p=>[p.id,p]));
  if(!people.has(state.target))state.target=model.rootPerson;
  if(!people.has(selected)){state.selected=null;byId('details').hidden=true;}
  for(const id of ['branches','leaves','mini-map','target'])byId(id).replaceChildren(); cards.clear();lines.clear();
  updateModelHeading();fillTargets();drawFamily();paintCamera();selection();
}
function updateModelHeading() {
  document.title=model.title+' · Древо';byId('tree-title').textContent=model.title;
  byId('summary').textContent=`Людей: ${model.persons.length} · Связей: ${model.edges.length} · история продолжается`;
  byId('demo-label').textContent=model.demo?'ВЫМЫШЛЕННЫЙ ПРИМЕР · БЕЗ СЕМЕЙНЫХ ДАННЫХ':'СЕМЕЙНАЯ ИСТОРИЯ';
  byId('demo-explanation').textContent=model.demo?'Это вымышленная семья. Имена, даты, связи и архивные материалы придуманы для знакомства с приложением.':session?.editable?'Это локальное семейное дело. Описания и прикреплённые файлы сохраняются в нём; публикация выполняется отдельно.':'Публичная сборка содержит выбранные сведения и материалы. Публикуйте её только в согласованном составе.';
}
function fillTargets(){for(const p of model.persons){const option=node('option',p.name);option.value=p.id;byId('target').append(option);}byId('target').value=state.target;}
function inputField(form,label,name,value='',type='text',hint='') {
  const box=node('div',null,'editor-field'),title=node('label',label);title.htmlFor='edit-'+name;
  const input=node(type==='textarea'?'textarea':type==='select'?'select':'input');input.id='edit-'+name;input.name=name;
  if(!['textarea','select'].includes(type))input.type=type; if(type==='textarea')input.rows=name==='activity'?9:5; input.value=value || '';
  box.append(title,input); if(hint){const small=node('small',hint);small.id='hint-'+name;input.setAttribute('aria-describedby',small.id);box.append(small);}form.append(box);return input;
}
function openEditor(title,subtitle) {
  const dialog=byId('editor-dialog');byId('editor-title').textContent=title;byId('editor-subtitle').textContent=subtitle;
  const form=node('form');form.id='dossier-editor';const status=node('p',null,'editor-status');status.id='editor-status';status.setAttribute('role','status');status.hidden=true;
  byId('editor-body').replaceChildren(form);editorState={dirty:false,busy:false,status};form.addEventListener('input',()=>{editorState.dirty=true;});form.addEventListener('change',()=>{editorState.dirty=true;});
  if(!dialog.open)dialog.showModal();dialog.scrollTop=0;return {form,status};
}
function editorActions(form,status,saveLabel='Сохранить') {
  form.append(status);const actions=node('div',null,'editor-actions'),save=node('button',saveLabel,'dossier-action primary-solid');save.type='submit';
  const cancel=actionButton('Отменить изменения',()=>{if(!editorState?.busy){editorState=null;byId('editor-dialog').close();}});actions.append(save,cancel);form.append(actions);return save;
}
function closeEditor(force=false) {
  if(editorState?.busy)return;
  if(editorState?.dirty&&!force){editorState.status.hidden=false;editorState.status.textContent='Есть несохранённые изменения. Сохраните их или нажмите «Отменить изменения».';editorState.status.setAttribute('role','alert');return;}
  editorState=null;byId('editor-dialog').close();
}
async function submitEditor(form,operation,message) {
  if(editorState?.busy)return;const current=editorState;current.busy=true;current.status.hidden=false;current.status.textContent='Сохраняем…';current.status.classList.remove('failed');
  const controls=[...form.querySelectorAll('input,textarea,select,button')];controls.forEach(x=>x.disabled=true);
  try {await operation();current.dirty=false;current.busy=false;closeEditor(true);announce(message);}
  catch(error){current.status.textContent=error.message;current.status.classList.add('failed');current.status.setAttribute('role','alert');current.busy=false;controls.forEach(x=>x.disabled=false);}
}
function editBiography(p) {
  const dossier=dossierFor(p),{form,status}=openEditor('История человека',p.name+' · текст сохранится в частном семейном деле');
  const biography=inputField(form,'О человеке','biography',dossier.biography,'textarea','Семейные воспоминания, характер и важные подробности.'),activity=inputField(form,'Жизнь и деятельность','activity',dossier.activity,'textarea','Можно писать по годам: учёба, работа, служба, переезды, увлечения.');
  biography.maxLength=100000;activity.maxLength=100000;editorActions(form,status);
  form.onsubmit=event=>{event.preventDefault();submitEditor(form,()=>apiPost(`/api/people/${encodeURIComponent(p.id)}/dossier`,{biography:biography.value,activity:activity.value}),'Описание человека сохранено.');};biography.focus();
}
function fileBase64(file) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Не удалось прочитать выбранный файл.'));reader.readAsDataURL(file);});}
function editMaterial(p,material=null) {
  const isNew=!material,{form,status}=openEditor(isNew?'Добавить в архив':'Описание материала',p.name+' · исходные файлы сохраняются без изменения');
  const title=inputField(form,'Название','title',material?.title);title.required=true;title.maxLength=300;
  let fileInput,urlInput,mode;
  if(isNew){mode=inputField(form,'Что добавить','material-mode','','select');for(const [value,label]of[['file','Файл с компьютера'],['link','Ссылку на запись']]){const o=node('option',label);o.value=value;mode.append(o);}fileInput=inputField(form,'Исходный файл','file','','file','До 20 МБ. Фото, скан, PDF, текст, аудио, видео и другие поддерживаемые документы.');urlInput=inputField(form,'Адрес страницы','url','','url','Содержимое сайта автоматически не копируется.');urlInput.parentElement.hidden=true;fileInput.required=true;mode.onchange=()=>{fileInput.parentElement.hidden=mode.value!=='file';urlInput.parentElement.hidden=mode.value!=='link';fileInput.required=mode.value==='file';urlInput.required=mode.value==='link';};fileInput.onchange=()=>{const file=fileInput.files[0];if(file&&!title.value)title.value=file.name;};}
  else if(material.url){urlInput=inputField(form,'Адрес страницы','url',material.url,'url');}
  const description=inputField(form,'Описание','description',material?.description,'textarea','Что изображено или записано, кто найден, что ещё нужно проверить.');description.maxLength=20000;
  const date=inputField(form,'Дата или период материала','date',material?.date,'text','Например: 1954, около 1960 года или неизвестно.');date.maxLength=100;
  const source=inputField(form,'Источник из дела','sourceId',material?.sourceId,'select');const none=node('option','Не выбран');none.value='';source.append(none);
  for(const s of session.sources || []){const option=node('option',s.title);option.value=s.id;source.append(option);}source.value=material?.sourceId || '';
  const sourceLabel=inputField(form,'Откуда получен материал','sourceLabel',material?.sourceLabel,'text','Архив, владелец фотографии, название сайта или семейный альбом.'),sourceUrl=inputField(form,'Ссылка на источник','sourceUrl',material?.sourceUrl,'url'),locator=inputField(form,'Архивный шифр, страница или подпись','locator',material?.locator),rights=inputField(form,'Права и условия использования','rights',material?.rights,'text','Например: семейный оригинал; разрешение владельца; только личное использование.');
  editorActions(form,status,isNew?'Сохранить в карточке':'Сохранить описание');
  if(!isNew){const detach=node('div',null,'detach-material');detach.append(node('p','Можно убрать материал из этой карточки. Исходный файл останется в семейном деле.'));
    detach.append(actionButton('Убрать из карточки',()=>submitEditor(form,async()=>{await apiPost(`/api/people/${encodeURIComponent(p.id)}/materials/${encodeURIComponent(material.id)}/remove`,{});byId('material-dialog').close();},'Материал убран из карточки. Исходный файл сохранён.'),'danger-soft'));form.append(detach);}
  form.onsubmit=event=>{event.preventDefault();submitEditor(form,async()=>{
    const payload={title:title.value,description:description.value,date:date.value,sourceId:source.value,sourceLabel:sourceLabel.value,sourceUrl:sourceUrl.value,locator:locator.value,rights:rights.value};
    if(isNew&&mode.value==='file'){const file=fileInput.files[0];if(!file)throw Error('Выберите файл.');if(file.size>fileLimit)throw Error('Файл больше 20 МБ. Выберите меньшую копию для просмотра; исходный документ можно сохранить отдельно в деле.');payload.file={name:file.name,data:await fileBase64(file)};}
    else if(urlInput)payload.url=urlInput.value;
    await apiPost(`/api/people/${encodeURIComponent(p.id)}/materials${isNew?'':'/'+encodeURIComponent(material.id)}`,payload);
    if(byId('material-dialog').open)byId('material-dialog').close();state.dossierTab='materials';materialFilter='all';showDetails();
  },isNew?'Материал сохранён в карточке.':'Описание материала сохранено.');};title.focus();
}
async function loadSession() {
  try {const response=await fetch('api/session',{cache:'no-store'});if(!response.ok)return;const result=await response.json();if(result.editable===true&&typeof result.token==='string'&&typeof result.caseVersion==='string'){session=result;updateModelHeading();if(state.selected)showDetails();}}
  catch { /* A standalone published viewer remains read-only. */ }
}

function renderRelations(p, body) {
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
function syncPersonSheet() {
  const details = byId('details');
  if (state.selected && compactViewport()) { details.setAttribute('role', 'dialog'); details.setAttribute('aria-modal', 'true'); }
  else { details.removeAttribute('role'); details.removeAttribute('aria-modal'); }
}
function choose(id) {
  if (state.selected !== id) { state.dossierTab = 'overview'; materialFilter = 'all'; }
  state.selected = id; byId('details').hidden = false; document.body.classList.add('person-open'); selection(); syncPersonSheet();
  if (compactViewport()) byId('close-details').focus({ preventScroll: true });
  const q = new URLSearchParams({ person: id }); history.replaceState(null, '', '#' + q);
}
function closeDetails() {
  const previous = state.selected;
  state.selected = null; byId('details').hidden = true; document.body.classList.remove('person-open'); selection(); syncPersonSheet();
  history.replaceState(null, '', location.pathname); if (previous && compactViewport()) cards.get(previous)?.focus({ preventScroll: true });
}
function search() {
  const query = folded(byId('search').value.trim()), results = byId('matches'); results.replaceChildren(); results.hidden = !query;
  if (!query) return;
  const found = model.persons.filter(p => folded([p.name, ...p.aliases].join(' ')).includes(query)).slice(0, 20);
  for (const p of found) { const button = node('button', p.name); button.onclick = () => { byId('search').value = ''; byId('search').blur(); results.hidden = true; choose(p.id); center(p.id); }; results.append(button); }
  if (!found.length) results.append(node('p', 'Пока не нашли. Попробуйте часть имени.'));
}
async function start() {
  const response = await fetch('tree.json'); if (!response.ok) throw Error('Не удалось загрузить подготовленные данные');
  model = await response.json(); people = new Map(model.persons.map(p => [p.id, p])); state.target = model.rootPerson;
  updateModelHeading(); fillTargets();
  drawFamily(); if (compactViewport()) center(model.rootPerson, 1); else fit();
  const supplied = new URLSearchParams(location.hash.slice(1)).get('person'); if (people.has(supplied)) { choose(supplied); center(supplied); }
  byId('search').addEventListener('input', search); byId('search').addEventListener('keydown', e => { if (e.key === 'Enter') byId('matches').querySelector('button')?.click(); if (e.key === 'Escape') byId('matches').hidden = true; });
  byId('mode').onchange = e => { state.mode = e.target.value; state.dossierTab = 'overview'; byId('target').hidden = state.mode !== 'path'; if (!state.selected) choose(model.rootPerson); else selection(); };
  byId('target').onchange = e => { state.target = e.target.value; state.dossierTab = 'overview'; selection(); };
  byId('fit').onclick = fit; byId('brand').onclick = e => { e.preventDefault(); fit(); };
  byId('zoom-in').onclick = () => scaleTo(state.zoom * 1.25); byId('zoom-out').onclick = () => scaleTo(state.zoom / 1.25); byId('zoom-level').onclick = () => scaleTo(1);
  byId('close-details').onclick = closeDetails; byId('about').onclick = () => byId('guide').showModal(); byId('close-guide').onclick = () => byId('guide').close();
  byId('close-evidence').onclick = () => byId('evidence-dialog').close();
  byId('close-material').onclick = () => byId('material-dialog').close();
  byId('close-editor').onclick = () => closeEditor();
  byId('editor-dialog').addEventListener('cancel', event => { if (editorState?.dirty || editorState?.busy) {event.preventDefault();closeEditor();} });
  byId('editor-dialog').addEventListener('close', () => {editorState = null; const focusTarget = byId('material-dialog').open ? byId('material-dialog').querySelector('.material-actions button') : byId(`tab-${state.dossierTab}`); focusTarget?.focus();});
  byId('material-dialog').addEventListener('close', () => {if(!byId('editor-dialog').open)byId(`tab-${state.dossierTab}`)?.focus();});
  window.addEventListener('beforeunload',event=>{if(editorState?.dirty){event.preventDefault();event.returnValue='';}});
  const garden = byId('garden');
  function capturePointer(id) { try { garden.setPointerCapture(id); } catch { /* A cancelled touch may already be released. */ } }
  function beginGesture(moved = false) {
    const points = [...pointers.values()];
    if (points.length >= 2) {
      const [a, b] = points, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      gesture = { kind: 'pinch', distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: state.zoom,
        worldX: (x - state.left) / state.zoom, worldY: (y - state.top) / state.zoom, moved: true };
      for (const id of pointers.keys()) capturePointer(id);
    } else if (points.length) {
      gesture = { kind: 'pan', x: points[0].x, y: points[0].y, left: state.left, top: state.top, moved };
    } else gesture = null;
  }
  garden.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.pointerType === 'mouse' && e.target.closest('button,[data-connection]'))) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); beginGesture(gesture?.moved || false);
    if (e.pointerType === 'mouse') capturePointer(e.pointerId);
  });
  garden.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === 'pinch') {
      const [a, b] = [...pointers.values()], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      state.zoom = Math.min(2.1, Math.max(.15, gesture.zoom * Math.hypot(b.x - a.x, b.y - a.y) / gesture.distance));
      state.left = x - gesture.worldX * state.zoom; state.top = y - gesture.worldY * state.zoom;
    } else {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
      gesture.moved = true; capturePointer(e.pointerId);
      state.left = gesture.left + dx; state.top = gesture.top + dy;
    }
    overview = false; garden.classList.add('dragging'); paintCamera();
  });
  const endGesture = e => {
    if (!pointers.has(e.pointerId)) return;
    const moved = gesture?.moved || false;
    if (moved) suppressTreeClickUntil = performance.now() + 450;
    pointers.delete(e.pointerId); beginGesture(moved);
    if (!pointers.size) garden.classList.remove('dragging');
  };
  garden.addEventListener('pointerup', endGesture); garden.addEventListener('pointercancel', endGesture);
  garden.addEventListener('lostpointercapture', e => {
    // Touch starts with implicit capture on a card or its child. Its capture-loss
    // event bubbles here when dragging transfers capture to the garden.
    if (e.target === garden && !garden.hasPointerCapture(e.pointerId)) endGesture(e);
  });
  garden.addEventListener('click', e => {
    if (e.detail && performance.now() < suppressTreeClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  garden.addEventListener('wheel', e => { e.preventDefault(); overview = false; if (e.ctrlKey || e.metaKey) scaleTo(state.zoom * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); else { state.left -= e.deltaX; state.top -= e.deltaY; paintCamera(); } }, { passive: false });
  byId('map-button').onclick = e => { overview = false; const r = byId('mini-map').getBoundingClientRect(), scale = Math.min(r.width / model.width, r.height / model.height); const x = (e.clientX - r.left - (r.width - model.width * scale) / 2) / scale, y = (e.clientY - r.top - (r.height - model.height * scale) / 2) / scale; state.left = innerWidth / 2 - x * state.zoom; state.top = innerHeight / 2 - y * state.zoom; paintCamera(); };
  window.addEventListener('resize', () => {
    syncPersonSheet();
    const rotated = (innerWidth > innerHeight) !== (previousViewport.width > previousViewport.height);
    if (overview) fit();
    else if (rotated && compactViewport()) center(state.selected || model.rootPerson, state.zoom);
    else { state.left += (innerWidth - previousViewport.width) / 2; state.top += (innerHeight - previousViewport.height) / 2; paintCamera(); }
    previousViewport = { width: innerWidth, height: innerHeight };
  });
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Tab' && state.selected && compactViewport()) {
      const controls = [...byId('details').querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
    }
    if (e.key === 'Escape') closeDetails();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (state.selected && compactViewport()) closeDetails(); byId('search').focus(); }
  });
  window.drevo = { getState: () => structuredClone({ ...state, personCount: model.persons.length, editable: session?.editable === true }), fit, center };
  void loadSession();
}
start().catch(error => { byId('error').hidden = false; byId('error').textContent = 'Не удалось открыть древо: ' + error.message; console.error(error); });
