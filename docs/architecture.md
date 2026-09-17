# المعمارية

التطبيق Next.js App Router مع مكوّن client واحد للتفاعل، لكنه لا يصل إلى Dexie مباشرة؛ `ScheduleRepository` هو الحد الفاصل، و`LocalScheduleRepository` يقدّم طبقة Dexie/IndexedDB مع نسخة محلية احتياطية متوافقة للمتصفحات التي تمنع IndexedDB. المنطق القابل للاختبار في `src/domain`، وإعداد الجامعة data-driven في `src/config`.

للتوسع: أضف Cloud/Sync Repository يحقق الواجهة نفسها بعد وجود قرار مصادقة وموافقة المستخدم. عقود استخراج الجدول موجودة في domain فقط؛ لا provider أو مفتاح أو طلب شبكة الآن. Route Handlers مستقبلية تستخدم Node runtime افتراضيًا.

الترحيل: Dexie versioned schema؛ تُضاف migrations للنسخ القادمة ولا يُعاد تفسير البيانات بلا migration صريح.
