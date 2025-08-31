# yt2x — YouTube → X native teaser poster

When a new YouTube video is published, this service:
1) downloads it,
2) clips the first N seconds (default 90),
3) uploads the clip natively to X (better reach),
4) posts a tweet with **one** YouTube link to funnel views back to YouTube.

## Prereqs

- X developer app with `tweet.write` and `media.write` (user auth).
- YouTube channel **channel_id** (UC…): for @CompoundCensoredOfficial:
  `https://www.youtube.com/feeds/videos.xml?channel_id=UCnaEIU-gr43C7oL3Bzu3dGg`
- ffmpeg + yt-dlp available (Docker image installs them automatically).

## Troubleshooting: Missed Uploads

If the app appears to be missing YouTube uploads, follow this checklist:

### 1. Check Current State
```bash
docker compose exec yt2x sh -lc 'cat /var/lib/yt2x/last.txt'
```

### 2. Compare with Feed
```bash
python3 - <<'PY'
import urllib.request, xml.etree.ElementTree as ET
FEED="https://www.youtube.com/feeds/videos.xml?channel_id=UCnaEIU-gr43C7oL3Bzu3dGg"
xml = urllib.request.urlopen(FEED, timeout=20).read()
ns = {'a':'http://www.w3.org/2005/Atom','yt':'http://www.youtube.com/xml/schemas/2015'}
root = ET.fromstring(xml)
for e in root.findall('a:entry', ns)[:5]:
    vid = e.find('yt:videoId', ns).text
    pub = e.find('a:published', ns).text
    title = e.find('a:title', ns).text
    print(f"{pub} {vid} {title[:50]}...")
PY
```

### 3. Check for State File Corruption
```bash
docker compose exec yt2x sh -lc 'cat -A /var/lib/yt2x/last.txt'
```
If you see trailing `%` or other junk characters, the state file is corrupted.

### 4. Backfill Missed Videos
If videos were missed due to failures, use the backfill script:
```bash
node scripts/backfill.mjs <older_video_id>
```

### 5. Verify Batch Processing
The app should show logs like:
- `Found X unseen video(s). Processing oldest to newest...`
- `Processing video: <id> - <title>`
- `Successfully posted: <id>` (only on success)
- `Post failed for <id>: <error>` (on failure, state not advanced)

### 6. Check for X API Failures
Look for these error patterns in logs:
- `Native video tweet failed: Request failed with code 404`
- `Post failed for <id>: <error>`

If you see failures, the app will retry on the next poll cycle (state not advanced).

**CRITICAL**: If X API credentials are invalid/expired, enable link-only fallback:
```bash
# In .env, set:
ALLOW_LINK_FALLBACK=1
```
This allows the app to post link-only tweets when video uploads fail, preventing missed videos.

## Env

Copy `.env.example` → `.env` and fill:

```
FEED_URL=...
X_APP_KEY=...
X_APP_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_SECRET=...
TEASER_SECONDS=90
STATE_FILE=/var/lib/yt2x/last.txt
X_EXPECTED_USERNAME=censoreddottv
DRY_RUN=0
POLL_SECONDS=120
MAX_RETRIES=1
RETRY_DELAY_S=60
```

## Local run (dev)

Install ffmpeg + yt-dlp on your machine, then:

```bash
npm ci
cp .env.example .env   # fill values
node src/index.mjs
```

If a new video exists, it will post once and exit.

### Local 24/7 Operation (Recommended)

For continuous operation on your Mac:

#### 1. Enable Docker Desktop Auto-Start
- **Docker Desktop** → **Settings** → **General** → Check **"Start Docker Desktop when you log in"**

#### 2. Add Auto-Start Script to Login Items
```bash
# The script is already created at ~/bin/start-yt2x.sh
# Add it to Login Items: System Preferences → Users & Groups → Login Items
```

#### 3. Use the Local Control Script
```bash
# Start the service (with auto-restart)
./local-control.sh start

# Check status
./local-control.sh status

# Follow logs
./local-control.sh logs

# Force re-check for new videos
./local-control.sh force-check

# Stop service
./local-control.sh stop
```

#### 4. Service Behavior
- **Auto-restart**: Service restarts automatically if it crashes
- **Persistent state**: Video tracking persists across restarts
- **Sleep handling**: Service resumes when Mac wakes up
- **Continuous polling**: Checks YouTube every 3 minutes for new uploads

### Testing with DRY_RUN

For safe testing, set `DRY_RUN=1` in your `.env`:

```bash
# Test without posting
DRY_RUN=1 node src/index.mjs

# Test with short teaser
TEASER_SECONDS=5 node src/index.mjs
```

## Docker run (prod)

```bash
docker compose up -d --build
docker compose logs -f
```

Data volume persists STATE_FILE so we don't double-post.

### Continuous Operation

The service now runs continuously and polls every `POLL_SECONDS` (default 120s):

- **Automatic Detection**: Continuously monitors the YouTube channel RSS feed
- **Live Stream Handling**: Skips upcoming lives, waits for actual content
- **Retry Logic**: Automatically retries failed downloads with exponential backoff
- **Never Exits**: Gracefully handles errors and continues running
- **Health Monitoring**: Docker healthcheck ensures the service stays alive

### Live Stream Behavior

- **`is_upcoming`**: Service skips and retries later (no state written)
- **`is_live`**: Downloads with `--live-from-start` for live content
- **`not_live`**: Normal VOD download and processing

## Systemd (auto-restart on reboot)

```bash
sudo mkdir -p /opt/yt2x
sudo chown $USER /opt/yt2x
cp -R * /opt/yt2x
sudo cp systemd/yt2x.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yt2x
```

## GitHub Actions deploy (optional)

Add repo secrets:
- `DEPLOY_HOST` — server IP/host
- `DEPLOY_USER` — SSH user  
- `DEPLOY_SSH_KEY` — private key for that user

Push to main; Actions will pull & restart the service.

## Safety Features

- **Account Lock**: `X_EXPECTED_USERNAME=censoreddottv` ensures the service only posts to the intended account
- **DRY_RUN Mode**: Set `DRY_RUN=1` to test without actually posting (logs what would be posted)
- **Identity Verification**: Service verifies the authenticated user matches `X_EXPECTED_USERNAME` before posting

## Troubleshooting

### YouTube Signature Extraction Issues

If you encounter "Precondition check failed" or "nsig extraction failed" errors, the service now includes robust fixes:

1. **Automatic yt-dlp Updates**: Uses nightly builds with latest signature extractors
2. **Cookie Support**: Mounts browser cookies to bypass age/geo/session restrictions
3. **Modern User-Agent**: Uses current Chrome user-agent string

### Setting Up Cookies (Recommended)

To handle YouTube restrictions:

```bash
# Run the setup script
./scripts/setup-cookies.sh

# Or manually:
# 1. Install "Get cookies.txt" extension in Chrome/Brave
# 2. Log into YouTube
# 3. Export cookies to cookies/youtube.txt
# 4. Restart: docker compose up -d --build
```

### Validation Workflow

1. **Leave the service running** - it will continuously poll every 2 minutes
2. **When you see a new upload** on the YouTube channel, wait 1-2 minutes
3. **Check the X feed** for @censoreddottv - if no video appears, investigate logs:
   ```bash
   docker compose logs --tail=200
   ```

### Common Issues

- **"Live is upcoming"**: Service correctly skips upcoming streams, will retry when live starts
- **Download failures**: Service automatically retries with exponential backoff
- **Signature extraction errors**: Service now self-updates yt-dlp and uses cookies
- **Authentication errors**: Verify X credentials and `X_EXPECTED_USERNAME` match
- **Missing posts**: Check logs for error messages and fallback behavior

## Notes

- Keep teaser ≤120s for faster processing on X.
- Exactly one YouTube link in the tweet text for clean preview.
- If video upload fails, the service still posts a link-only tweet.
- To rotate secrets, update `.env` and `docker compose up -d`.
- Service runs continuously and never exits - perfect for production deployment.

## X App checklist (fill before testing)

- App Permissions: Read and write, scopes include `tweet.write` and `media.write`.
- User authentication flow completed; you have Access Token & Access Secret for the posting account.
- Keep this app dedicated (least privilege) and rotate keys quarterly.

## YouTube feed used

For @CompoundCensoredOfficial:
`https://www.youtube.com/feeds/videos.xml?channel_id=UCnaEIU-gr43C7oL3Bzu3dGg`
