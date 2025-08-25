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
```

## Local run (dev)

Install ffmpeg + yt-dlp on your machine, then:

```bash
npm ci
cp .env.example .env   # fill values
node src/index.mjs
```

If a new video exists, it will post once and exit.

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

## Notes

- Keep teaser ≤120s for faster processing on X.
- Exactly one YouTube link in the tweet text for clean preview.
- If video upload fails, the service still posts a link-only tweet.
- To rotate secrets, update `.env` and `docker compose up -d`.

## X App checklist (fill before testing)

- App Permissions: Read and write, scopes include `tweet.write` and `media.write`.
- User authentication flow completed; you have Access Token & Access Secret for the posting account.
- Keep this app dedicated (least privilege) and rotate keys quarterly.

## YouTube feed used

For @CompoundCensoredOfficial:
`https://www.youtube.com/feeds/videos.xml?channel_id=UCnaEIU-gr43C7oL3Bzu3dGg`
