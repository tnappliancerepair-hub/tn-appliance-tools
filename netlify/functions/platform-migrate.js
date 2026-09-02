// platform-migrate — admin-gated, allow-listed schema migrations for the ANT Platforms
// Supabase project. NOT an arbitrary SQL runner: it only executes the named, idempotent
// (IF NOT EXISTS) statements defined in MIGRATIONS below, via the Supabase Management API
// (same mechanism + SUPABASE_MGMT_TOKEN as platform-ops.js). This is how office-board /
// platform schema tweaks get applied without hand-running SQL in the dashboard.
//
//   GET ?secret=<admin>&do=<name>   -> runs that migration (idempotent; safe to re-run)
//   GET ?secret=<admin>             -> lists the available migration names
const { getSecret } = require('./_lib/secrets');

const MGMT = 'https://api.supabase.com/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function refFromUrl(u) { const m = String(u || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i); return m ? m[1] : ''; }
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Allow-listed, idempotent migrations. Add new ones here; each is safe to re-run.
const MIGRATIONS = {
  // The office board's per-job "which column" placement (mirrors the legacy office_stage).
  // Nullable + additive: existing jobs derive a default column until one is set here.
  board_stage: `alter table public.job add column if not exists board_stage text;`,

  // Widen the TDR outcome set to the office's full claim dispositions: the original three
  // (fixed / return_needed / not_fixable=replacement) plus second_opinion + no_failure (NFF).
  tdr_outcomes: `alter table public.job_tdr drop constraint if exists job_tdr_outcome_check;
                 alter table public.job_tdr add constraint job_tdr_outcome_check
                   check (outcome in ('fixed','return_needed','not_fixable','second_opinion','no_failure'));`,

  // Per-part fulfillment: where the part is COMING FROM (source — warranty co / warehouse /
  // Amazon / free text), the delivery ROUTE (distributor pickup vs shipped to the customer's
  // home), and the ETA. So the office (and Ann) can answer "when are my parts coming?".
  part_fulfillment: `alter table public.job_part add column if not exists source  text;
                     alter table public.job_part add column if not exists ship_to text;
                     alter table public.job_part add column if not exists eta     date;`,

  // Editable, per-shop TAGS (MeisterTask-style): a `tag` library each shop builds itself, and a
  // `job_tag` join so a job can carry several. Both RLS-scoped to the shop; any shop member
  // manages them (operational, like customer/job). Cards show the colorful chips.
  tags: `create table if not exists public.tag (
           id uuid primary key default gen_random_uuid(),
           company_id uuid not null references public.company(id) on delete cascade,
           label text not null,
           color text,
           created_at timestamptz not null default now()
         );
         create index if not exists tag_company_idx on public.tag (company_id);
         alter table public.tag enable row level security;
         drop policy if exists tag_tenant on public.tag;
         create policy tag_tenant on public.tag
           using (company_id = public.current_company_id())
           with check (company_id = public.current_company_id());
         grant select, insert, update, delete on public.tag to authenticated;
         create table if not exists public.job_tag (
           id uuid primary key default gen_random_uuid(),
           company_id uuid not null references public.company(id) on delete cascade,
           job_id uuid not null references public.job(id) on delete cascade,
           tag_id uuid not null references public.tag(id) on delete cascade,
           created_at timestamptz not null default now(),
           unique (job_id, tag_id)
         );
         create index if not exists job_tag_job_idx on public.job_tag (job_id);
         create index if not exists job_tag_company_idx on public.job_tag (company_id);
         alter table public.job_tag enable row level security;
         drop policy if exists job_tag_tenant on public.job_tag;
         create policy job_tag_tenant on public.job_tag
           using (company_id = public.current_company_id())
           with check (company_id = public.current_company_id());
         grant select, insert, update, delete on public.job_tag to authenticated;`,

  // Invoice worksheet upgrade: shipping & handling, tips (100% to the tech, not taxed), the
  // office-adjustable tech pay, and the parts cost (for the margin readout). All editable.
  invoice_extras: `alter table public.invoice add column if not exists shipping_cents  integer not null default 0;
                   alter table public.invoice add column if not exists tip_cents       integer not null default 0;
                   alter table public.invoice add column if not exists tech_pay_cents   integer;
                   alter table public.invoice add column if not exists parts_cost_cents integer;`,

  // Sample data for iterating on the DISPATCH page: seeds the DEMO tenant with a handful of
  // scheduled jobs spread across techs (next few days) + some needing scheduling, plus a couple
  // extra demo techs with Nashville service zones. Idempotent — re-run refreshes (seed customers
  // use the reserved 61500055xx phone range so the prior batch is cleaned first).
  demo_dispatch_seed: `do $seed$
    declare v_co uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_c uuid; v_u uuid;
      d0 date := current_date; d1 date := current_date+1; d2 date := current_date+2; d3 date := current_date+3;
    begin
      select id into v_co from company where slug='demo' limit 1;
      if v_co is null then return; end if;
      -- clean any prior seed (jobs -> units -> customers, matched by the reserved phone range)
      delete from job where company_id=v_co and source='dispatch_seed';
      delete from unit where company_id=v_co and customer_id in (select id from customer where company_id=v_co and phone like '61500055%');
      delete from customer where company_id=v_co and phone like '61500055%';
      -- ensure 4 demo techs with service zones (display-only rows; select-by-name so re-run won't dup)
      select id into v_t1 from technician where company_id=v_co and lower(name) like 'joey%' order by created_at limit 1;
      if v_t1 is null then insert into technician(company_id,name,active,service_area) values(v_co,'Joey Grover',true,'370,371') returning id into v_t1; else update technician set service_area='370,371', active=true where id=v_t1; end if;
      select id into v_t2 from technician where company_id=v_co and lower(name) like 'demo tech%' order by created_at limit 1;
      if v_t2 is null then insert into technician(company_id,name,active,service_area) values(v_co,'Demo Tech',true,'372,373') returning id into v_t2; else update technician set service_area='372,373', active=true where id=v_t2; end if;
      select id into v_t3 from technician where company_id=v_co and name='Marcus Lee' order by created_at limit 1;
      if v_t3 is null then insert into technician(company_id,name,active,service_area) values(v_co,'Marcus Lee',true,'370,380') returning id into v_t3; end if;
      select id into v_t4 from technician where company_id=v_co and name='Andre Boyd' order by created_at limit 1;
      if v_t4 is null then insert into technician(company_id,name,active,service_area) values(v_co,'Andre Boyd',true,'371,384') returning id into v_t4; end if;

      -- ── SCHEDULED (6, across the 4 techs + next few days) ─────────────────────────────
      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Donna','Pierce','6150005501','812 Bell Rd','Antioch','TN','37013') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Whirlpool refrigerator','refrigerator','{"brand":"Whirlpool","model":"WRF535SWHZ"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,scheduled_day,technician_id,source) values(v_co,v_c,v_u,'scheduled','Refrigerator not cooling',d0,v_t1,'dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Marcus','Webb','6150005502','1907 Nolensville Pike','Nashville','TN','37211') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Maytag dryer','dryer','{"brand":"Maytag","model":"MEDC465HW"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,scheduled_day,technician_id,source) values(v_co,v_c,v_u,'scheduled','Dryer not heating',d1,v_t1,'dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Rebecca','Alvarez','6150005503','340 W Northfield Blvd','Murfreesboro','TN','37130') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'LG dishwasher','dishwasher','{"brand":"LG","model":"LDFN4542"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,scheduled_day,technician_id,source) values(v_co,v_c,v_u,'scheduled','Dishwasher won''t drain',d0,v_t2,'dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Kevin','Tran','6150005504','215 Sam Ridley Pkwy','Smyrna','TN','37167') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Samsung washer','washer','{"brand":"Samsung","model":"WF45T6000AW"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,scheduled_day,technician_id,source) values(v_co,v_c,v_u,'scheduled','Washer stops mid-cycle',d2,v_t2,'dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Sara','Bennett','6150005505','120 4th Ave S','Franklin','TN','37064') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'GE oven','oven','{"brand":"GE","model":"JB645RKSS"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,scheduled_day,technician_id,source) values(v_co,v_c,v_u,'scheduled','Oven not reaching temp',d1,v_t3,'dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'James','Holloway','6150005506','4012 Lebanon Pike','Hermitage','TN','37076') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Frigidaire refrigerator','refrigerator','{"brand":"Frigidaire","model":"FFHB2750TS"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,scheduled_day,technician_id,parts_status,parts_eta,source) values(v_co,v_c,v_u,'awaiting_parts','Ice maker not working — part on order',d2,v_t4,'ordered',current_date+3,'dispatch_seed');

      -- ── NEEDS SCHEDULING (4, no tech / no day) ────────────────────────────────────────
      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Latoya','Green','6150005507','528 Harding Pl','Nashville','TN','37211') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Whirlpool washer','washer','{"brand":"Whirlpool","model":"WTW5000DW"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,availability,source) values(v_co,v_c,v_u,'new','Washer won''t drain','Mornings this week','dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Derek','Foster','6150005508','3137 Skinner Dr','Antioch','TN','37013') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'KitchenAid dishwasher','dishwasher','{"brand":"KitchenAid","model":"KDTM404KPS"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,source) values(v_co,v_c,v_u,'new','Dishwasher leaking','dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Angela','Ruiz','6150005509','5310 Murfreesboro Rd','La Vergne','TN','37086') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Samsung dryer','dryer','{"brand":"Samsung","model":"DVE45T6100W"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,warranty_company,claim_number,availability,source) values(v_co,v_c,v_u,'new','Dryer making loud noise','AHS','61658400','Any weekday afternoon','dispatch_seed');

      insert into customer(company_id,first_name,last_name,phone,address,city,state,zip) values(v_co,'Nathan','Cole','6150005510','330 Franklin Rd','Brentwood','TN','37027') returning id into v_c;
      insert into unit(company_id,customer_id,label,kind,attributes) values(v_co,v_c,'Bosch dishwasher','dishwasher','{"brand":"Bosch","model":"SHEM63W55N"}'::jsonb) returning id into v_u;
      insert into job(company_id,customer_id,unit_id,status,problem,source) values(v_co,v_c,v_u,'new','Dishwasher not cleaning dishes','dispatch_seed');
    end $seed$;`,

  // A shop-offered HOLD is for a specific TECH + day (so it shows in that tech's column, ghosted).
  // Add technician_id to schedule_offer + book the held tech when the customer accepts the offer.
  schedule_offer_tech: `alter table public.schedule_offer add column if not exists technician_id uuid references public.technician(id) on delete set null;
create or replace function public.portal_respond_offer(p_token uuid, p_offer_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record; o record; lbl text;
begin
  select * into g from public.portal_grant where token=p_token and not revoked and (expires_at is null or expires_at>now());
  if not found then return jsonb_build_object('ok',false,'error','link expired'); end if;
  select * into o from public.schedule_offer where id=p_offer_id and company_id=g.company_id and customer_id=g.customer_id and direction='shop' and status='pending';
  if not found then return jsonb_build_object('ok',false,'error','offer not found'); end if;
  lbl := to_char(o.proposed_day,'Dy, Mon DD') || ' · ' || (case coalesce(o.win,'any') when 'am' then 'mornings' when 'pm' then 'afternoons' else 'anytime' end);
  if p_accept then
    update public.schedule_offer set status='accepted', decided_at=now() where id=o.id;
    update public.job set scheduled_day=o.proposed_day, technician_id=coalesce(o.technician_id, technician_id), status = case when status in ('new','') then 'scheduled' else status end where id=o.job_id;
    update public.schedule_offer set status='withdrawn', decided_at=now() where job_id=o.job_id and status='pending' and id<>o.id;
    insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body) values (g.company_id, g.customer_id, o.job_id, 'in', 'portal', 'customer', '✅ Accepted ' || lbl);
  else
    update public.schedule_offer set status='declined', decided_at=now() where id=o.id;
    insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body) values (g.company_id, g.customer_id, o.job_id, 'in', 'portal', 'customer', '🙅 Passed on ' || lbl);
  end if;
  return jsonb_build_object('ok',true);
end $fn$;
grant execute on function public.portal_respond_offer(uuid, uuid, boolean) to anon, authenticated;`,

  // Demo the scheduling handshake: one CUSTOMER request (shows in the dispatch inbox) + one shop HOLD
  // (ghosted in a tech's column). Idempotent — clears prior demo offers first. Re-run to reset.
  demo_handshake_seed: `do $h$
    declare v_co uuid; v_joey uuid; v_latoya_job uuid; v_latoya_c uuid; v_derek_job uuid; v_derek_c uuid;
    begin
      select id into v_co from company where slug='demo' limit 1;
      if v_co is null then return; end if;
      delete from schedule_offer where company_id=v_co and created_by like 'demo\\_%';
      select id into v_joey from technician where company_id=v_co and lower(name) like 'joey%' order by created_at limit 1;
      select j.id, j.customer_id into v_latoya_job, v_latoya_c from job j join customer c on c.id=j.customer_id where j.company_id=v_co and c.phone='6150005507' and j.status not in ('completed','canceled') order by j.created_at desc limit 1;
      select j.id, j.customer_id into v_derek_job, v_derek_c from job j join customer c on c.id=j.customer_id where j.company_id=v_co and c.phone='6150005508' and j.status not in ('completed','canceled') order by j.created_at desc limit 1;
      if v_latoya_job is not null then
        insert into schedule_offer(company_id,job_id,customer_id,direction,proposed_day,win,note,status,created_by)
          values(v_co,v_latoya_job,v_latoya_c,'customer',current_date+2,'am','Kids at school after 9 — mornings best','pending','demo_customer');
      end if;
      if v_derek_job is not null then
        insert into schedule_offer(company_id,job_id,customer_id,direction,proposed_day,win,technician_id,status,created_by)
          values(v_co,v_derek_job,v_derek_c,'shop',current_date+3,'pm',v_joey,'pending','demo_shop');
      end if;
    end $h$;`,

  // Teach the call resolver to surface the best PART's source + route + ETA (from job_part), so
  // Ann can answer "when are my parts coming?" with "shipping from American Home Shield, ETA …".
  // CREATE OR REPLACE the same SECURITY DEFINER resolver, adding part_source/part_ship_to/part_eta.
  call_brain_parts: `create or replace function public.platform_call_lookup(
      p_company_id uuid, p_phone text default null, p_claim text default null, p_name text default null
    ) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
    declare
      v_last10  text := right(regexp_replace(coalesce(p_phone,''), '\\D', '', 'g'), 10);
      v_claim   text := regexp_replace(coalesce(p_claim,''), '\\s', '', 'g');
      v_cust_id uuid; v_first text; v_last text; v_phone text;
      v_job_id  uuid; v_matched text; v_count int := 0; v_job jsonb;
      v_p_source text; v_p_ship text; v_p_eta date;
    begin
      if length(v_last10) >= 7 then
        select c.id, c.first_name, c.last_name, c.phone into v_cust_id, v_first, v_last, v_phone
          from customer c where c.company_id = p_company_id
            and right(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g'), 10) = v_last10
          order by c.id limit 1;
        if v_cust_id is not null then v_matched := 'phone'; end if;
      end if;
      if v_cust_id is null and v_claim <> '' then
        select j.customer_id, j.id into v_cust_id, v_job_id from job j
          where j.company_id = p_company_id
            and regexp_replace(coalesce(j.claim_number,''), '\\s', '', 'g') = v_claim
          order by j.created_at desc limit 1;
        if v_cust_id is not null then
          select c.first_name, c.last_name, c.phone into v_first, v_last, v_phone from customer c where c.id = v_cust_id;
          v_matched := 'claim';
        end if;
      end if;
      if v_cust_id is null and btrim(coalesce(p_name,'')) <> '' then
        select c.id, c.first_name, c.last_name, c.phone into v_cust_id, v_first, v_last, v_phone
          from customer c where c.company_id = p_company_id
            and lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) like '%' || lower(btrim(p_name)) || '%'
          order by c.id limit 1;
        if v_cust_id is not null then v_matched := 'name'; end if;
      end if;
      if v_cust_id is null then
        return jsonb_build_object('ok', true, 'found', false, 'matched_by', null);
      end if;
      if v_job_id is null then
        select j.id into v_job_id from job j
          where j.company_id = p_company_id and j.customer_id = v_cust_id
          order by (case when j.status not in ('completed','canceled') then 0 else 1 end), j.created_at desc
          limit 1;
      end if;
      select count(*) into v_count from job j where j.company_id = p_company_id and j.customer_id = v_cust_id;
      if v_job_id is not null then
        -- best part to speak about: prefer one with an ETA (soonest), else the newest logged.
        select jp.source, jp.ship_to, jp.eta into v_p_source, v_p_ship, v_p_eta
          from job_part jp where jp.job_id = v_job_id
          order by (jp.eta is null), jp.eta asc, jp.created_at desc limit 1;
        select jsonb_build_object(
          'id', j.id, 'status', j.status, 'problem', j.problem,
          'scheduled_day', j.scheduled_day, 'scheduled_start', j.scheduled_start,
          'en_route_at', j.en_route_at, 'started_at', j.started_at, 'completed_at', j.completed_at,
          'tech_first', (select split_part(coalesce(t.name,''), ' ', 1) from technician t where t.id = j.technician_id),
          'unit_label', (select u.label from unit u where u.id = j.unit_id),
          'warranty_company', j.warranty_company, 'claim_number', j.claim_number,
          'dispatch_id', j.dispatch_id, 'service_window', j.service_window,
          'parts_status', j.parts_status, 'parts_eta', j.parts_eta,
          'part_source', v_p_source, 'part_ship_to', v_p_ship, 'part_eta', v_p_eta
        ) into v_job from job j where j.id = v_job_id;
      end if;
      return jsonb_build_object('ok', true, 'found', true, 'matched_by', v_matched,
        'customer', jsonb_build_object('id', v_cust_id, 'first_name', v_first, 'last_name', v_last, 'phone', v_phone),
        'job_count', v_count, 'job', v_job);
    end $fn$;`,
};

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const names = Object.keys(MIGRATIONS);
  const name = q.do || '';
  if (!name) return json(200, { ok: true, migrations: names });
  if (!MIGRATIONS[name]) return json(200, { ok: false, error: 'unknown migration', migrations: names });

  const token = await getSecret('SUPABASE_MGMT_TOKEN');
  if (!token) return json(200, { ok: false, error: 'SUPABASE_MGMT_TOKEN not vaulted' });
  const ref = refFromUrl(await getSecret('PLATFORM_SUPABASE_URL')) || 'tntbhfwitytkcoqlejwc';

  try {
    const r = await fetch(`${MGMT}/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MIGRATIONS[name] }), signal: AbortSignal.timeout(24000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json(200, { ok: false, error: 'query ' + r.status + ' ' + JSON.stringify(d).slice(0, 300) });
    return json(200, { ok: true, applied: name, sql: MIGRATIONS[name], result: d });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
