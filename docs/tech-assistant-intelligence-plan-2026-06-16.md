# Tech Assistant Intelligence Plan — "Ant that KNOWS" (captured 2026-06-16, ~midnight CT)

Make the Tech Ant Assist knowledge-GROUNDED, not a web-search guesser. The difference between
a chatbot and "the most intelligent system in appliance repair" is *what's loaded into it.*
This is the intelligence half of the north star (Ant making the tech's day easier by KNOWING).

## Source tiers (ranked by value)
1. **Our own TDR corpus — the crown jewel.** Every completed job: symptom → diagnosis → part →
   fix. Proprietary, compounding, nobody else has it. Already embedding via the EMBED_TDR chain.
   *"We've seen this exact Whirlpool VMW no-drain 4x — it was the pump, W10876XXX, 40 min."*
2. **MSA World (Marcone Servicers Association) — THE anchor authoritative source.** TN Appliance
   is a paying MEMBER → legitimate licensed access to service manuals, tech sheets, error/fault
   codes, diagnostic guides, technical bulletins. **It lives behind the Marcone login we already
   authenticate** (the Playwright session in `colony-loop/parts`). One login → parts AND the brain.
3. **Error/fault-code databases** by brand (Whirlpool F-codes, Samsung, LG, GE…). Compact, high
   value, fastest win.
4. **Tech sheets + service manuals** for our common models (the schematic-level truth).
5. **Master Samurai Tech / Appliantology METHODOLOGY** — their circuit-based diagnostic *thinking*
   shapes how Ant reasons (we learn the method even where we can't copy paid content; partnership
   is a future option, not scraping).
6. **Manufacturer service bulletins** — known failures/recalls/fixes per model.
7. **Parts finder (Marcone cost + Amazon aftermarket)** tied in — diagnosis flows straight to the
   orderable part.

## Architecture — grounded answers, not search
Curate sources → chunk + embed (OpenAI text-embedding-3-small, existing `embeddings` table /
`embed-text`) → at point of need, retrieve the most relevant chunks for THIS model + symptom →
Claude answers grounded in them, WITH citations. For MSA World: same authenticated-browser pattern
as parts — log in once, navigate to the model's tech sheet/manual, extract on demand.

## IP-clean sourcing rules (do it right)
- **Load only what we own / subscribe to / are entitled to as members.** Our manuals, our TDRs,
  public error-code refs, MSA content via our membership.
- **MSA World: on-demand, model-specific, for our own service work.** Pull the sheet for the job
  at hand; cache models we service. **Do NOT bulk-mirror their library into a redistributable copy**
  — that's the line between "using membership" and "republishing." On-demand-at-need = legitimate.
- **Master Samurai Tech / manufacturer training = paid/proprietary.** Use the *methodology* to shape
  prompting; license or PARTNER for premium content — never scrape.

## The moat
TDRs (free, proprietary, growing every job) + MSA World (member-licensed authoritative) + error
codes + methodology = a brain that gets smarter every day and that no competitor can replicate.

## Existing infra to build on
`embed-text`, `ask-ant-semantic`, `find-similar-jobs`, the `embeddings` table, the EMBED_TDR chain,
the authenticated Marcone/Playwright session (`colony-loop/parts`), the parts finder.

## Smallest high-ROI start
Error-code DB + our own TDR corpus (already embedding) + tech sheets for our top ~20 models, then
wire MSA World on-demand retrieval through the existing Marcone session. That alone makes techs go
"whoa."

(Ties to the scheduling north star: the intelligence is in service of the TECH — easier days,
fixed-first-visit, careers that grow with us.)
