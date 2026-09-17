# مرتب

تطبيق PWA عربي local-first لتنظيم الجدول الجامعي لطلاب جامعة الطفيلة التقنية. لا يتصل هذا الإصدار بخدمات الجامعة أو بخادم بيانات.

## التشغيل

```bash
pnpm install
pnpm dev
```

ثم افتح `http://localhost:3000`. تُحفظ البيانات في IndexedDB على الجهاز.

## الأوامر

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm calendar:validate
pnpm build
pnpm start
```

## الأصول

يوجد فيديو البداية في `public/brand/splash.mp4`. الأيقونات الحالية placeholders متجهية حتى يُسلّم الشعار النهائي، وصورة الشعار المرجعية محفوظة دون تعديل في `public/brand/logo-reference.png`.
