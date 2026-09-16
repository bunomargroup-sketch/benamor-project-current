-- Benamor POS - ملء أسعار الجملة تلقائياً (1.3 × سعر التكلفة)
-- Auto-fill wholesale prices: 1.3 x cost for all products where wholesale = 0
-- Run this in Supabase SQL Editor. Safe: only updates products where wholesale_price is 0.
-- After running, each product's wholesale price is editable from the product form.

begin;

-- الأساس: سعر الجملة = سعر التكلفة × 1.3 (للمنتجات التي لديها تكلفة)
UPDATE public.pos_products 
SET wholesale_price = ROUND((purchase_price * 1.3)::numeric, 2), updated_at = now()
WHERE (wholesale_price = 0 OR wholesale_price IS NULL) AND purchase_price > 0;

-- للمنتجات بدون تكلفة: سعر الجملة = سعر البيع القطاعي × 0.8
UPDATE public.pos_products 
SET wholesale_price = ROUND((retail_price * 0.8)::numeric, 2), updated_at = now()
WHERE (wholesale_price = 0 OR wholesale_price IS NULL) 
  AND (purchase_price = 0 OR purchase_price IS NULL) 
  AND retail_price > 0;

commit;

-- للتحقق بعد التشغيل:
-- SELECT count(*) FROM pos_products WHERE wholesale_price = 0;  -- يجب أن تكون 0 أو قليلة جداً
-- SELECT code, name, purchase_price, wholesale_price FROM pos_products ORDER BY code LIMIT 20;
