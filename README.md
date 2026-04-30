# Chatwoot Smart Importer

ويب أب صغير يتثبت على Coolify ويتضاف كـ Dashboard App داخل Chatwoot. يقرأ ملف CSV أو XLSX، ثم:

- يقرأ الاسم من عمود مثل `name`.
- يقرأ الهاتف من عمود مثل `phone_number`.
- يقرأ اسم الليبل من عمود مثل `custom_attribute_1`.
- ينشئ الليبل لو غير موجود.
- يبحث عن الكونتاكت بالرقم.
- ينشئ الكونتاكت لو غير موجود.
- يربط الليبل بالكونتاكت بدون حذف الليبلز القديمة.

## التشغيل المحلي

```bash
npm install
copy .env.example .env
npm run dev
```

افتح:

```text
http://localhost:5173
```

## Environment Variables المطلوبة

ضع القيم دي في Coolify، ولا ترفع ملف `.env` على GitHub:

```bash
CHATWOOT_BASE_URL=https://chat.engosoft.com
CHATWOOT_API_TOKEN=replace_me
CHATWOOT_ACCOUNT_ID=2
CHATWOOT_INBOX_ID=replace_me
DEFAULT_COUNTRY_CODE=966
APP_PASSWORD=change_me
PORT=3000
REQUEST_DELAY_MS=350
```

مهم: لو التوكن اتكتب في شات أو اتبعت لأي طرف، اعمله Rotate من Chatwoot Profile Settings قبل النشر.

## النشر على Coolify

1. ارفع المشروع على GitHub.
2. في Coolify اعمل New Resource من Git Repository.
3. اختار Dockerfile deployment.
4. أضف Environment Variables الموجودة فوق.
5. Deploy.
6. افتح الدومين الناتج وتأكد أن الصفحة اشتغلت.

## إضافته داخل Chatwoot

1. افتح Chatwoot كـ Admin.
2. ادخل على `Settings` ثم `Integrations` ثم `Dashboard apps`.
3. اعمل Dashboard App جديد.
4. ضع رابط Coolify في `Content URL`.
5. فعله من الـ sidebar.

بعدها الفريق يقدر يفتح الأداة من داخل Chatwoot ويرفع الشيت مباشرة.

## شكل الشيت المتوقع

الأداة تشتغل مع أي أسماء أعمدة، لكن هتتعرف تلقائياً على:

```csv
name,phone_number,custom_attribute_1
Ahmed,+966500000000,Interior
Sara,+966511111111,Exterior
```

لو أسماء الأعمدة مختلفة، اختارها من Mapping قبل التشغيل.

صيغة XLS القديمة غير مدعومة. احفظ الملف كـ XLSX أو CSV قبل الرفع.

## ملاحظات مهمة

- الأداة لا تضع Chatwoot API token في المتصفح.
- الـ API token محفوظ في السيرفر فقط.
- استخدام backend يحل مشكلة CORS التي تظهر مع React static فقط.
- `CHATWOOT_INBOX_ID` مطلوب لإنشاء Contacts جديدة في Chatwoot Application API.
- إضافة الليبل تتم بعد قراءة الليبلز الحالية للكونتاكت حتى لا يتم استبدال الليبلز القديمة.
