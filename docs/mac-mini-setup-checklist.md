# Mac Mini Setup Checklist

Step-by-step guide for getting the new Mac Mini fully provisioned as a TN Appliance Exchange development workstation. Run top to bottom; estimated time end-to-end ~45-60 minutes.

---

## Section 1 — First Boot

1. Power on. Pick language (English) and region (United States).
2. **Sign in with Apple ID**: `tpivacek@gmail.com` (use existing Apple ID, or create if first time).
3. **Skip iCloud sync** when prompted — keep this machine local-only for now.
4. **Disable Siri** during setup (or in System Settings → Siri → toggle off afterward).
5. **Skip Screen Time** — not needed for a dev machine.
6. **Set timezone to Central Time** (America/Chicago):
   - System Settings → General → Date & Time → uncheck "Set time zone automatically"
   - Set manually to **Central Standard Time / Chicago**
7. **Enable dark mode**:
   - System Settings → Appearance → **Dark**
8. (Optional but recommended) **Disable wallpaper Spotlight image**: Appearance → Wallpaper → pick a static dark wallpaper to reduce visual clutter while working.

---

## Section 2 — Install Dev Tools

Open Terminal (Cmd+Space → "Terminal" → Enter).

### 2.1 — Install Xcode Command Line Tools (prereq for Homebrew)
```bash
xcode-select --install
```
GUI dialog will appear. Click "Install" and wait (~5 minutes).

### 2.2 — Install Homebrew
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
After install completes, follow the on-screen instructions to add Homebrew to PATH (it'll print 2-3 `echo` commands ending with `eval "$(/opt/homebrew/bin/brew shellenv)"` — run them exactly).

Verify:
```bash
brew --version
```

### 2.3 — Install Node + Git
```bash
brew install node
brew install git
```

Verify:
```bash
node --version    # expect v20.x or v22.x
npm --version
git --version
```

### 2.4 — Install Claude Code
```bash
npm install -g @anthropic-ai/claude-code
```

Verify:
```bash
claude --version
```

If `npm install -g` fails with permission errors, use:
```bash
sudo npm install -g @anthropic-ai/claude-code
```

---

## Section 3 — Authenticate Everything

### 3.1 — Claude Code
```bash
claude
```
- Follow the on-screen auth flow.
- Pick **"Anthropic Console API key"** option (not Claude.ai login).
- Paste your API key from https://console.anthropic.com → API Keys.
- After auth, Claude Code will drop you into a prompt. Type `exit` to leave for now.

### 3.2 — Git
```bash
git config --global user.name "Teddy Pivacek"
git config --global user.email "tpivacek@gmail.com"
git config --global init.defaultBranch main
```

Verify:
```bash
git config --global --list
```

### 3.3 — Clone the repo
```bash
cd ~
mkdir -p code
cd code
git clone https://github.com/tnappliancerepair-hub/tn-appliance-tools.git
cd tn-appliance-tools
```

If the clone prompts for credentials:
- Username: your GitHub username
- Password: a GitHub Personal Access Token (NOT your password — GitHub deprecated password auth). Generate one at https://github.com/settings/tokens → Generate new token (classic) → grant `repo` scope.

### 3.4 — Netlify CLI
```bash
npm install -g netlify-cli
netlify login
```
A browser window opens for OAuth. Authorize, then return to terminal.

Verify:
```bash
netlify status
```
Should print "Logged in as Teddy Pivacek / tn appliance team".

### 3.5 — Xano CLI
```bash
npm install -g @xano/cli
```

Authenticate (one of two paths depending on what works):
```bash
xano auth
```
Follow the browser auth flow. If that errors:
```bash
xano profile add default
```
And paste the access token manually. Get the token from Xano UI → Workspace Settings → API → Generate Personal Access Token.

Verify:
```bash
xano workspace list
```
Should show `James's Workspace` (workspace id 1).

---

## Section 4 — Configure Claude Code

### 4.1 — Set the working directory
```bash
cd ~/code/tn-appliance-tools
claude
```
Claude Code starts in this directory.

### 4.2 — Copy MCP / settings from laptop
On the **laptop**, find:
```
C:\Users\jpiva\.claude\settings.json   (general settings)
C:\Users\jpiva\.claude.json            (project-level config + MCP server definitions)
```

On the **Mac Mini**, the corresponding paths are:
```
~/.claude/settings.json
~/.claude.json
```

Copy the relevant pieces — at minimum the `mcpServers` block from `.claude.json` (which has the Netlify MCP server config). Easiest path: AirDrop both files from the laptop to the Mac, then move them into place:
```bash
mkdir -p ~/.claude
mv ~/Downloads/settings.json ~/.claude/settings.json
mv ~/Downloads/.claude.json ~/.claude.json
```

Restart Claude Code (`exit` and re-run `claude`) so it picks up the new MCP config.

### 4.3 — Quick smoke test
In Claude Code, type:
```
read docs/session-2026-05-22-office-dashboards-and-payouts.md
```
You should see Claude read the file and summarize the last session. If yes, everything is wired.

---

## Section 5 — First Agents to Build

These are the next-up custom agents for the workflow. Each will live in `~/.claude/agents/` as a markdown file with frontmatter (see Claude Code agent docs).

1. **Session Scribe**
   - Auto-documents each build session into `docs/session-YYYY-MM-DD-{slug}.md`
   - Triggered at end of session by typing `/scribe` (or auto on `claude exit`)
   - Reads git log since session start, summarizes what shipped, what's pending
   - Same format as existing `session-2026-05-21-*.md` and `session-2026-05-22-*.md`

2. **Morning Standup**
   - Runs at 8am CT (via cron or Claude Code scheduled task)
   - Reads overnight `event_log` rows from Xano via Metadata API
   - Buckets: SMS sent, errors, jobs created, jobs completed, payouts processed
   - Posts summary to Teddy via SMS or email — "12 SMS, 2 errors (parts_eta_date null), 4 jobs created, 1 completed"

3. **Error Monitor**
   - Watches `event_log` for `action` values containing `_error` or `_failed`
   - Polls every ~5 minutes during business hours
   - Alerts Teddy via SMS when a new error appears, with the error metadata inline
   - Throttles: max 1 alert per error-type per hour so a recurring error doesn't spam

Each will need:
- Agent markdown definition with system prompt
- Tool permissions (Bash + Read + WebFetch for the Standup; Bash + Read for the others)
- Cron entry or scheduled trigger setup

---

## Final smoke test — full toolchain

Run these in order in Terminal. All should succeed.

```bash
cd ~/code/tn-appliance-tools
git status
git pull
node --version
claude --version
netlify status
xano workspace list
```

If all 6 succeed, the Mac Mini is fully provisioned. Open Claude Code (`claude`) and pick up where the laptop left off.

---

## Troubleshooting cheat sheet

| Symptom | Fix |
|---|---|
| `brew: command not found` after install | Source `eval "$(/opt/homebrew/bin/brew shellenv)"` in `~/.zprofile` |
| `npm: command not found` | Reinstall node: `brew reinstall node` |
| `claude` won't auth | Delete `~/.claude/credentials.json` and re-run `claude` |
| Git push asks for password every time | Use SSH instead: generate key via `ssh-keygen -t ed25519`, add public key to GitHub → Settings → SSH keys, change remote: `git remote set-url origin git@github.com:tnappliancerepair-hub/tn-appliance-tools.git` |
| MCP servers not loading | Restart Claude Code; check `~/.claude.json` syntax with `cat ~/.claude.json \| python3 -m json.tool` |
| Netlify CLI hangs on login | Use API token directly: Netlify UI → User settings → Personal access tokens → generate → `netlify env:set NETLIFY_AUTH_TOKEN <token>` |
