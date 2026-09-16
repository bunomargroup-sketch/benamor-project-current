// ===== البحث الذكي باللغة العربية — يعمل محلياً بدون API =====
// يفهم: "خلاط كروم أقل من 200"، "مرايا بإضاءة"، "أرخص دولاب 80"

// --- قاموس مرادفات قابل للتعديل ---
const SMART_SYNONYMS={
  'مرايا بإضاءة':['مرايا حمام مع إضاءة لد','مرايا مع إضاءة'],
  'مرايا led':['مرايا حمام مع إضاءة لد','مرايا مع إضاءة'],
  'خلاط دوش':['خلاط دوش'],
  'خلاط مغسلة':['خلاط حوض وجه'],
  'دولاب':['دولاب حمام','خزانة حمام'],
  'حوض قدم':['حوض قدم'],
  'سيفون':['سيفون','سيفوني'],
  'شطاف':['شطاف'],
  'علاقة':['علاقة','علاقت'],
  'حاملة':['حاملة'],
  'مسكر':['مسكر'],
  'مخفض':['مخفض'],
  'كوربة':['كوربة'],
  'وصلة':['وصلة'],
  'كوع':['كوع'],
  'طوبة':['طابة','طوبه'],
};

// --- ألوان وتشطيبات معروفة في البضاعة ---
const SMART_COLORS=['كروم','ذهبي','أسود','ابيض','أبيض','بيج','رصاصي','مطفي','لامع','كروم مطفي','ذهبي مطفي','أسود مطفي'];

// --- أنواع منتجات معروفة (من الفئات والأسماء) ---
const SMART_TYPES=['خلاط','مراية','مرايا','دولاب','خزانة','حوض','مقعد','سيفون','سماعة','دوش','شطاف','علاقة','حاملة','مسكر','سرفنتينة','كوربة','مخفض','وصلة','كوع','طوبة','سخانة','مضخة','مجفف','رف','بوكس','حاجز','طلاء','اسمنت','جبس','زمالطو','استوك','سلكون','لصقة','ورق سنفرة','فيتي','برشام','سرفنتينة','نبلس','بونتة','موس','فرشة','كيس','علبة','لامبة'];

// --- ترتيب معروف ---
const SMART_SORTS={'ارخص':['price','asc'],'اغلى':['price','desc'],'اكبر':['size','desc'],'اصغر':['size','asc']};

// --- أدوات ---
function smartArabicToEnDigits(s){return String(s||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));}
function smartNormAr(s){
  return String(s||'').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g,'')
    .replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه')
    .replace(/[ـ\-_/\\.,;:|()[\]{}+*؟?،«»"']/g,' ')
    .replace(/\s+/g,' ').trim();
}

// --- الدالة الرئيسية: تحليل الاستعلام ---
function smartParseQuery(rawQuery){
  const raw=String(rawQuery||'').trim();
  if(!raw) return {filters:{},sort:null,rawTokens:[],display:[]};

  const q=smartNormAr(smartArabicToEnDigits(raw));
  const tokens=q.split(' ').filter(Boolean);
  const filters={type:null,colors:[],maxPrice:null,minPrice:null,sizes:[],sort:null,textTokens:[]};
  const display=[];
  let remaining=tokens.slice();

  // 1. الباركود أو الكود الكامل (أولوية قصوى)
  const rawClean=raw.trim();
  const exactCode=products.find(p=>String(p.code||'').toLowerCase()===rawClean.toLowerCase());
  if(exactCode){
    return {filters:{exactCode:exactCode.code},sort:null,rawTokens:[],display:[{label:'الكود: '+exactCode.code,remove:false}],isExactCode:true};
  }
  const exactBarcode=products.find(p=>String(p.barcode||'')===rawClean);
  if(exactBarcode){
    return {filters:{exactCode:exactBarcode.code},sort:null,rawTokens:[],display:[{label:'الباركود: '+rawClean,remove:false}],isExactCode:true};
  }

  // 2. السعر: "أقل من X" أو "أرخص من X" أو "أكثر من X" أو "فوق X"
  for(let i=0;i<remaining.length-1;i++){
    const t=remaining[i],n=remaining[i+1];
    const num=parseFloat(n);
    if(!isNaN(num)&&num>0){
      if(['اقل','ارخص','تحت','قبل','ما','اكبر','تقل','اكثر','اغلى','فوق','بعد'].includes(t)){
        if(['اقل','ارخص','تحت','تقل'].includes(t)){
          filters.maxPrice=num; display.push({label:'السعر: أقل من '+num,field:'maxPrice'});
          remaining.splice(i,2); i-=1;
        } else if(['اكثر','اغلى','فوق','بعد'].includes(t)){
          filters.minPrice=num; display.push({label:'السعر: أكثر من '+num,field:'minPrice'});
          remaining.splice(i,2); i-=1;
        } else if(t==='ما'&&remaining[i-1]==='اقل'){
          // handled above
        }
      }
    }
  }
  // "أقل من X دينار" — إزالة "من" و"دينار" و"دل" و"درهم"
  remaining=remaining.filter(t=>!['من','دينار','دل','درهم','د.ل','lyd'].includes(t));

  // 3. الترتيب: "أرخص" أو "أغلى"
  for(const [word,[field,dir]] of Object.entries(SMART_SORTS)){
    const idx=remaining.indexOf(smartNormAr(word));
    if(idx>=0){
      filters.sort={field,dir}; display.push({label:'ترتيب: '+word,field:'sort'});
      remaining.splice(idx,1); break;
    }
  }

  // 4. الألوان والتشطيبات
  for(const color of SMART_COLORS){
    const cn=smartNormAr(color);
    const idx=remaining.findIndex(t=>t===cn||t.startsWith(cn));
    if(idx>=0){
      filters.colors.push(color); display.push({label:'التشطيب: '+color,field:'color'});
      remaining.splice(idx,1);
    }
  }

  // 5. المقاسات: أرقام مع وحدات (سم، مم، بوصة، لتر،...) أو نمط "80*50"
  const sizeUnits=['سم','مم','بوصه','بوصة','انش','لتر','كغ','غرام','غرامات','متر','م','م2','قدم'];
  for(let i=0;i<remaining.length;i++){
    const t=remaining[i];
    const num=parseFloat(t);
    if(!isNaN(num)&&num>0){
      const next=remaining[i+1]||'';
      const prev=remaining[i-1]||'';
      // إذا كان الرقم متبوعاً بوحدة مقاس
      if(sizeUnits.some(u=>next===smartNormAr(u)||next.startsWith(smartNormAr(u)))){
        filters.sizes.push({value:num,unit:next});
        display.push({label:'المقاس: '+num+' '+next,field:'size'});
        remaining.splice(i,2); i-=1; continue;
      }
      // إذا كان الرقم مسبوقاً بكلمة نوع منتج (مثل "دولاب 80")
      if(filters.type&&SMART_TYPES.includes(filters.type)){
        // قد يكون مقاساً — لكن فقط إذا ليس جزءاً من كود
        if(!String(raw).includes(String(num))||!/^[a-zA-Z]{2,}\d+/.test(rawClean)){
          if(num>=20&&num<=300){ // نطاق مقاسات معقول
            filters.sizes.push({value:num,unit:'سم'});
            display.push({label:'المقاس: '+num+' سم',field:'size'});
            remaining.splice(i,1); i-=1; continue;
          }
        }
      }
    }
    // نمط "80*50" أو "80*50*14"
    const dimMatch=t.match(/^(\d+)[x×*](\d+)/);
    if(dimMatch){
      filters.sizes.push({value:parseFloat(dimMatch[1]),unit:'سم'});
      display.push({label:'المقاس: '+t,field:'size'});
      remaining.splice(i,1); i-=1; continue;
    }
  }

  // 6. نوع المنتج (من القاموس أو الأنواع المعروفة)
  for(const type of SMART_TYPES){
    const tn=smartNormAr(type);
    const idx=remaining.findIndex(t=>t===tn||t.startsWith(tn)||tn.startsWith(t)&&t.length>=3);
    if(idx>=0){
      filters.type=type; display.push({label:'النوع: '+type,field:'type'});
      remaining.splice(idx,1); break;
    }
  }

  // 7. المرادفات (خلاط مغسلة = خلاط حوض وجه)
  for(const [synonym,expansions] of Object.entries(SMART_SYNONYMS)){
    const sn=smartNormAr(synonym);
    if(q.includes(sn)){
      filters.type=filters.type||expansions[0].split(' ')[0];
      display.push({label:'النوع: '+synonym,field:'type'});
      // إزالة كلمات المرادف
      const synWords=sn.split(' ');
      remaining=remaining.filter(t=>!synWords.includes(t));
      break;
    }
  }

  // 8. الكلمات المتبقية = نص حر للبحث
  filters.textTokens=remaining.filter(t=>t.length>=2);

  return {filters,sort:filters.sort,rawTokens:remaining,display};
}

// --- تطبيق الفلاتر على المنتجات ---
function smartFilterProducts(parsed){
  const {filters}=parsed;
  let rows=products.slice();

  // كود/باركود محدد
  if(filters.exactCode){
    return products.filter(p=>p.code===filters.exactCode);
  }

  // النوع
  if(filters.type){
    const tn=smartNormAr(filters.type);
    rows=rows.filter(p=>{
      const name=smartNormAr(p.name||'');
      const cat=smartNormAr(p.category||'');
      return name.includes(tn)||cat.includes(tn);
    });
  }

  // اللون/التشطيب
  if(filters.colors&&filters.colors.length){
    rows=rows.filter(p=>{
      const color=smartNormAr(p.color||'');
      const name=smartNormAr(p.name||'');
      return filters.colors.some(c=>{
        const cn=smartNormAr(c);
        return color.includes(cn)||name.includes(cn);
      });
    });
  }

  // السعر
  if(filters.maxPrice!=null){
    rows=rows.filter(p=>Number(p.retail_price||0)<=filters.maxPrice&&Number(p.retail_price||0)>0);
  }
  if(filters.minPrice!=null){
    rows=rows.filter(p=>Number(p.retail_price||0)>=filters.minPrice);
  }

  // المقاس (بحث في الاسم فقط — ليس في الكود)
  if(filters.sizes&&filters.sizes.length){
    rows=rows.filter(p=>{
      const name=smartNormAr(p.name||'');
      return filters.sizes.every(s=>{
        const sv=String(s.value);
        return name.includes(sv)||name.includes(s.value+' '+s.unit)||name.includes(s.value+s.unit);
      });
    });
  }

  // نص حر (كلمات متبقية)
  if(filters.textTokens&&filters.textTokens.length){
    rows=rows.filter(p=>{
      const hay=p._hay||smartNormAr(productSearchFields(p).join(' '));
      return filters.textTokens.every(tok=>hay.includes(tok));
    });
  }

  // الترتيب
  if(filters.sort){
    if(filters.sort.field==='price'){
      rows.sort((a,b)=>filters.sort.dir==='asc'?Number(a.retail_price||0)-Number(b.retail_price||0):Number(b.retail_price||0)-Number(a.retail_price||0));
    }
  }

  return rows;
}
