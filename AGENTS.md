# قواعد العمل في مرتب

- اقرأ تعليمات UI/UX Pro Max كاملة قبل أي تغيير بصري جوهري، وطبّق RTL وإمكانية الوصول بصورة فعلية.
- لا تضف مزايا خارج نطاق MVP (feature creep)، ولا تنفذ حسابات أو مزامنة أو API للجامعة دون موافقة رسمية.
- لا تحفظ أسرارًا أو مفاتيح API أو بيانات طالب حقيقية في Git أو العميل.
- حافظ على فصل منطق المجال عن React وDexie؛ الواجهة تستخدم repository interfaces فقط.
- استخدم semantic design tokens، ولا تستعمل ألوانًا خامًا داخل المكونات.
- شغّل `pnpm typecheck && pnpm lint && pnpm test && pnpm build` قبل التسليم، وشغّل smoke tests عند توفر متصفح Playwright.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
