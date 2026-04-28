# Supabase 라이선스 검증 설정

memory 의 합의(2026-04-24 축약판) 기반의 v1 설정. JWT 서명·디바이스 바인딩·오프라인 grace 일수는 v2 에서.

## 1. DB 테이블

Supabase 콘솔 SQL editor 에서 실행.

```sql
-- 라이선스 키: 1 row = 1 라이선스
create table license_keys (
  id text primary key,                  -- 발급 식별자 (예: 'tbnws-001')
  serial text not null unique,          -- 사용자에게 전달하는 시리얼
  created_at timestamptz default now(),
  note text                             -- 발급 메모 (회사명 등, 옵션)
);

-- 라이선스별 entitlement (n:m). entitlement 단위로 만료 관리.
create table license_entitlements (
  license_id text not null references license_keys(id) on delete cascade,
  entitlement text not null,            -- 'core', 'tbnws.plugin', 'hello' 등
  expired_at timestamptz not null,
  issued_at timestamptz default now(),
  issued_by text,                       -- 발급자 (감사용, 옵션)
  primary key (license_id, entitlement)
);

create index license_entitlements_expired_at_idx
  on license_entitlements(expired_at);

-- RLS: anon 키로는 read/write 직접 안 되게. Edge Function 만 service_role 로 접근.
alter table license_keys enable row level security;
alter table license_entitlements enable row level security;
```

발급 예시:

```sql
insert into license_keys (id, serial, note) values
  ('tbnws-001', 'TBNWS-XXXX-YYYY-ZZZZ', '투비네트웍스글로벌 본 라이선스');

insert into license_entitlements (license_id, entitlement, expired_at, issued_by) values
  ('tbnws-001', 'core',         '2027-04-30T23:59:59Z', 'admin'),
  ('tbnws-001', 'tbnws.plugin', '2027-04-30T23:59:59Z', 'admin');
```

## 2. Edge Function `license-verify`

Supabase 콘솔 → Edge Functions → New function `license-verify`. 코드:

```ts
// supabase/functions/license-verify/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { id?: string; serial?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ valid: false, error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id || "").trim();
  const serial = String(body.serial || "").trim();
  if (!id || !serial) {
    return Response.json({ valid: false, error: "id and serial required" });
  }

  // service_role 키로 RLS 우회 (Edge Function 만 사용).
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1) 라이선스 키 매칭
  const { data: licenseKey, error: keyErr } = await supabase
    .from("license_keys")
    .select("id, serial")
    .eq("id", id)
    .eq("serial", serial)
    .maybeSingle();

  if (keyErr) {
    return Response.json({ valid: false, error: keyErr.message });
  }
  if (!licenseKey) {
    return Response.json({ valid: false, error: "Invalid id or serial" });
  }

  // 2) entitlements (만료 안 된 것만)
  const nowIso = new Date().toISOString();
  const { data: ents, error: entErr } = await supabase
    .from("license_entitlements")
    .select("entitlement, expired_at")
    .eq("license_id", id)
    .gt("expired_at", nowIso);

  if (entErr) {
    return Response.json({ valid: false, error: entErr.message });
  }
  if (!ents || ents.length === 0) {
    return Response.json({
      valid: false,
      error: "No active entitlements",
      expiredAt: null,
      entitlements: [],
    });
  }

  // 가장 빠른 만료를 라이선스 expiredAt 으로 (보수적 — 그 entitlement 만료
  // 시점에 클라이언트가 자동 재검증하도록 유도).
  const expiredAt = ents
    .map((e) => e.expired_at)
    .sort()[0];

  return Response.json({
    valid: true,
    expiredAt,
    entitlements: ents.map((e) => e.entitlement),
  });
});
```

배포: `supabase functions deploy license-verify` 또는 콘솔에서 직접.

테스트:

```bash
curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/license-verify \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -d '{"id":"tbnws-001","serial":"TBNWS-XXXX-YYYY-ZZZZ"}'
```

응답 shape:

```json
{ "valid": true, "expiredAt": "2027-04-30T23:59:59+00:00",
  "entitlements": ["core", "tbnws.plugin"] }
```

또는 invalid:

```json
{ "valid": false, "error": "Invalid id or serial" }
```

## 3. 클라이언트 env

루트의 `.env` (gitignore 됨):

```bash
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

`SUPABASE_SERVICE_ROLE_KEY` 는 절대 클라이언트에 두지 말 것 — Edge Function 의 환경변수에만.

main process (Electron) 가 `process.env.SUPABASE_URL` / `SUPABASE_ANON_KEY` 를 읽어 [license-service.js](../license-service.js) 의 `verifyOnline` 에서 fetch. env 가 비어있으면 dev stub (`DEV-` 접두어 시리얼만 통과) 으로 폴백.

dev 시 env 로딩은 `dotenv` 등으로 처리 (필요 시 추후 추가). prod 빌드는 `electron-builder` 의 env injection 또는 빌드 시 기본값 주입.

## 4. 발급 워크플로우 (어드민)

v1 은 SQL 콘솔에서 수동 발급. 이후 어드민 UI 작업:

1. `license_keys` 에 새 row insert (id, serial, note)
2. `license_entitlements` 에 권한별 row insert (license_id, entitlement, expired_at)
3. 사용자에게 id + serial 전달
4. 사용자가 앱 첫 실행 시 시리얼 입력

만료 연장은 `license_entitlements.expired_at` UPDATE.
