# نظام التصميم

المصدر: `docs/design-system/MASTER.md` الناتج من UI/UX Pro Max، مع تكييف الهوية المطلوبة: زمردي عميق، عاجي، mint باهت، وذهب محدود للتأكيد؛ لا أزرق أو بنفسجي أو gradients.

الرموز الدلالية في `globals.css`: `background`, `surface`, `surface-muted`, `foreground`, `foreground-muted`, `primary`, `primary-foreground`, `accent`, `border`, `success`, `warning`, `destructive`, `focus-ring`. لا تُكتب قيم خام داخل JSX. الوضع الداكن تعيين مستقل وليس عكسًا آليًا.

RTL: `dir=rtl` على الجذر، النصوص عربية، الترتيب منطقي، ووسائط الإدخال الزمنية تحتفظ بقيم تخزين 24 ساعة. أزرار لوحة المفاتيح وfocus واضحان ≥3:1، والحركة تحترم `prefers-reduced-motion`.
