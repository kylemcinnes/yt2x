# YouTube Hardening Fixes - Implementation Summary

## Problem
Your yt2x service was encountering classic YouTube hardening issues:
- **Precondition check failed** + **nsig extraction failed**
- **HTTP Error 403: Forbidden** on actual file downloads

This happens when YouTube flips player signatures and/or applies age/geo/session gating.

## Solution Implemented

### A) Fresh yt-dlp Nightly Builds + Self-Update

**Dockerfile Changes:**
- Replaced packaged yt-dlp with nightly build from GitHub
- Nightly builds include the newest signature extractors
- Added automatic self-update before each download

**Code Changes in `src/index.mjs`:**
```javascript
// Self-update yt-dlp to nightly (harmless if already current)
try { execSync('yt-dlp -U --update-to nightly', { stdio: 'inherit' }); } catch {}
```

### B) Optional Cookies Support

**Docker Compose Changes:**
- Added volume mount: `./cookies:/cookies:ro`
- Cookies directory mounted read-only into container

**Code Changes in `src/index.mjs`:**
```javascript
// Cookies and User-Agent for robust downloads
const COOKIES = fs.existsSync('/cookies/youtube.txt') ? '--cookies /cookies/youtube.txt' : '';
const UA = '--user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"';

const dlCmd = (status === 'is_live')
  ? `yt-dlp ${UA} ${COOKIES} --live-from-start -N 4 -o "${id}.mp4" "${url}"`
  : `yt-dlp ${UA} ${COOKIES} -f "bv*[ext=mp4]+ba[ext=m4a]/mp4" -o "${id}.mp4" "${url}"`;
```

**Additional Features:**
- Modern Chrome user-agent string
- Better format selection for non-live videos
- Cookies automatically detected if present

## Files Modified

1. **`Dockerfile`** - Updated to use yt-dlp nightly builds
2. **`docker-compose.yml`** - Added cookies volume mount
3. **`src/index.mjs`** - Added self-update, cookies, and user-agent support
4. **`.gitignore`** - Added cookies/*.txt to prevent committing sensitive data
5. **`README.md`** - Updated with troubleshooting section
6. **`cookies/README.md`** - Created with cookie setup instructions
7. **`scripts/setup-cookies.sh`** - Helper script for cookie setup

## Next Steps

### 1. Set Up Cookies (Recommended)
```bash
# Run the helper script
./scripts/setup-cookies.sh

# Or manually:
# 1. Install "Get cookies.txt" extension in Chrome/Brave
# 2. Log into YouTube
# 3. Export cookies to cookies/youtube.txt
```

### 2. Rebuild and Test
```bash
# Rebuild with new Dockerfile
docker compose up -d --build

# Check logs
./local-control.sh logs
```

## Expected Results

With these fixes, you should see:
- ✅ No more "nsig extraction failed" errors
- ✅ No more HTTP 403 Forbidden errors
- ✅ Downloads proceed successfully
- ✅ Automatic yt-dlp updates keep signature extractors current
- ✅ Cookies bypass age/geo/session restrictions

## Why This Works

1. **Nightly Builds**: Always have the latest signature extractors
2. **Self-Update**: Container stays current without manual intervention
3. **Cookies**: Bypass YouTube's access controls
4. **User-Agent**: Modern browser string reduces suspicion
5. **Format Selection**: Better fallback options for video formats

The combination of these fixes creates a robust system that can handle YouTube's frequent signature changes and access restrictions.
