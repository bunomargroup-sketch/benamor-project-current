/* ═══════════════════════════════════════════════════════════════════
   اختبار نقل حقل الباركود فوق قائمة الأصناف (المهمة ٣)
   النقل في DOM فقط: المعرف والمعالجات والاختصارات كما هي
   ═══════════════════════════════════════════════════════════════════ */
const test=require('node:test'), assert=require('node:assert');
const fs=require('fs'), path=require('path');
const HERE=path.join(__dirname,'..');
const IDX=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system','index.html');
const APP=path.join(HERE,'new discussion github','apps','pos','benamor-sales-system','app.js');
const html=fs.readFileSync(IDX,'utf8');
const app=fs.readFileSync(APP,'utf8');

test('حقل الباركود داخل pos-items-card فوق شريط «الأصناف» مباشرة', ()=>{
  const itemsCard=html.indexOf('pos-items-card');
  const barcode=html.indexOf('id="saleBarcodeInput"');
  const itemsTools=html.indexOf('>الأصناف</h2>');
  assert.ok(itemsCard>-1&&barcode>-1&&itemsTools>-1);
  assert.ok(itemsCard<barcode,'الحقل داخل بطاقة الأصناف');
  assert.ok(barcode<itemsTools,'الحقل فوق عنوان الأصناف');
  /* شريط التعبئة الكاملة والخط الأكبر */
  assert.ok(html.includes('sale-barcode-strip'),'الشريط الجديد موجود');
});

test('المعرف والمعالجات كما هي — لا تغيير في السلوك', ()=>{
  assert.equal((html.match(/id="saleBarcodeInput"/g)||[]).length,1,'معرف واحد لا تكرار');
  assert.ok(html.includes('onkeydown="handleBarcodeKey(event)"'),'onkeydown كما هو');
  assert.ok(html.includes('oninput="handleBarcodeInput()"'),'oninput كما هو');
  assert.ok(app.includes('function handleBarcodeKey'),'الدالة موجودة في app.js');
  assert.ok(app.includes('function handleBarcodeInput'),'الدالة موجودة في app.js');
});

test('«ملاحظات» و«الطباعة» بقيتا أعلى الصفحة في مجموعتهما', ()=>{
  const notes=html.indexOf('id="saleNotes"');
  const printSel=html.indexOf('id="salePrintAfterSave"');
  const itemsCard=html.indexOf('pos-items-card');
  assert.ok(notes>-1&&notes<itemsCard,'الملاحظات أعلى الصفحة (قبل بطاقة الأصناف)');
  assert.ok(printSel>-1&&printSel<itemsCard,'الطباعة أعلى الصفحة');
});

test('زر «إضافة سريعة» واختصار «/» ما زالا يستهدفان الحقل', ()=>{
  assert.ok(html.includes("q('saleBarcodeInput').focus()"),'زر الإضافة السريعة يستهدف المعرف نفسه');
  const slash=app.match(/key==='\/'[\s\S]{0,200}/)||app.match(/'\/'[\s\S]{0,200}saleBarcodeInput/);
  assert.ok(slash,'اختصار / موجود ويستهدف الحقل');
});

test('ترتيب DOM سليم بعد النقل (بنية المجموعة القديمة بلا حقل الباركود)', ()=>{
  const quickGroup=html.indexOf('الإدخال السريع');
  const oldGroup=html.indexOf('ملاحظات الفاتورة والطباعة');
  /* مجموعة الإدخال السريع القديمة صارت «ملاحظات الفاتورة والطباعة» أو أزيلت — الحقل لم يعد فيها */
  if(quickGroup>-1){
    const groupEnd=html.indexOf('</div>',quickGroup);
    assert.ok(html.slice(quickGroup,groupEnd).indexOf('saleBarcodeInput')===-1,'الحقل لم يعد في مجموعة الإدخال السريع');
  }
  assert.ok(oldGroup>-1,'المجموعة العلوية معنونة من جديد (ملاحظات/طباعة)');
});
