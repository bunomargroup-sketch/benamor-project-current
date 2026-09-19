// psql-faithful statement assembly + immediate execution on PGlite (empty tables OK).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const sql = fs.readFileSync('/home/user/benamor-project-current/benamor-migration/import_v3_corrected.sql','utf8').split('\n');
const db = new PGlite();
async function chunk(sqlText){ // mimic dry_run_sim's schema approach is unnecessary; just exec
  return db.exec(sqlText);
}
let buf=[]; let stmts=[];
let inDQ=false, dqTag=null;
for(let ln=0; ln<sql.length; ln++){
  let line=sql[ln];
  if(/^\s*--/.test(line)) continue;
  // backslash meta (psql executes even mid-buffer, doesn't add to buffer)
  if(/^\s*\\/.test(line)){ if(/^\s*\\(copy)/.test(line)) continue; continue; }
  // scan chars for ; outside single quotes & dollar quotes
  let out='', i=0, n=line.length;
  while(i<n){
    let rest=line.slice(i);
    if(!inDQ && rest.startsWith('--')) break;
    let ch=line[i];
    if(inDQ){
      if(rest.startsWith(dqTag)){ inDQ=false; out+=dqTag; i+=dqTag.length; continue; }
      out+=ch; i++; continue;
    }
    if(ch==="'"){ // single quote - find end (respect '')
      let j=i+1; out+=ch;
      while(j<n){ if(line[j]==="'"&&line[j+1]==="'"){ out+="''"; j+=2; continue;} out+=line[j]; if(line[j]==="'"){ j++; break;} j++; }
      i=j; continue;
    }
    let m=rest.match(/^\$([a-zA-Z_]*)\$/);
    if(m){ inDQ=true; dqTag=m[0]; out+=m[0]; i+=m[0].length; continue; }
    out+=ch;
    if(ch===';'){ stmts.push({text:buf.join('\n')+'\n'+out, line:ln+1}); buf=[]; out=''; }
    i++;
  }
  if(out.trim()) buf.push(out);
}
if(buf.join('').trim()) { console.log('FATAL: unterminated statement at EOF'); process.exit(1); }
console.log('statements:', stmts.length);
let fails=0;
for(const s of stmts){
  const t=s.text.trim(); if(!t || t===';' ) continue;
  if(/^\\/.test(t)) continue;
  try { await db.exec(t); }
  catch(e){
    const msg=String(e.message||e).slice(0,110);
    if(/syntax/i.test(msg)){ console.log('SYNTAX FAIL @ line',s.line,'::',t.slice(0,70).replace(/\n/g,' '),'ERR:',msg); fails++; }
    else { console.log('exec(after-parse) @ line',s.line,'::',msg); }
  }
}
console.log('syntax fails:', fails);
process.exit(fails?1:0);
