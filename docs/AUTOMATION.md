# Automation & Deployment Guide

The daily pipeline: **collect → LLM score → bilingual briefing → publish → Feishu**,
driven by a launchd job on the Mac at **12:00**, publishing to a China-reachable
URL on a Shanghai cloud host.

```
12:00 launchd ──► daily-scan.sh ──► scan:daily (collect)
                                  └► codex exec (7-dim scoring → SQLite)
                                  └► daily-digest.ts (zh/en briefing → daily/)
                                  └► build-site.ts   (→ site/)
                                  └► git push        (daily/ archive on GitHub)
                                  └► rsync site/     (→ Shanghai cloud)
                                  └► lark-cli        (Feishu summary + 国内链接)
```

## 1. Mac side (the runner)

The launchd job runs a clean clone at `~/.local/share/smart-programs`, mirroring
the `tony-articles` pattern (build copy separate from the desktop dev copy).

```bash
# clone the private repo into the runtime location
git clone git@github.com:shengdabai/Small-yet-smart-programs.git ~/.local/share/smart-programs
cd ~/.local/share/smart-programs
bun install
cp config/profile.example.json config/profile.local.json   # then edit with your real profile
bun run init

# install the launchd job (replace placeholders first)
sed -e "s/__USER__/$USER/g" \
    -e "s|__CODEX_BIN__|$(command -v codex)|g" \
    -e "s/__FEISHU_OPEN_ID__/<your-feishu-dm-open_id>/g" \
    deploy/com.smart-programs.daily.plist > ~/Library/LaunchAgents/com.smart-programs.daily.plist
launchctl load ~/Library/LaunchAgents/com.smart-programs.daily.plist
```

- Logs: `~/.claude/logs/smart-programs-daily.log`
- Manual run: `bash ~/.local/share/smart-programs/daily-scan.sh`
- Scoring-only probe: `bash ~/.local/share/smart-programs/daily-scan.sh --score-only`
- Force re-run: `rm ~/.claude/logs/.smart-programs-done-$(date +%F)` then run manually
- Idempotent: one confirmed success per day (done-marker); 12:30 and 13:00 are backstop retries.
- Delivery-aware: the done-marker is written only after build, Git push, Shanghai deploy, and Feishu delivery all return confirmed success.
- Failure-aware: hard failures send one deduplicated Feishu alert; scoring/source failures are surfaced as a degraded-mode note in the delivered briefing.

## 2. Shanghai cloud (the publisher)

```bash
# on the Shanghai host (SSH alias `shanghai`)
sudo mkdir -p /var/www/smart-programs && sudo chown ubuntu:ubuntu /var/www/smart-programs
sudo cp deploy/smart-programs-site.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now smart-programs-site
```

⚠️ **Open port 8082/TCP inbound in the Tencent Cloud console** (the security
group). Port 8080 is already taken by another site on this host, so this project
uses **8082**. Bare IP + non-80 port means no ICP filing is required.

Public URL: `http://YOUR_SERVER:8082/latest.html` (and `/index.html` for the
archive timeline).

## 3. Feishu push

`daily-scan.sh` sends a Chinese summary + the 国内 URL via `hermes send`
(the same reliable channel `tony-articles` uses). Set `FEISHU_TARGET` in the
launchd plist as `feishu:oc_xxxx` (your Feishu DM). The send command is:

```bash
"$HOME/.local/bin/hermes" send -t "$FEISHU_TARGET" "<message>"
```

The send step is non-fatal (logs and continues) so it never blocks publishing.
If `hermes` is unavailable, leave `FEISHU_TARGET` empty to skip the push.

## 4. Config

| Env var | Default | Meaning |
|---------|---------|---------|
| `SMART_PROGRAMS_DIR` | `~/.local/share/smart-programs` | runtime repo location |
| `SITE_URL` | `http://YOUR_SERVER:8082` | public site root (used in Feishu msg) |
| `SHANGHAI_DEST` | `shanghai:/var/www/smart-programs` | rsync target (SSH alias) |
| `FEISHU_TARGET` | _(empty)_ | your Feishu DM open_id; empty = skip push |
| `CODEX_BIN` | discovered from `PATH` | absolute Codex CLI path for launchd |

## 5. Troubleshooting

- **Nothing published**: check `smart-programs-daily.log`; verify `bun` on PATH.
- **国内打不开**: confirm 8082 is open in the Tencent console and the systemd
  service is `active` (`ssh shanghai systemctl status smart-programs-site`).
- **No scores**: the `codex exec` step may have hit a usage limit — existing
  scores are still used; the briefing degrades gracefully.
- **rsync fails**: confirm the `shanghai` SSH alias resolves (`ssh shanghai true`).
