# Security Cleanup — 2026-05-20

## Incident: live Stripe secret key exposed as Netlify env var NAME

During the v2 tech-SMS brain rollout debugging on 2026-05-20, while
investigating an AWS Lambda 4KB env-var-budget failure on
`netlify deploy --prod`, a live Stripe secret key was found set as an
env var NAME (with empty value) on the Netlify production environment
for the `superlative-naiad-233aa7` site.

The full exposed string was a `sk_live_…` key, ~107 chars long.
**Literal redacted per redact-credentials rule (rewritten 2026-05-21
during git push).** The rotated-and-revoked key value is intentionally
not committed; it lives only in the Stripe Dashboard audit log and in
the local shell history of whoever ran `netlify env:unset` on 2026-05-20.

Almost certainly a paste mistake — someone meant to set a value for a
different variable and accidentally pasted the Stripe key into the
NAME field of the New Variable form. The key was sitting in Netlify
project env config where anyone with read access to env listings (e.g.
team members, deploy logs, env exports) could see it.

## What was done

Deleted via `netlify env:unset` on 2026-05-20. Verified gone via
`netlify env:list --json --context production` — entry no longer
present. Freed ~108 bytes of env-var budget, which was the immediate
side benefit that allowed the v2 brain redeploy to succeed.

## What still needs to happen — TEDDY'S TASK

**The exposed Stripe secret key above must be rotated in the Stripe
Dashboard, regardless of the env var deletion.** Once a secret has
been visible in any system where unauthorized parties may have seen
it (Netlify env listing UI, deploy logs, env exports, etc.), treat it
as compromised and rotate it.

Claude Code does not have Stripe admin access; rotation is a
human-only step.

After rotation:

1. Generate new restricted/live key in Stripe Dashboard
2. Update `STRIPE_SECRET_KEY` env var on Netlify with the new key
   (`netlify env:set STRIPE_SECRET_KEY "<new key>" --force`) +
   redeploy
3. Revoke the old key in Stripe Dashboard
4. Skim Stripe activity for unauthorized charges in the window between
   exposure (unknown; whenever the paste mistake happened) and
   revocation timestamp

## Git history audit

Need to grep git history for the key pattern in case it was ever
committed to a tracked file. If found in any commit, scope of exposure
extends to anyone who had repo read access during that commit's
lifetime — possibly GitHub if the repo is public/has any external
collaborators.

Suggested check (run from repo root if/when a git repo exists for
this project):

```sh
git log --all -p -S "sk_live_<PREFIX-REDACTED>" --source
```

Or with ripgrep over commit blobs:

```sh
git rev-list --all --remotes | xargs -I{} git grep "sk_live_<PREFIX-REDACTED>" {}
```

Status: **pending** — `tn-appliance-tools` working directory is not a
git repo at the time of this writeup (`Is a git repository: false` per
environment check). Run the audit if/when this code is committed to
version control.
