# إشعارات الجهاز

تعمل إشعارات «مرتب» عبر Web Push. يوافق المستخدم مرة على كل جهاز، ثم يخزّن الخادم اشتراك الجهاز وتفاصيل التذكيرات المطلوبة فقط. لا يُخزَّن اسم الطالب أو رقمه الجامعي أو ملفه الأكاديمي.

## البنية

- المتصفح ينشئ رمز جهاز عشوائيًا واشتراك Push محميًا.
- واجهات `/api/push/*` تتحقق من رمز الجهاز وتتواصل مع Supabase بمفتاح الخادم فقط.
- Supabase يحفظ الأجهزة والتذكيرات مع RLS ومن دون صلاحيات `anon` أو `authenticated`.
- Supabase Cron يستدعي `/api/push/dispatch` كل دقيقة.
- عامل الخدمة `public/sw.js` يعرض الإشعار ويفتح صفحة الجدول عند الضغط عليه.

## التهيئة

1. طبّق ملف `supabase/migrations/202609210001_push_notifications.sql` على مشروع Supabase.
2. أنشئ مفاتيح VAPID مرة واحدة:

   ```bash
   pnpm exec web-push generate-vapid-keys --json
   ```

3. أضف متغيرات البيئة الموثقة في `.env.example` إلى Vercel. لا تضع القيم السرية في Git.
4. خزّن رابط التطبيق وسر الاستدعاء في Supabase Vault، ثم أنشئ مهمة Cron:

   ```sql
   select vault.create_secret('https://murattab-pi.vercel.app', 'murattab_app_url');
   select vault.create_secret('REPLACE_WITH_PUSH_DISPATCH_SECRET', 'murattab_dispatch_secret');

   select cron.schedule(
     'murattab-push-dispatch',
     '* * * * *',
     $$
       select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'murattab_app_url') || '/api/push/dispatch',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'murattab_dispatch_secret')
         ),
         body := '{}'::jsonb,
         timeout_milliseconds := 30000
       );
     $$
   );
   ```

## ملاحظات الأجهزة

- Android وChrome وEdge وFirefox: يعمل بعد موافقة المستخدم.
- iPhone/iPad: يلزم iOS/iPadOS 16.4 أو أحدث، وتثبيت «مرتب» على الشاشة الرئيسية، ثم تفعيل الإشعارات من داخل التطبيق.
- لا يمكن لأي موقع تفعيل إشعارات الجهاز من دون موافقة المستخدم؛ هذا قيد أمان من نظام التشغيل.

