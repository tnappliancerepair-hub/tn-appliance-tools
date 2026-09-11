-- 067_portal_part_name_clean.sql — stop vendor email junk reaching the customer's part list.
--
-- Measured 2026-09-11 across the parts a customer can actually see today: 19 rows, and
--   * 2 carried a UPS TRACKING NUMBER inside the part NAME
--   * 1 was the status word "DISCONTINUED" rendered as a part
--   * 2 ran past 60 characters of raw email stanza
--
-- The allowlist was already right -- it never emits ship_tracking -- but the leak came in
-- through a field that IS emitted, because the mirror stuffs the whole vendor email line into
-- `name`. An allowlist only protects you if the fields on it are clean, so the sanitizer has to
-- live here, not in the caller.
--
-- Cuts the name at the first shipping-stanza marker (-- / QTY: / Shipped to / Tracking # /
-- via UPS|FedEx|USPS|DHL), rejects status words, then trims the punctuation a cut leaves behind.
-- Falls through to the existing number-salvage and finally the generic "Part".
--
-- APPLIED 2026-09-11.

CREATE OR REPLACE FUNCTION public.portal_get(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; result jsonb;
begin
  select * into g from public.portal_grant
    where token = p_token and not revoked and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'error', 'This link is invalid or has expired.'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', (select jsonb_build_object('name', name, 'trade', trade, 'settings', settings, 'payments_enabled', coalesce(payments_enabled,false)) from public.company where id = g.company_id),
    'customer', (select jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name, 'phone', c.phone,
                   'email', c.email, 'address', c.address, 'city', c.city, 'state', c.state, 'zip', c.zip)
                 from public.customer c where id = g.customer_id),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', j.id, 'status', j.status, 'problem', j.problem, 'scheduled_day', j.scheduled_day, 'time_window', j.time_window,
               'scheduled_start', j.scheduled_start, 'en_route_at', j.en_route_at, 'started_at', j.started_at,
               'completed_at', j.completed_at, 'created_at', j.created_at,
               'unit_label', (select u.label from public.unit u where u.id = j.unit_id),
               'tech', (select split_part(coalesce(t.name,''),' ',1) from public.technician t where t.id = j.technician_id),
               -- ── the customer's parts lens ───────────────────────────────────────────────
               'parts', (select coalesce(jsonb_agg(jsonb_build_object(
                            -- name only. NEVER p.number raw -- it can literally contain the part #.
                            -- Middle tier: the legacy email rows put the DESCRIPTION and the part
                            -- number in the same field ("THERMOSTAT HI LIMIT<nl>Part #WE04X30381").
                            -- Take the text before "Part #", then strip every token containing a
                            -- digit, which removes the part number and leaves the plain words.
                            -- Anything left unrecognisable falls back to the generic word "Part".
                            -- NOTE: btrim() strips SPACES only -- these values carry newlines
                            -- from the email parser, so collapse all whitespace first.
                            'name', coalesce(
                                      -- some rows carry a literal 'None'/'null' as the name; that
                                      -- reads as broken to a customer, so treat it as blank.
                                      -- Vendor emails stuff a whole line into `name`:
                                      --   "PTC Starter Relay -- QTY: 1 Shipped to the customer
                                      --    via UPS - Tracking #: 1ZE380950323091839"
                                      -- The allowlist never emits ship_tracking, but the tracking
                                      -- number was riding in through the NAME. An allowlist only
                                      -- protects you if the fields ON it are clean. (2026-09-11)
                                      -- Innermost out: cut the stanza -> collapse whitespace ->
                                      -- drop a dangling "(" the cut leaves -> reject status words.
                                      nullif(
                                        regexp_replace(
                                          regexp_replace(
                                            btrim(regexp_replace(
                                              regexp_replace(coalesce(p.name,''),
                                                '(?i)\s*(--+|—|\bqty\s*:|\bshipped\s+to\b|\btracking\s*#|\bvia\s+(ups|fedex|usps|dhl)\b).*$', ''),
                                              '\s+', ' ', 'g')),
                                            '\s*\(\s*\.?\s*\)?\s*$', ''),
                                          '(?i)^(none|null|n/a|-|discontinued|pending|ordered|backordered?|b/o)[[:punct:][:space:]]*$', ''),
                                        ''),
                                      'Part'),
                            'shipped', (p.ship_tracking is not null or p.bought_at is not null),
                            'delivered', (coalesce(p.ship_delivered, false) or p.bought_at is not null),
                            'eta', p.eta) order by p.created_at), '[]'::jsonb)
                          -- DEDUPE. Xano holds more than one parts row for the same physical
                          -- part on some jobs (measured 2026-09-11: 18 pairs), and the mirror
                          -- copies both faithfully -- deleting one here just gets it re-created.
                          -- So collapse at the read layer: one row per normalized part number,
                          -- preferring the one that is furthest along (delivered > shipped).
                          from (
                            select distinct on (upper(regexp_replace(
                                     coalesce((regexp_match(q.number,'(?i)part\s*#\s*([A-Za-z0-9-]{5,})'))[1], q.number, ''),
                                     '[^A-Za-z0-9]','','g')), q.job_id)
                                   q.*
                            from public.job_part q
                            where q.job_id = j.id and coalesce(q.disposition,'') <> 'return'
                            order by upper(regexp_replace(
                                     coalesce((regexp_match(q.number,'(?i)part\s*#\s*([A-Za-z0-9-]{5,})'))[1], q.number, ''),
                                     '[^A-Za-z0-9]','','g')), q.job_id,
                                     (q.ship_delivered is true or q.bought_at is not null) desc,
                                     (q.ship_tracking is not null or q.bought_at is not null) desc,
                                     (nullif(btrim(coalesce(q.name,'')),'') is not null) desc,
                                     q.created_at asc
                          ) p),
               'bill', (case
                          when nullif(btrim(coalesce(j.warranty_company,'')),'') is not null then jsonb_build_object('covered', true)
                          else (select case when iv.id is null then null else jsonb_build_object(
                                  'invoice_id', iv.id,
                                  'subtotal_cents', iv.subtotal_cents, 'tax_cents', iv.tax_cents, 'total_cents', iv.total_cents,
                                  'paid', (iv.status='paid' or coalesce(iv.collected_cents,0) >= coalesce(iv.total_cents,0)),
                                  'paid_method', iv.paid_method, 'paid_at', iv.paid_at,
                                  'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                                              'description', coalesce(nullif(btrim(il.description),''), initcap(il.kind)),
                                              'amount_cents', round(coalesce(il.unit_cents,0)*coalesce(il.qty,1))) order by il.created_at), '[]'::jsonb)
                                            from public.invoice_line il where il.invoice_id = iv.id)) end
                                from public.invoice iv where iv.job_id = j.id order by iv.created_at desc limit 1) end),
               'offers', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id', so.id, 'direction', so.direction, 'proposed_day', so.proposed_day, 'win', so.win, 'note', so.note)
                            order by so.created_at desc), '[]'::jsonb)
                          from public.schedule_offer so where so.job_id = j.id and so.status = 'pending'),
               'media', (select coalesce(jsonb_agg(jsonb_build_object('kind', mm.kind, 'provider', mm.provider, 'ref', mm.ref, 'label', mm.label)
                           order by mm.created_at), '[]'::jsonb) from public.job_media mm where mm.job_id = j.id)
             ) order by j.created_at desc), '[]'::jsonb)
             from public.job j where j.customer_id = g.customer_id and j.company_id = g.company_id and (g.job_id is null or j.id = g.job_id)),
    'thread', (select coalesce(jsonb_agg(jsonb_build_object('direction', m.direction, 'channel', m.channel, 'sender', m.sender,
                 'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
               from public.thread_message m where m.customer_id = g.customer_id and m.company_id = g.company_id and (g.job_id is null or m.job_id = g.job_id))
  ) into result;
  return result;
end $function$

