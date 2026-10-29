// Run inside an installed runtime. Real file and subprocess operations only.
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rename,mkdir,rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { publishExclusive } from '/opt/dsh/node_modules/skivu-runtime-fs/index.mjs';
const dir=await mkdtemp('/workspace/.runtime-check-');
try {
 await mkdir(dir+'/folder');
 await writeFile(dir+'/source','kept');
 await rename(dir+'/source',dir+'/renamed');
 assert.equal(await readFile(dir+'/renamed','utf8'),'kept');
 await publishExclusive(dir+'/renamed',dir+'/target');
 assert.equal(await readFile(dir+'/renamed','utf8'),'kept');
 assert.equal(await readFile(dir+'/target','utf8'),'kept');
 await assert.rejects(publishExclusive(dir+'/renamed',dir+'/target'),e=>e.code==='EEXIST');
 assert.equal(await readFile(dir+'/target','utf8'),'kept');
 let denied=false;
 try { execFileSync('/usr/bin/unshare',['-Ur','/bin/true'],{stdio:'pipe'}); }
 catch(e) { denied=e.status!==0 && /not permitted|Permission denied/i.test(String(e.stderr)); }
 assert(denied,'namespace creation must fail honestly');
 const report=process.report.getReport();
 assert(report.header,'native diagnostic report must not crash on Android network restrictions');
 const output=execFileSync('/bin/bash',['-lc','printf NATIVE_SHELL_OK'],{encoding:'utf8'});
 assert.equal(output,'NATIVE_SHELL_OK');
 console.log(JSON.stringify({rename:true,exclusivePublish:true,sourcePreserved:true,overwriteRefused:true,namespaceDenied:true,nativeDiagnostic:true,shell:true}));
} finally { await rm(dir,{recursive:true,force:true}); }
