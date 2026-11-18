import '../scripts/build.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localBindings } from '../scripts/local-bindings.mjs';
const { default: worker } = await import('../dist/server/index.js');

test('import, independent progress, live insertion, revisions and sign-in boundary', async () => {
  const env = localBindings();
  const record = {
    id:'e2-test-small', title:'English II writing test', prompt:'Write an email in about 100 words.',
    initial:'[unclear] sample', sentences:[{id:'s01',en:'Let me know what you think.',cn:'请告诉我你的看法。'}],
    draftImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kIJ8AAAAASUVORK5CYII=',
  };
  const send = (path, method = 'GET', body, user = 'a') => worker.fetch(new Request('https://archive.test/api' + path, {
    method, headers:{'Content-Type':'application/json', ...(user === null ? {} :
      {'oai-authenticated-user-email':env.OWNER_EMAIL, 'oai-authenticated-user-id':user})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  }),env);
  try {
    assert.equal((await send('/library','GET',undefined,null)).status,401);
    const imported = await send('/backup','POST',{records:[record],favorites:[record.id + '/s01']});
    assert.deepEqual(await imported.json(),{inserted:[record.id],skipped:[],progress:1});
    const initial = await (await send('/library')).json();
    assert.equal(initial.essays[0].type,'small');
    const imagePath = initial.essays[0].assets.draftImage.slice(4);
    assert.equal((await send(imagePath,'GET',undefined,null)).status,401);
    assert.equal(await (await send(imagePath)).arrayBuffer().then(a => Buffer.from(a).toString('base64')),record.draftImage.split(',')[1]);
    assert.equal(initial.progress[record.id+':s01'].favorite,true);
    await send('/progress','PATCH',{essayId:record.id,sentenceId:'s01',mastered:true});
    assert.deepEqual((await (await send('/library','GET',undefined,'b')).json()).progress,{});
    assert.equal((await send('/essays','POST',{record})).status,409);
    const [left,right] = await Promise.all([
      send('/essays/'+record.id,'PUT',{record:{...record,title:'Left'},version:1}),
      send('/essays/'+record.id,'PUT',{record:{...record,title:'Right'},version:1}),
    ]);
    assert.deepEqual([left.status,right.status].sort(),[200,409]);
    assert.equal((await send('/essays','POST',{record:{id:'e2-test-large',title:'Second essay',
      prompt:'Write in about 150 words.'}})).status,201);
    const final = await (await send('/library')).json();
    assert.equal(final.essays.length,2);
    assert.deepEqual(final.progress[record.id+':s01'],{favorite:true,mastered:true});
    const previous = await (await send('/essays/'+record.id+'/history?version=1')).json();
    assert.equal(previous.record.title,record.title);
    const backup = await (await send('/backup')).json();
    assert.equal(backup.records.find(x=>x.id===record.id).initial,record.initial);
    assert.equal(backup.records.find(x=>x.id===record.id).draftImage,record.draftImage);
  } finally {
    env.close();
  }
});
