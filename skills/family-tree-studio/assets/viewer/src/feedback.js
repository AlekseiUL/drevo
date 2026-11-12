// Optional, read-only contribution form. A published site supplies its own config.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = value => typeof value === 'string' ? value.trim() : '';

export function feedbackConfig(value) {
  if (!value || value.enabled !== true || value.ready !== true) return null;
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { return null; }
  const provider = value.provider ?? 'formsubmit';
  if (!['formsubmit', 'webhook'].includes(provider) || endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  if (provider === 'formsubmit' && (endpoint.hostname !== 'formsubmit.co' || !/^\/ajax\/[a-zA-Z0-9@._+%\-]{4,300}$/.test(endpoint.pathname))) return null;
  return { enabled: true, ready: true, provider, endpoint: endpoint.href, recipientName: clean(value.recipientName).slice(0,100) || 'владельцу дерева' };
}

export function feedbackPayload(fields, context = {}) {
  const name = clean(fields.name), email = clean(fields.email), message = clean(fields.message), source = clean(fields.source);
  if (!name || name.length > 100) throw Error('Укажите ваше имя — до 100 символов.');
  if (email && (email.length > 254 || /[\u0000-\u001f\u007f]/.test(email) || !EMAIL.test(email))) throw Error('Проверьте адрес электронной почты или оставьте это поле пустым.');
  if (message.length < 10 || message.length > 6000) throw Error('Напишите воспоминание: от 10 до 6000 символов.');
  if (source.length > 500) throw Error('Описание источника должно быть не длиннее 500 символов.');
  if (clean(fields.honey)) throw Error('Не удалось отправить сообщение. Обновите страницу и попробуйте ещё раз.');
  const person = clean(context.personName).slice(0,220) || 'О семье в целом';
  const title = clean(context.treeTitle).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,120) || 'Семейное древо';
  let pageURL = '';
  try {
    const url = new URL(context.pageURL);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      url.search = '';
      const personId = new URLSearchParams(url.hash.slice(1)).get('person');
      url.hash = personId && /^[a-zA-Z0-9_-]{1,80}$/.test(personId) ? new URLSearchParams({ person: personId }).toString() : '';
      pageURL = url.href;
    }
  } catch { /* A URL is optional evidence context. */ }
  const payload = {
    Имя: name,
    'О ком': person,
    Воспоминание: message,
    'Откуда известно': source || 'Не указано',
    'Страница дерева': pageURL || 'Не указана',
    _subject: `Дополнение к дереву: ${title} — ${person.replace(/[\u0000-\u001f\u007f]/g, ' ')}`,
    _template: 'table',
    _honey: '',
  };
  if (email) { payload['Обратная связь'] = email; payload._replyto = email; }
  if (pageURL) payload._url = pageURL;
  return payload;
}

// Keep a small provider-neutral contract for a site owner's server. Secrets stay there.
export function feedbackWebhookPayload(fields, context = {}) {
  const validated = feedbackPayload(fields, context);
  return {
    schemaVersion: 1,
    sender: { name: validated.Имя, email: validated._replyto || '' },
    person: { id: /^[a-zA-Z0-9_-]{1,80}$/.test(context.personId || '') ? context.personId : '', name: validated['О ком'] },
    tree: { title: clean(context.treeTitle).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,120) || 'Семейное древо', url: validated._url || '' },
    message: validated.Воспоминание,
    source: clean(fields.source),
  };
}

export function feedbackAccepted(result) {
  return !!result && (result.success === true || result.success === 'true') && !result.activation_required && !result.requiresActivation;
}

export async function sendFeedback(config, fields, context, options = {}) {
  const ready = feedbackConfig(config);
  if (!ready) throw Error('Форма сейчас недоступна. Попробуйте позже.');
  const payload = ready.provider === 'webhook' ? feedbackWebhookPayload(fields, context) : feedbackPayload(fields, context);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const response = await (options.fetchImpl || fetch)(ready.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin',
    });
    if (!response.ok) throw Error('Сервис пока не принял сообщение. Текст сохранён — попробуйте отправить ещё раз.');
    let result;
    try { result = await response.json(); } catch { throw Error('Не получено подтверждение отправки. Текст сохранён — попробуйте ещё раз.'); }
    if (!feedbackAccepted(result)) throw Error('Сервис не подтвердил приём сообщения. Текст сохранён — попробуйте позже.');
    return { accepted: true };
  } catch (error) {
    if (controller.signal.aborted) throw Error('Ответ сервиса не пришёл вовремя. Текст сохранён; перед повторной отправкой можно подождать, чтобы не отправить его дважды.');
    if (error instanceof TypeError) throw Error('Не удалось связаться с сервисом. Проверьте интернет и попробуйте снова — текст сохранён.');
    throw error;
  } finally { clearTimeout(timer); }
}

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

async function installFeedback() {
  let config, tree;
  try {
    const response = await fetch('feedback-config.json', { credentials: 'same-origin' });
    if (!response.ok) return;
    config = feedbackConfig(await response.json());
    if (!config) return;
    const data = await fetch('tree.json', { credentials: 'same-origin' });
    if (!data.ok) return;
    tree = await data.json();
    if (!Array.isArray(tree.persons)) return;
  } catch { return; }
  const heading = document.querySelector('.heading');
  if (!heading || document.getElementById('add-information')) return;
  const people = new Map(tree.persons.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => [p.id, p.name]));
  const dialog = element('dialog', null, 'feedback-dialog'); dialog.id = 'feedback-dialog'; dialog.setAttribute('aria-labelledby', 'feedback-title');
  const header = element('div', null, 'feedback-header');
  const close = element('button', '×', 'feedback-close'); close.id = 'close-feedback'; close.type = 'button'; close.setAttribute('aria-label','Закрыть форму добавления информации');
  const title = element('h2','Добавить информацию'); title.id = 'feedback-title';
  const intro = element('p', `Расскажите, что вы помните. Сообщение будет отправлено ${config.recipientName}, чтобы проверить сведения и дополнить дерево.`);
  intro.id = 'feedback-intro'; dialog.setAttribute('aria-describedby', 'feedback-intro'); header.append(close, title, intro); dialog.append(header);
  const form = element('form', null, 'feedback-form'); form.id = 'feedback-form';
  const inputs = {};
  const field = (key, label, tag = 'input', attributes = {}) => {
    const wrap = element('div', null, 'feedback-field'), caption = element('label', label), input = element(tag);
    input.id = `feedback-${key}`; input.name = key; caption.htmlFor = input.id;
    for (const [name,value] of Object.entries(attributes)) input.setAttribute(name,String(value));
    wrap.append(caption,input); form.append(wrap); inputs[key] = input; return wrap;
  };
  field('name','Ваше имя','input',{ type:'text',required:'',maxlength:100,autocomplete:'name' });
  field('email','Ваша почта — если можно задать уточняющий вопрос','input',{ type:'email',maxlength:254,autocomplete:'email',inputmode:'email' });
  field('person','О ком хотите рассказать?','select');
  const general = element('option','О семье в целом'); general.value = ''; inputs.person.append(general);
  for (const [id,name] of [...people].sort((a,b) => a[1].localeCompare(b[1],'ru'))) { const option = element('option',name); option.value=id; inputs.person.append(option); }
  field('message','Что вы вспомнили?','textarea',{ required:'',minlength:10,maxlength:6000,rows:7,placeholder:'Например: где человек жил, кем работал, семейная история или уточнение даты…' });
  field('source','Откуда это известно? — необязательно','input',{ type:'text',maxlength:500,placeholder:'Личное воспоминание, рассказ родственника, документ или ссылка' });
  const honey = element('div', null, 'feedback-honey'); honey.setAttribute('aria-hidden','true');
  const honeyInput = element('input'); honeyInput.name='website';honeyInput.type='text';honeyInput.tabIndex=-1;honeyInput.autocomplete='off';honeyInput.setAttribute('aria-label','Оставьте поле пустым');honey.append(honeyInput);form.append(honey);
  const status = element('p', null, 'feedback-status'); status.id='feedback-status';status.hidden=true;status.tabIndex=-1;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const actions = element('div',null,'feedback-actions');
  const submit = element('button','Отправить','feedback-submit');submit.type='submit';
  const cancel = element('button','Закрыть','feedback-cancel');cancel.type='button';actions.append(submit,cancel);
  const privacy = element('p', null, 'feedback-privacy');
  privacy.append(document.createTextNode('Воспоминание не появится в дереве автоматически. Отправка через '));
  if (config.provider === 'formsubmit') {
    const provider = element('a','FormSubmit');provider.href='https://formsubmit.co/';provider.target='_blank';provider.rel='noopener noreferrer';privacy.append(provider,document.createTextNode('.'));
  } else privacy.append(document.createTextNode(`обработчик владельца (${new URL(config.endpoint).hostname}).`));
  privacy.append(document.createTextNode(' Черновик остаётся в этой вкладке до перезагрузки страницы.'));
  form.append(status,actions,privacy);dialog.append(form);document.body.append(dialog);
  let busy=false,opener=null;
  window.addEventListener('beforeunload',event => {
    if (busy || inputs.message.value.trim()) { event.preventDefault(); event.returnValue=''; }
  });
  const open = button => {
    opener=button;
    if (!inputs.message.value.trim()) {
      const selected = new URLSearchParams(location.hash.slice(1)).get('person');
      inputs.person.value = people.has(selected) ? selected : '';
      status.hidden=true;status.classList.remove('failed','success');
    }
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop=0;
    (inputs.name.value.trim() ? inputs.message : inputs.name).focus();
  };
  const closeForm = () => { if (!busy) dialog.close(); };
  close.addEventListener('click',closeForm);cancel.addEventListener('click',closeForm);
  dialog.addEventListener('cancel',event => { if(busy)event.preventDefault(); });
  dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();});
  const globalButton = element('button','Добавить информацию','feedback-open');globalButton.id='add-information';globalButton.type='button';globalButton.addEventListener('click',()=>open(globalButton));heading.append(globalButton);
  const addPersonButton = () => {
    const panel=document.getElementById('dossier-panel');
    if (!panel || panel.getAttribute('aria-labelledby')!=='tab-overview' || panel.querySelector('.feedback-person-open')) return;
    const button=element('button','Добавить информацию об этом человеке','feedback-open feedback-person-open');button.type='button';button.addEventListener('click',()=>open(button));panel.prepend(button);
  };
  const details=document.getElementById('detail-body');
  if(details){new MutationObserver(addPersonButton).observe(details,{childList:true,subtree:true});addPersonButton();}
  window.addEventListener('hashchange',addPersonButton);
  form.addEventListener('submit',async event => {
    event.preventDefault(); if(busy || !form.reportValidity()) return;
    const fields={name:inputs.name.value,email:inputs.email.value,message:inputs.message.value,source:inputs.source.value,honey:honeyInput.value};
    const page = new URL(location.href);page.hash=inputs.person.value ? new URLSearchParams({person:inputs.person.value}).toString() : '';
    const context={personId:inputs.person.value,personName:people.get(inputs.person.value),treeTitle:tree.title,pageURL:page.href};
    try { feedbackPayload(fields,context); } catch(error) {status.hidden=false;status.className='feedback-status failed';status.textContent=error.message;status.focus();return;}
    busy=true;form.setAttribute('aria-busy','true');submit.disabled=true;submit.textContent='Отправляем…';close.disabled=true;cancel.disabled=true;
    for(const input of Object.values(inputs))input.disabled=true;
    status.hidden=false;status.className='feedback-status';status.textContent='Отправляем ваше воспоминание…';
    try {
      await sendFeedback(config,fields,context);
      status.className='feedback-status success';status.textContent=`Сервис принял сообщение для отправки ${config.recipientName}. Спасибо!`;
      inputs.message.value='';inputs.source.value='';honeyInput.value='';
    } catch(error) {status.className='feedback-status failed';status.textContent=error.message;}
    finally {busy=false;form.removeAttribute('aria-busy');submit.disabled=false;submit.textContent='Отправить';close.disabled=false;cancel.disabled=false;for(const input of Object.values(inputs))input.disabled=false;}
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',installFeedback,{once:true});
  else void installFeedback();
}
