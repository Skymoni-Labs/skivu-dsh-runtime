import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';
const base=process.env.SKIVU_ADAPTER_PATH;
if(!base)throw new Error('Set SKIVU_ADAPTER_PATH to a built adapter directory');
const {SkivuModelAdapter,provider,model}=await import(pathToFileURL(base+'/index.mjs'));
const {ModelClient}=await import(pathToFileURL(base+'/client.mjs'));
test('legacy hosts retain the fixed model without unsupported broker calls',async()=>{
  const adapter=new SkivuModelAdapter({models(){throw new Error('unexpected catalog call');}});
  assert.equal((await adapter.listModels(provider)).length,1);
  assert.equal((await adapter.resolveModel(provider,model)).id,model);
});
test('host models and custom connections share one concurrent catalog request',async()=>{
  let calls=0;
  const adapter=new SkivuModelAdapter({async models(){calls++;return [
    {id:'account:a',name:'A',provider:'Skymoni',supportsTools:true},
    {id:'custom:b',name:'B',provider:'Custom',supportsTools:true},
    {id:'account:c',name:'C',provider:'Skymoni',supportsTools:false},
  ];}},true);
  const [rows,selected]=await Promise.all([adapter.listModels(provider),adapter.resolveModel(provider,'custom:b')]);
  assert.equal(calls,1);assert.equal(rows.length,4);assert.equal(selected.id,'custom:b');
  assert.match(rows[3].name,/暂不支持/);
  await assert.rejects(adapter.resolveModel(provider,'https://untrusted.example'));
});
test('selected model is passed as an opaque ID without endpoint or credentials',async()=>{
  let params;
  const adapter=new SkivuModelAdapter({async models(){return [{id:'account:a',name:'A',provider:'Skymoni',supportsTools:true}];},
    async generate(value){params=value;return {choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}]};}},true);
  const events=[];
  for await(const event of adapter.stream({provider,model:'account:a',messages:[{role:'user',content:[{type:'text',text:'hi'}]}],tools:[]}))events.push(event);
  assert.equal(params.model,'account:a');assert.deepEqual(Object.keys(params).sort(),['messages','model','tools']);
  assert.ok(events.some(e=>e.type==='text-delta'&&e.text==='ok'));
});
test('framed transport supports list and selection while rejecting injected fields',async()=>{
  const requests=[];
  const stream=new Duplex({read(){},write(chunk,encoding,done){
    const request=JSON.parse(String(chunk));requests.push(request);
    queueMicrotask(()=>this.push(JSON.stringify({id:request.id,ok:true,result:request.method==='model.list'?[]:{choices:[]}})+'\n'));
    done();
  }});
  const client=new ModelClient(stream);
  assert.deepEqual(await client.models(),[]);
  await client.generate({messages:[],tools:[],model:'custom:b'});
  assert.equal(requests[0].method,'model.list');assert.equal(requests[1].params.model,'custom:b');
  await assert.rejects(client.generate({messages:[],tools:[],endpoint:'https://untrusted.example'}));
  assert.equal(requests.length,2);client.close();
});
