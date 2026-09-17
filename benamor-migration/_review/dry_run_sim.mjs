// End-to-end simulation of benamor-migration/import_to_supabase.sql on PGlite.
// Builds schema from supabase/migrations 0001..0056 (via local-shim), loads the
// "current" production customers file, then executes the import script with
// DRY_RUN=1 semantics (rollback) — plus optional commit+re-run idempotency test.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/benamor-project-current';
const MIG = path.join(ROOT, 'benamor-migration');
const SCRIPT_NAME = process.env.SCRIPT || 'import_to_supabase.sql';
const SCRIPT = fs.readFileSync(path.join(MIG, SCRIPT_NAME), 'utf8');
console.log(`[script] ${SCRIPT_NAME}`);

// ---------- tiny RFC4180 CSV parser (no embedded newlines in this dataset) ----------
function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ---------- split SQL into statements (handles $$...$$, quotes, -- comments) ----------
function splitSql(sql) {
  const stmts = []; let cur = '', i = 0, n = sql.length;
  let inS = false, inD = false, inLine = false, inBlock = false;
  while (i < n) {
    const c = sql[i], nx = sql[i+1];
    if (inLine) { cur += c; if (c === '\n') inLine = false; i++; continue; }
    if (inBlock) { cur += c; if (c === '*' && nx === '/') { cur += '/'; i += 2; inBlock = false; } else i++; continue; }
    if (inD) { cur += c; if (c === '$' && nx === '$') { cur += '$'; i += 2; inD = false; } else i++; continue; }
    if (inS) { cur += c; if (c === "'" && nx === "'") { cur += "'"; i += 2; } else { if (c === "'") inS = false; i++; } continue; }
    if (c === '-' && nx === '-') { inLine = true; cur += c; i++; continue; }
    if (c === '/' && nx === '*') { inBlock = true; cur += c; i++; continue; }
    if (c === '$' && nx === '$') { inD = true; cur += '$$'; i += 2; continue; }
    if (c === "'") { inS = true; cur += c; i++; continue; }
    if (c === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

// ---------- tokenize the psql script into ops ----------
function tokenize(script) {
  const ops = []; let sqlBuf = [];
  const flush = () => { if (sqlBuf.length) { ops.push({ t: 'sql', text: sqlBuf.join('\n') }); sqlBuf = []; } };
  for (const line of script.split('\n')) {
    const tr = line.trim();
    if (tr.startsWith('\\')) {
      flush();
      let m;
      if ((m = tr.match(/^\\copy\s+\w+\.(\w+)\s+from\s+'([^']+)'/))) ops.push({ t: 'copy', table: m[1], file: m[2] });
      else if ((m = tr.match(/^\\echo\s+'(.*)'$/))) ops.push({ t: 'echo', text: m[1] });
      else if (tr.match(/^\\if\s+:\{\?/)) ops.push({ t: 'if_maybe' });
      else if (tr.match(/^\\if\s+:DRY_RUN/)) ops.push({ t: 'if_dry' });
      else if (tr.match(/^\\else/)) ops.push({ t: 'else' });
      else if (tr.match(/^\\endif/)) ops.push({ t: 'endif' });
      // \set / \timing ignored
    } else sqlBuf.push(line);
  }
  flush();
  return ops;
}

async function insertCsv(db, table, file) {
  const rows = parseCsv(fs.readFileSync(path.join(MIG, file), 'utf8'));
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const CH = 200; const colList = cols.map(c => `"${c}"`).join(',');
  for (let s = 0; s < rows.length; s += CH) {
    const chunk = rows.slice(s, s + CH);
    const ph = [], vals = [];
    chunk.forEach((r, ri) => {
      const row = [];
      cols.forEach((c, ci) => { row.push(`$${ri * cols.length + ci + 1}`); vals.push(r[c] === '' ? null : r[c]); });
      ph.push(`(${row.join(',')})`);
    });
    await db.query(`insert into mig_stage."${table}" (${colList}) values ${ph.join(',')}`, vals);
  }
  return rows.length;
}

const t0 = Date.now();
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/local-shim.sql'), 'utf8'));
const migFiles = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const f of migFiles) await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'));
console.log(`[setup] schema 0001..0056 applied (${migFiles.length} migrations) in ${Date.now()-t0}ms`);

// current production customers (README step 1)
await db.exec(fs.readFileSync(path.join(ROOT, 'new discussion github/sql/pos-customers-import.sql'), 'utf8'));
const liveC = await db.query('select count(*)::int c from public.pos_customers');
console.log(`[setup] current customers loaded: ${liveC.rows[0].c}`);

const ops = tokenize(SCRIPT);
let dry = null; let ifStack = [];
let insertedLog = [];

async function runOnce(doCommit) {
  dry = null; ifStack = [];
  await db.exec('begin');
  for (const op of ops) {
    if (op.t === 'sql') {
      if (dry !== null) continue; // skip rollback/commit inside \if..\endif — simulated at \endif
      for (const st of splitSql(op.text)) {
        const label = st.replace(/\s+/g, ' ').slice(0, 90);
        try {
          const r = await db.query(st);
          if (r.rows?.length && dry === null && /^select/i.test(st)) console.log('  →', JSON.stringify(r.rows).slice(0, 3000));
        } catch (e) {
          console.error(`\n*** STATEMENT FAILED ***\n---BEGIN STMT---\n${st}\n---END STMT---\n${e.message} (position: ${e.position})`);
          throw e;
        }
        // instrumentation at key points
        if (/create table mig_stage\.customer_map/i.test(st)) {
          const f = await db.query('select count(*)::int n from (select mig_id from mig_stage.customer_map group by mig_id having count(*)>1) d');
          console.log(`  [instr] customer_map fan-out rows (mig_id duplicated): ${f.rows[0].n}  (must be 0)`);
        }
        if (/create table mig_stage\.supplier_map/i.test(st)) {
          const f = await db.query('select count(*)::int n from (select mig_id from mig_stage.supplier_map group by mig_id having count(*)>1) d');
          console.log(`  [instr] supplier_map fan-out rows: ${f.rows[0].n}  (must be 0)`);
        }
        if (/create table mig_stage\.customer_new/i.test(st)) {
          const r = await db.query(`select count(*)::int new_total, count(*) filter (where customer_no_final <> customer_no)::int suffixed from mig_stage.customer_new`);
          console.log(`  [instr] customer_new: ${r.rows[0].new_total} genuinely new (README says 171), ${r.rows[0].suffixed} suffixed (README says 41)`);
        }
        if (/create table mig_stage\.cust_opening/i.test(st)) {
          const r = await db.query(`select count(*)::int n, round(sum(bal),3) tot from mig_stage.cust_opening`);
          console.log(`  [instr] opening balances: ${r.rows[0].n} customers, total ${r.rows[0].tot} (expect 30 / 41990.479)`);
        }
        if (/^delete from mig_stage\.sales/i.test(st.trim())) {
          for (const t of ['sales','sale_items','sale_payments','customer_ledger']) {
            const r = await db.query(`select count(*)::int n from mig_stage.${t}`);
            console.log(`  [instr] staged after cut: ${t} = ${r.rows[0].n}`);
          }
        }
        if (/create table mig_stage\.stock_applied/i.test(st)) {
          const r = await db.query(`select (select count(*)::int from mig_stage.stock) st, (select count(*)::int from mig_stage.stock_applied) ap`);
          console.log(`  [instr] stock staged=${r.rows[0].st}, to insert=${r.rows[0].ap}, skipped=${r.rows[0].st - r.rows[0].ap}`);
        }
      }
    } else if (op.t === 'copy') {
      const n = await insertCsv(db, op.table, op.file);
      console.log(`  [copy] mig_stage.${op.table} ← ${op.file} (${n} rows)`);
    } else if (op.t === 'echo') {
      console.log(`\n=== ${op.text}`);
    } else if (op.t === 'if_maybe') { ifStack.push('maybe'); }
    else if (op.t === 'if_dry') { ifStack.push('dry'); dry = true; }
    else if (op.t === 'else') { if (ifStack[ifStack.length-1] === 'dry') dry = false; }
    else if (op.t === 'endif') {
      const top = ifStack.pop();
      if (top === 'dry') {
        if (doCommit) { await db.exec('commit'); console.log('*** COMMITTED (simulation of DRY_RUN=0) ***'); }
        else { await db.exec('rollback'); console.log('*** ROLLED BACK (simulation of DRY_RUN=1) ***'); }
      }
    }
  }
}  // end runOnce (no catch here)

const countsSql = `select 'pos_sales' t, count(*)::int n from public.pos_sales
  union all select 'pos_sale_items', count(*)::int from public.pos_sale_items
  union all select 'pos_sale_payments', count(*)::int from public.pos_sale_payments
  union all select 'pos_customers', count(*)::int from public.pos_customers
  union all select 'pos_customer_ledger', count(*)::int from public.pos_customer_ledger
  union all select 'pos_products', count(*)::int from public.pos_products
  union all select 'pos_suppliers', count(*)::int from public.pos_suppliers
  union all select 'pos_supplier_ledger', count(*)::int from public.pos_supplier_ledger
  union all select 'pos_purchases', count(*)::int from public.pos_purchases
  union all select 'pos_purchase_items', count(*)::int from public.pos_purchase_items
  union all select 'pos_stock', count(*)::int from public.pos_stock
  union all select 'pos_stock_movements', count(*)::int from public.pos_stock_movements
  union all select 'pos_expenses', count(*)::int from public.pos_expenses
  union all select 'pos_finance_accounts', count(*)::int from public.pos_finance_accounts
  union all select 'pos_proformas', count(*)::int from public.pos_proformas
  union all select 'pos_proforma_items', count(*)::int from public.pos_proforma_items
  union all select 'pos_stock_transfers', count(*)::int from public.pos_stock_transfers
  union all select 'pos_stock_transfer_items', count(*)::int from public.pos_stock_transfer_items`;

if (process.env.COMMIT === '1') {
  console.log('\n######## PASS 1 (commit) ########');
  await runOnce(true);
  const c1 = (await db.query(countsSql)).rows;
  console.log('\n=== counts after pass 1 ==='); console.table(c1);
  console.log('\n######## PASS 2 (re-run — must insert nothing new) ########');
  await runOnce(true);
  const c2 = (await db.query(countsSql)).rows;
  console.log('\n=== counts after pass 2 ==='); console.table(c2);
  const drift = c1.map((r, i) => ({ t: r.t, delta: c2[i].n - r.n })).filter(r => r.delta !== 0);
  console.log('\n=== idempotency drift (must be empty) ===');
  console.log(drift.length ? drift : '  zero drift — re-run is fully idempotent ✅');
} else {
  await runOnce(false);
}
if (process.env.BALDUMP) {
  const rows = (await db.query(`select c.customer_no, round(sum(l.debit-l.credit),3) bal from public.pos_customer_ledger l join public.pos_customers c on c.id=l.customer_id group by 1`)).rows;
  fs.writeFileSync(process.env.BALDUMP, JSON.stringify(Object.fromEntries(rows.map(r=>[r.customer_no,Number(r.bal)])),null,0));
  console.log(`[baldump] ${rows.length} customers -> ${process.env.BALDUMP}`);
  const tr = (await db.query(`select round(sum(total-balance_due),0) paid, round(sum(balance_due),3) due from public.pos_sales`)).rows[0];
  console.log(`[sales totals] due=${tr.due}`);
}
console.log(`[done] total ${Date.now()-t0}ms`);
