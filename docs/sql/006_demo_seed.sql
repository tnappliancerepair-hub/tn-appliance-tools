-- 006_demo_seed.sql — a one-shot DEMO shop so all three surfaces light up instantly.
-- Run AFTER 004 + 005, in the platform project's SQL editor.
--
-- FIRST: create a test login. Supabase dashboard → Authentication → Users → "Add user"
-- (email + password you'll sign in with). Copy that user's UID and paste it below.
-- Then run this whole file. It seeds one shop ("Joey's Appliance Repair"), links your
-- login as owner AND technician, and creates customers/units/jobs across statuses plus a
-- customer conversation + a portal link. Sign into office-board.html and tech.html with
-- that email/password; open the portal with the token this prints at the end.
--
-- Safe to re-run: it no-ops if the demo shop already exists. To reset, delete the demo
-- company row (cascades) and run again.

do $$
declare
  v_uid  uuid := 'PASTE-AUTH-USER-UUID-HERE';   -- ← from Authentication → Users
  v_co uuid; v_tech uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_u1 uuid; v_u2 uuid; v_u3 uuid;
  v_j2 uuid;
begin
  if v_uid = 'PASTE-AUTH-USER-UUID-HERE' then
    raise exception 'Edit v_uid first: paste your Auth user UID (Authentication → Users).';
  end if;
  if exists (select 1 from public.company where slug = 'demo') then
    raise notice 'Demo shop already seeded — skipping.';
    return;
  end if;

  insert into public.company (slug, name, trade, plan, features, settings)
    values ('demo', 'Joey''s Appliance Repair', 'appliance', 'trial',
            '{"phones":true,"database":true,"scheduling":true}'::jsonb,
            '{"phone":"615-555-0142","brand_color":"#3f8f24"}'::jsonb)
    returning id into v_co;

  insert into public.app_user (company_id, auth_user_id, role, name, phone)
    values (v_co, v_uid, 'owner', 'Joey Grover', '615-555-0142');

  insert into public.technician (company_id, app_user_id, name, phone)
    values (v_co, (select id from public.app_user where auth_user_id = v_uid and company_id = v_co),
            'Joey Grover', '615-555-0142')
    returning id into v_tech;

  -- 1) scheduled
  insert into public.customer (company_id, first_name, last_name, phone, address, city, state, zip)
    values (v_co, 'Maria', 'Lopez', '615-555-0101', '120 Oak St', 'Antioch', 'TN', '37013') returning id into v_c1;
  insert into public.unit (company_id, customer_id, kind, label, attributes)
    values (v_co, v_c1, 'appliance', 'Whirlpool refrigerator', '{"brand":"Whirlpool","model":"WRS325"}'::jsonb) returning id into v_u1;
  insert into public.job (company_id, customer_id, unit_id, technician_id, status, problem, source, scheduled_day)
    values (v_co, v_c1, v_u1, v_tech, 'scheduled', 'Fridge not cooling on the bottom shelf', 'ann_phone', current_date + 1);

  -- 2) awaiting parts (this one gets a portal link + a conversation)
  insert into public.customer (company_id, first_name, last_name, phone, address, city, state, zip)
    values (v_co, 'David', 'Chen', '615-555-0102', '88 Maple Ave', 'Nashville', 'TN', '37211') returning id into v_c2;
  insert into public.unit (company_id, customer_id, kind, label, attributes)
    values (v_co, v_c2, 'appliance', 'Samsung dryer', '{"brand":"Samsung","model":"DVE45"}'::jsonb) returning id into v_u2;
  insert into public.job (company_id, customer_id, unit_id, technician_id, status, problem, source, scheduled_day)
    values (v_co, v_c2, v_u2, v_tech, 'awaiting_parts', 'Dryer not heating — needs a heating element', 'web', current_date + 3)
    returning id into v_j2;
  insert into public.thread_message (company_id, customer_id, job_id, direction, channel, sender, body) values
    (v_co, v_c2, v_j2, 'out', 'sms', 'ann', 'Hi David — we diagnosed your Samsung dryer and the heating element is on order. We''ll text you to schedule the fix the moment it lands.'),
    (v_co, v_c2, v_j2, 'in',  'portal', 'customer', 'Sounds good, thank you! Roughly how long for the part?');

  -- 3) in progress
  insert into public.customer (company_id, first_name, last_name, phone, address, city, state, zip)
    values (v_co, 'Angela', 'Ruiz', '615-555-0103', '5 Birch Ct', 'Smyrna', 'TN', '37167') returning id into v_c3;
  insert into public.unit (company_id, customer_id, kind, label, attributes)
    values (v_co, v_c3, 'appliance', 'GE dishwasher', '{"brand":"GE","model":"GDT645"}'::jsonb) returning id into v_u3;
  insert into public.job (company_id, customer_id, unit_id, technician_id, status, problem, source, scheduled_day)
    values (v_co, v_c3, v_u3, v_tech, 'in_progress', 'Dishwasher leaking at the door', 'office', current_date);

  -- portal link for David's job
  insert into public.portal_grant (company_id, customer_id, job_id) values (v_co, v_c2, v_j2);

  raise notice 'Demo seeded. Sign into office-board.html + tech.html with your test login.';
end $$;

-- Copy this token → open /platform/portal.html?t=<token>
select pg.token as portal_token,
       c.first_name || ' ' || c.last_name as customer,
       co.name as shop
from public.portal_grant pg
join public.customer c on c.id = pg.customer_id
join public.company  co on co.id = pg.company_id
where co.slug = 'demo';
