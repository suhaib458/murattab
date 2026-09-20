# Local OCR — التعرف البصري المحلي

## الهدف

تمكين «مرتب» من قراءة صور جداول جامعة الطفيلة التقنية (TTU) محليًا في متصفح الطالب دون أي اتصال بخادم أو API خارجي.

## نموذج الخصوصية

| العنصر | الوضع |
|---|---|
| صورة الجدول | **لا تغادر المتصفح أبدًا** |
| معالجة OCR | Tesseract.js Web Worker (محلي بالكامل) |
| ملفات اللغة والمحرك | مستضافة ذاتيًا من نفس الأصل (`/ocr/`) |
| طلبات شبكة | فقط لتحميل أصول المحرك (WASM + traineddata) من الخادم نفسه |

## البنية المعمارية

```
صورة المستخدم
   │
   ▼
┌──────────────────────┐
│  image-preprocessor  │   تكبير + تدرج رمادي + تحسين التباين
│  (OffscreenCanvas)   │
└──────────┬───────────┘
           │  Blob (PNG)
           ▼
┌──────────────────────┐
│   tesseract-engine   │   Web Worker + WASM
│   (LocalOcrEngine)   │   ara+eng
└──────────┬───────────┘
           │
           ▼
    OcrImageResult
    ├── text
    ├── confidence
    ├── lines[]  →  words[]  →  bbox
    └── width, height
```

## دعم اللغات ونمط المحرك
- **العربية والإنجليزية** عبر مصفوفة لغات صريحة `["ara", "eng"]`: لدعم المحتوى المختلط (أسماء المواد بالعربية ورموز التخصصات والقاعات بالإنجليزية مثل ICT).
- **نمط المحرك (Engine Mode)**: يتم تحديد نمط الشبكة العصبية صراحة `OEM.LSTM_ONLY` لمطابقة ملفات النواة عالية الأداء (LSTM WASM).

## نظام إحداثيات الصناديق المحيطة (Bounding-Box Coordinate System)
- **العقد الحتمي:** جميع الصناديق المحيطة (`OcrWord.bbox` و `OcrLine.bbox`) المرجعة من قبل مرتب تستخدم **نظام إحداثيات الصورة الأصلية المرفوعة** (`width` × `height`) وليس الصورة المكبرة أو المعالجة مسبقاً.
- يتم تحويل إحداثيات Tesseract تلقائياً عبر:
  ```
  scaleX = originalWidth / processedWidth
  scaleY = originalHeight / processedHeight
  x0 = Math.round(tesseract_x0 * scaleX)
  y0 = Math.round(tesseract_y0 * scaleY)
  x1 = Math.round(tesseract_x1 * scaleX)
  y1 = Math.round(tesseract_y1 * scaleY)
  ```
- هذا يضمن دقة هندسية متسقة ومطابقة للأصل عند بناء مُحلل جداول جامعة الطفيلة (TTU Table Parser) في المراحل القادمة.

## المعالجة المسبقة للصورة

| الخطوة | التفاصيل |
|---|---|
| فك الترميز | `createImageBitmap` أو `HTMLImageElement` (احتياطي) |
| التكبير | 2–3× للصور الصغيرة (< 800px عرض)، مقيد بـ 4096px و 16.7MP |
| التدرج الرمادي | BT.601 luma: Y = 0.299R + 0.587G + 0.114B |
| تحسين التباين | تمديد خطي محافظ (percentile 1–99) بدون عتبة ثنائية |

> لا يتم تعديل الصورة الأصلية أبدًا — كل المعالجة على نسخة في الذاكرة.

## الاستضافة الذاتية

أصول المحرك (worker, core WASM, traineddata) تُنسخ من `node_modules` إلى `public/ocr/` بواسطة:

```bash
pnpm ocr:setup
```

هذا يضمن عدم الاعتماد على CDN خارجي أثناء تشغيل التطبيق.

## القيود الحالية (المرحلة 1)

> [!IMPORTANT]
> هذه المرحلة هي **بنية تحتية فقط**.

- **لا يتم تفسير جداول TTU بعد** — لا كشف أعمدة، لا تحليل أيام/أوقات/قاعات
- **لا تكامل مع واجهة الاستيراد الذكي** — المحرك معزول عن React
- **لا دعم PDF** — يأتي في مرحلة لاحقة
- **لا استبدال لـ xKiro** — المسار الحالي يعمل بشكل مستقل

## الملفات

```
src/domain/ocr/
├── types.ts              أنواع OCR المملوكة لمرتب
├── image-preprocessor.ts معالجة مسبقة للصورة
├── tesseract-engine.ts   محرك Tesseract.js المحلي
└── index.ts              تصدير الأنواع والأدوات النقية فقط

src/test/
├── ocr-preprocessor.test.ts
└── local-ocr-engine.test.ts

scripts/
└── setup-ocr-assets.ts   نسخ أصول OCR إلى public/ocr/

public/ocr/               (مُولَّد — لا يُحفظ في Git)
├── worker.min.js
├── core/*.wasm.js
└── lang/*.traineddata.gz
```
