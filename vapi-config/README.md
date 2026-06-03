# Vapi-as-code

The Ant phone system, version-controlled in git instead of clicked through the Vapi dashboard.

Every assistant, every tool, every phone-number routing decision lives as a JSON file in this directory. Edits flow git → Vapi via `vapi push`, not dashboard → … → ¯\_(ツ)_/¯.

## Layout

```
vapi-config/
  assistants/        # one JSON per assistant — model, voice, transcriber, tools, prompt ref
  phone-numbers/     # one JSON per number — which assistant it routes to, SMS settings
  tools/             # custom tool definitions referenced by assistants
  squads/            # multi-agent squad definitions
  prompts/           # system prompts as .md (referenced by assistants so they read clean)
```

## Commands

```bash
# One-time bootstrap — pulls current Vapi state into this directory
node scripts/vapi-pull.js

# Show diff of local files vs Vapi remote
node scripts/vapi-diff.js

# Push local files to Vapi (PATCH if id present, POST if new)
node scripts/vapi-push.js

# Push a single artifact
node scripts/vapi-push.js --only assistants/ant_csc_inbound.json

# List what's in Vapi today
node scripts/vapi-list.js
```

## Setup (one-time)

Add `VAPI_PRIVATE_KEY` to `colony-loop/.env`. The same key currently lives in Xano env as `VAPI_PRIVATE_KEY` — copy it across once.

```
VAPI_PRIVATE_KEY=<paste here>
```

The scripts read from `colony-loop/.env` automatically.

## Field conventions

- `name` — human-readable identifier, kebab-or-snake-case, never changes after creation
- `id` — Vapi UUID, populated by `vapi-pull` or first `vapi-push`. Don't edit by hand.
- `system_prompt_file` — relative path to a `.md` file under `prompts/`. Push reads it and inlines.
- `tools` — array of names referencing files under `tools/`. Push resolves to Vapi tool IDs.

## Workflow

1. Edit local file (assistant config, prompt, tool definition)
2. `node scripts/vapi-diff.js` to preview
3. `node scripts/vapi-push.js` to apply
4. Commit + push to git
5. Future changes flow the same way — every change auditable in git history
