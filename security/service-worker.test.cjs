const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

function worker(windows=[]) {
  const handlers={},notifications=[],opened=[],messages=[];
  const context={URL, self:{location:{origin:'https://app.example.test'},
    addEventListener:(name,handler)=>handlers[name]=handler,
    registration:{showNotification:async(title,options)=>notifications.push({title,options})}},
    clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(readFileSync(require.resolve('../sw.js'),'utf8'),context);
  const dispatch=async(name,data={})=>{
    let pending;handlers[name]({...data,waitUntil:promise=>pending=promise});await pending;
  };
  return {notifications,opened,messages,dispatch};
}

test('pushmeldingen openen de app en behouden oude deep-links zonder externe navigatie',async()=>{
  for(const [source,expected] of [[undefined,'/app/'],['/?goto=nieuws','/app/?goto=nieuws'],
    ['/boekingen.html?goto=meldingen','/app/?goto=meldingen'],['/app/?goto=nieuws','/app/?goto=nieuws'],
    ['https://extern.example/','/app/']]){
    const w=worker();
    await w.dispatch('push',{data:{json:()=>({url:source})}});
    const url=w.notifications[0].options.data.url;
    assert.equal(url,'https://app.example.test'+expected);
    await w.dispatch('notificationclick',{notification:{data:{url},close(){}}});
    assert.equal(w.opened[0],url);
  }
});

test('een open introductie vervangt geen apptab bij het openen van een melding',async()=>{
  let focus=0,message;
  const w=worker([{url:'https://app.example.test/',focus:async()=>{throw new Error('Intro mag niet worden gekozen')}},
    {url:'https://app.example.test/app/',focus:async()=>focus++,postMessage:data=>message=data}]);
  await w.dispatch('notificationclick',{notification:{data:{url:'/?goto=nieuws'},close(){}}});
  assert.equal(focus,1);assert.equal(w.opened.length,0);
  assert.equal(message.url,'https://app.example.test/app/?goto=nieuws');
  assert.equal(message.type,'NAVIGATE');
  const onlyIntro=worker([{url:'https://app.example.test/',focus:async()=>{throw new Error('Geen app')}}]);
  await onlyIntro.dispatch('notificationclick',{notification:{data:{url:'/'},close(){}}});
  assert.equal(onlyIntro.opened[0],'https://app.example.test/app/');
});
