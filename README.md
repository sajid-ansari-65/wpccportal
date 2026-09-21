# WPCC Surat 2026 — Registration & Attendance Portal

## Kya hai isme
- **Import**: XLS/CSV registration sheet upload → students DB mein
- **Attendance**: search-tap se manual mark, ya student apna QR scan kare (self check-in)
- **Scan tab**: volunteer camera se student ka QR scan karke mark kar sakta hai
- **Student QR Codes tab**: har student ka QR print/generate karo, unhe bhejo (email/WhatsApp) ya entry pass ban jaaye
- **Export**: present students ki CSV → Canva Bulk Create mein daal ke certificates generate karo

## Setup — 15 min

### 1. Supabase project banao
1. https://supabase.com → New Project (free tier chalega)
2. Project ready hone ke baad: **SQL Editor** → naya query → `supabase-schema.sql` ka pura content paste karke Run karo
3. **Project Settings → API** se copy karo:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` key (secret one, anon nahi) → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Local pe test (optional)
```bash
npm install
cp .env.local.example .env.local
# .env.local mein apni Supabase URL, key, aur ADMIN_PASSWORD daal do
npm run dev
```
http://localhost:3000 pe khulega.

### 3. Vercel pe deploy
1. Is folder ko GitHub repo bana ke push karo (ya seedha `vercel` CLI se folder deploy karo)
2. https://vercel.com → New Project → repo import karo
3. **Environment Variables** mein teeno daal do:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD`
4. Deploy — 2 min mein live link mil jayega

## Event day flow
1. `/dashboard` pe login karo (ADMIN_PASSWORD se)
2. **Import XLS** tab se registration sheet upload karo
3. Agar QR wala flow use karna hai: **Student QR Codes** tab se sabke QR print/share kar do event se pehle
4. Event ke din: volunteer **Attendance** tab se search-tap kare, ya **Scan QR** tab se camera se scan kare, ya students khud apna QR scan karke self check-in kar sakte hain
5. End mein **Export CSV** se present list nikal ke Canva Bulk Create mein daal do → certificates generate

## Notes
- Password ek hi hai sab volunteers ke liye (simple rakha hai) — agar alag-alag login chahiye future mein toh bata dena, add kar denge
- Data permanent Supabase mein rehta hai, future events ke liye same portal reuse ho sakta hai (bas naya `event_id` wala filter add karna padega jab do events ek saath chalane ho)
- QR scan wala flow HTTPS pe hi kaam karega (Vercel automatically HTTPS deta hai, so no issue after deploy)
