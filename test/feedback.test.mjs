import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackConfig, feedbackPayload, feedbackAccepted, feedbackWebhookPayload, sendFeedback } from '../skills/family-tree-studio/assets/viewer/src/feedback.js';

const config = { enabled:true,ready:true,endpoint:'https://formsubmit.co/ajax/synthetic-token',recipientName:'владельцу дерева' };
const fields = {name:'Вымышленный родственник',email:'relative@example.invalid',message:'Это вымышленное воспоминание для проверки.',source:'Учебная запись'};
const context = {personName:'Вымышленный человек',treeTitle:'Учебное дерево',pageURL:'https://example.invalid/#person=fictional'};

test('disabled, unready and unsafe endpoints do not expose a working form',()=>{
  for(const value of [null,{}, {...config,enabled:false},{...config,ready:false},{...config,endpoint:'http://formsubmit.co/ajax/token'},{...config,endpoint:'https://formsubmit.co.evil.invalid/ajax/token'},{...config,endpoint:'https://user:pass@formsubmit.co/ajax/token'},{...config,endpoint:'https://formsubmit.co/ajax/token?to=other@example.invalid'}])assert.equal(feedbackConfig(value),null);
  assert.equal(feedbackConfig(config).endpoint,config.endpoint);
});

test('payload retains safe literal text and allows no recipient or carbon-copy override',()=>{
  const payload=feedbackPayload({...fields,message:'<img src=x onerror=alert(1)> — это текст, не HTML.',to:'wrong@example.invalid',_cc:'wrong@example.invalid'},context);
  assert.equal(payload.Воспоминание,'<img src=x onerror=alert(1)> — это текст, не HTML.');
  assert.equal(payload._replyto,fields.email);assert.equal(payload._url,context.pageURL);assert(!('_cc' in payload));assert(!('to' in payload));assert(!('_captcha' in payload));
});

test('optional email and source do not block memories; invalid or oversized values do',()=>{
  const payload=feedbackPayload({...fields,email:'',source:''},context);assert(!('_replyto' in payload));
  for(const changes of [{name:''},{name:'x'.repeat(101)},{email:'invalid'},{email:'null\0@example.invalid'},{email:'a@example.invalid\nBcc: b@example.invalid'},{message:'short'},{message:'x'.repeat(6001)},{source:'x'.repeat(501)},{honey:'bot'}])assert.throws(()=>feedbackPayload({...fields,...changes},context));
});

test('headers and page URL are bounded and do not admit control or script URLs',()=>{
  const payload=feedbackPayload(fields,{personName:'Имя\r\nX-Test: value',treeTitle:'Дерево\nSecond header',pageURL:'javascript:alert(1)'});
  assert(!/[\r\n]/.test(payload._subject));assert(!('_url' in payload));
  const sanitized=feedbackPayload(fields,{...context,pageURL:'https://example.invalid/family/?invite=private-preview#person=fictional&token=private-fragment'});
  assert.equal(sanitized._url,'https://example.invalid/family/#person=fictional');
  assert.equal(sanitized['Страница дерева'],sanitized._url);
  assert(!JSON.stringify(sanitized).includes('private-'));
  assert.equal(feedbackPayload(fields,{...context,pageURL:'https://example.invalid/#private-preview'})._url,'https://example.invalid/');
});

test('only explicit true acknowledgement is accepted',()=>{
  for(const response of [{success:false},{success:'false'},{success:1},{success:'yes'},null,{}, {success:true,activation_required:true}, {success:'true',requiresActivation:true}])assert.equal(feedbackAccepted(response),false);
  assert.equal(feedbackAccepted({success:true}),true);assert.equal(feedbackAccepted({success:'true'}),true);
});

test('send uses the fixed endpoint, origin-only cross-origin referrer, no credentials, and a strict acknowledgement',async()=>{
  let called=0;
  const result=await sendFeedback(config,fields,context,{fetchImpl:async(url,options)=>{called++;assert.equal(url,config.endpoint);assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'strict-origin-when-cross-origin');assert.equal(JSON.parse(options.body)._replyto,fields.email);return {ok:true,json:async()=>({success:'true'})};}});
  assert.equal(called,1);assert.deepEqual(result,{accepted:true});
  await assert.rejects(sendFeedback({...config,ready:false},fields,context,{fetchImpl:async()=>{called++;}}));assert.equal(called,1);
});

test('provider rejection, activation response, malformed JSON and network failures cannot report success',async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>({success:'false',message:'activate'})},{ok:true,json:async()=>({success:true,activation_required:true})},{ok:true,json:async()=>{throw Error('html');}}])await assert.rejects(sendFeedback(config,fields,context,{fetchImpl:async()=>response}));
  await assert.rejects(sendFeedback(config,fields,context,{fetchImpl:async()=>{throw new TypeError('offline');}}),/текст сохранён/i);
});

test('a timed-out request is aborted and no automatic retry creates duplicate emails',async()=>{
  let calls=0;
  await assert.rejects(sendFeedback(config,fields,context,{timeoutMs:5,fetchImpl:async(url,options)=>{calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}),/дважды/);
  assert.equal(calls,1);
});


test('custom receivers require explicit webhook mode and a clean HTTPS endpoint',()=>{
  const endpoint='https://receiver.example.invalid/family/inbox';
  assert.equal(feedbackConfig({...config,endpoint}),null);
  const webhook=feedbackConfig({...config,provider:'webhook',endpoint});
  assert.equal(webhook.provider,'webhook');assert.equal(webhook.endpoint,endpoint);
  for(const endpoint of ['http://receiver.example.invalid/inbox','javascript:alert(1)','https://user:password@receiver.example.invalid/inbox','https://receiver.example.invalid/inbox?secret=token','https://receiver.example.invalid/inbox#fragment'])assert.equal(feedbackConfig({...config,provider:'webhook',endpoint}),null);
  assert.equal(feedbackConfig({...config,provider:'unknown'}),null);
});

test('webhook payload is bounded and identifies a person without provider controls or URL tokens',()=>{
  const payload=feedbackWebhookPayload({...fields,_cc:'wrong@example.invalid',apiKey:'private'}, {...context,personId:'fictional',pageURL:'https://example.invalid/family/?invite=secret#person=fictional&token=secret'});
  assert.deepEqual(payload,{schemaVersion:1,sender:{name:fields.name,email:fields.email},person:{id:'fictional',name:context.personName},tree:{title:context.treeTitle,url:'https://example.invalid/family/#person=fictional'},message:fields.message,source:fields.source});
  assert.equal(feedbackWebhookPayload({...fields,email:'',source:''},{personId:'invalid id'}).person.id,'');
  assert.throws(()=>feedbackWebhookPayload({...fields,message:''},context));
});

test('webhook mode uses the same strict acknowledgement and sends only its documented JSON contract',async()=>{
  await sendFeedback({...config,provider:'webhook',endpoint:'https://receiver.example.invalid/inbox'},fields,{...context,personId:'fictional'},{fetchImpl:async(url,options)=>{
    assert.equal(url,'https://receiver.example.invalid/inbox');assert.equal(options.credentials,'omit');
    assert.equal(JSON.parse(options.body).person.id,'fictional');assert(!('_subject' in JSON.parse(options.body)));
    return {ok:true,json:async()=>({success:true})};
  }});
});
