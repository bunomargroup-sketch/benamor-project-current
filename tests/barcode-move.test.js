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

test('حقل الباركود في شريطه الخاص [4] فوق منطقة العمل — أبرز عنصر', ()=>{
  /* إعادة التنظيم 2026: الشريط خرج من بطاقة الأصناف وصار ابناً مباشراً للنموذج
     فوق pos-work-area (مواصفة المخطّط [4]: عرض كامل · إطار 2px أزرق) */
  const formStart=html.indexOf('id="saleForm"');
  const workArea=html.indexOf('pos-work-area');
  const strip=html.indexOf('sale-barcode-strip');
  const barcode=html.indexOf('id="saleBarcodeInput"');
  const itemsCard=html.indexOf('pos-items-card');
  assert.ok(formStart>-1&&workArea>-1&&strip>-1&&barcode>-1&&itemsCard>-1);
  assert.ok(formStart<strip&&strip<barcode&&barcode<workArea,'الشريط ابن مباشر للنموذج قبل منطقة العمل');
  assert.ok(strip<itemsCard,'الشريط فوق بطاقة الأصناف (خارجها)');
  assert.ok(html.includes('sale-barcode-icon'),'أيقونة الباركود في الشريط');
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

test('شريحة «قائمة المنتجات F3» في الشريط واختصار «/» يستهدفان الحقل والمنتقي', ()=>{
  /* زر «إضافة سريعة» حُذف بمواصفة إعادة التنظيم (كان يفعل التركيز فقط والحقل الآن أعلى الشاشة) */
  assert.ok(!html.includes('إضافة سريعة'),'زر «إضافة سريعة» حُذف');
  /* شريحة F3 داخل الشريط تفتح المنتقي */
  const stripStart=html.indexOf('sale-barcode-strip');
  const stripEnd=html.indexOf('</div>',html.indexOf('id="saleBarcodeInput"'));
  const stripHtml=html.slice(stripStart,stripEnd);
  assert.ok(stripHtml.includes('openSaleProductPicker()')&&stripHtml.includes('F3'),'شريحة قائمة المنتجات [F3] في الشريط');
  const slash=app.match(/key==='\/'[\s\S]{0,200}/)||app.match(/'\/'[\s\S]{0,200}saleBarcodeInput/);
  assert.ok(slash,'اختصار / موجود ويستهدف الحقل');
  assert.ok(app.includes("function focusBarcode(){const el=q('saleBarcodeInput')"),'focusBarcode يستهدف المعرف نفسه');
});

test('ترتيب DOM سليم بعد إعادة التنظيم (المجموعات القديمة أزيلت)', ()=>{
  assert.ok(html.indexOf('الإدخال السريع')===-1,'مجموعة الإدخال السريع القديمة أزيلت');
  assert.ok(html.indexOf('ملاحظات الفاتورة والطباعة')===-1,'المجموعة العلوية القديمة أزيلت');
  /* «ملاحظات» و«الطباعة» الآن في لوحة التفاصيل القابلة للطي */
  const panelStart=html.indexOf('sale-details-panel');
  assert.ok(panelStart>-1,'لوحة تفاصيل الفاتورة موجودة');
  const panelEnd=html.indexOf('</div>',html.indexOf('id="salePrintAfterSave"'));
  const panelHtml=html.slice(panelStart,panelEnd);
  assert.ok(panelHtml.includes('id="saleNotes"')&&panelHtml.includes('id="salePrintAfterSave"'),'الملاحظات والطباعة داخل لوحة التفاصيل');
  assert.ok(panelHtml.indexOf('saleBarcodeInput')===-1,'حقل الباركود ليس في أي لوحة');
});
