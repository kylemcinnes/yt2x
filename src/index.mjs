import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';
import { TwitterApi } from 'twitter-api-v2';

const COOKIES_FILE = '/cookies/youtube.txt';
const HAS_COOKIES = fs.existsSync(COOKIES_FILE);
const COOKIES_ARG = HAS_COOKIES ? `--cookies ${COOKIES_FILE}` : '';
const UA_ARG = '--user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"';

// Heartbeat for healthcheck
const HEARTBEAT = '/var/lib/yt2x/heartbeat';
function touchHeartbeat() {
  try {
    fs.writeFileSync(HEARTBEAT, String(Math.floor(Date.now() / 1000)));
  } catch (e) {
    console.error('[yt2x] Failed to write heartbeat:', e?.message || e);
  }
}

function ensureYtDlpOk() {
  try {
    execSync('yt-dlp --version', { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    console.error('[yt2x] yt-dlp missing/corrupt; attempting recovery...');
    try {
      execSync(
        'curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp && yt-dlp --version',
        { stdio: 'inherit' }
      );
    } catch (e) {
      console.error('[yt2x] yt-dlp recovery failed.');
      throw e;
    }
  }
}

const FEED = process.env.FEED_URL;
const SECS = Number(process.env.TEASER_SECONDS ?? 90);
const STATE = process.env.STATE_FILE || '/var/lib/yt2x/last.txt';

if (!FEED) {
  console.error('FEED_URL is required');
  process.exit(1);
}

const client = new TwitterApi({
  appKey: process.env.X_APP_KEY,
  appSecret: process.env.X_APP_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

const EXPECTED = (process.env.X_EXPECTED_USERNAME || '').toLowerCase();
const DRY = process.env.DRY_RUN === '1';

let identityOk = false;
let nextIdentityCheckAt = 0;

async function assertCorrectAccountNonBlocking() {
  if (process.env.SKIP_IDENTITY_CHECK === '1' || identityOk) return;
  const now = Date.now();
  if (now < nextIdentityCheckAt) return; // respect backoff

  try {
    const me = await client.v2.me();
    const expected = (process.env.X_EXPECTED_USERNAME || '').toLowerCase();
    const actual = (me.data?.username || '').toLowerCase();
    if (expected && expected !== actual) {
      throw new Error(`Authenticated @${actual} != expected @${expected}`);
    }
    identityOk = true;
    console.log(`[yt2x] Identity confirmed as @${me.data?.username}`);
  } catch (e) {
    const resetMs = (e?.rateLimit?.reset ? e.rateLimit.reset * 1000 : Date.now() + 15*60*1000);
    nextIdentityCheckAt = resetMs + Math.floor(Math.random() * 5000);
    const code = e?.data?.status || e?.code || 'error';
    console.warn(`[yt2x] Identity check deferred (${code}). Will retry after ${new Date(nextIdentityCheckAt).toISOString()}`);
  }
}



const POLL_SECONDS = Number(process.env.POLL_SECONDS || 120); // how often to check RSS
const MAX_RETRIES   = Number(process.env.MAX_RETRIES || 2);   // retry dl if yt-dlp hiccups
const RETRY_DELAY_S = Number(process.env.RETRY_DELAY_S || 60);

function jitter(ms) { return ms + Math.floor(Math.random() * 5000); } // +0–5s

async function backoffOn429(e, where) {
  const is429 = (e?.code === 429) || (e?.status === 429) || (e?.data?.status === 429);
  if (!is429) throw e;
  const resetMs = (e?.rateLimit?.reset * 1000) || 0;
  const now = Date.now();
  const waitMs = resetMs > now ? (resetMs - now) : (15 * 60 * 1000); // default 15 min
  const sleepMs = jitter(waitMs);
  console.warn(`[yt2x] 429 at ${where}. Sleeping ~${Math.round(sleepMs/1000)}s…`);
  await sleep(sleepMs);
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function ytdlpJson(url) {
  const out = execSync(`yt-dlp -J "${url}"`, { stdio: ['ignore','pipe','pipe'] }).toString();
  return JSON.parse(out);
}

function getLiveStatus(videoId) {
  try {
    const info = ytdlpJson(`https://www.youtube.com/watch?v=${videoId}`);
    return info.live_status || 'not_live'; // not_live | is_upcoming | is_live | was_live
  } catch {
    return 'unknown';
  }
}

function tryExec(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

async function downloadAndClip(id) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const status = getLiveStatus(id);

  if (status === 'is_upcoming') {
    console.log(`[yt2x] Live is upcoming for ${id}. Will retry later.`);
    return null; // signal caller to skip but DO NOT write state
  }

  ensureYtDlpOk();

  const URL = `https://www.youtube.com/watch?v=${id}`;
  const COMMON = `${UA_ARG} ${COOKIES_ARG} -N 8 --concurrent-fragments 8 --no-part --no-playlist`;

  let dlCmd;
  if (status === 'is_live') {
    dlCmd = `yt-dlp ${COMMON} --live-from-start -o "${id}.mp4" "${URL}"`;
  } else {
    dlCmd =
      `yt-dlp ${COMMON} ` +
      `-f "bv*[ext=mp4][vcodec^=avc1][height<=720]+ba[ext=m4a]/mp4" ` +
      `--download-sections "*0-${SECS}" ` +
      `-o "${id}.mp4" "${URL}"`;
  }

  // simple retry loop (yt-dlp can hiccup)
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      tryExec(dlCmd);
      break;
    } catch (e) {
      if (i === MAX_RETRIES) throw e;
      console.warn(`[yt2x] Download failed (attempt ${i+1}/${MAX_RETRIES+1}). Retrying in ${RETRY_DELAY_S}s…`);
      await sleep(RETRY_DELAY_S * 1000);
    }
  }

  // Transcode to X-friendly MP4 (H.264 yuv420p, AAC-LC, progressive, closed GOP)
  execSync(
    `ffmpeg -y -ss 0 -t ${SECS} -i "${id}.mp4" ` +
    `-vf "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,fps=30" ` +
    `-c:v libx264 -profile:v high -pix_fmt yuv420p -preset veryfast ` +
    `-movflags +faststart -g 60 -keyint_min 60 -sc_threshold 0 ` +
    `-c:a aac -b:a 128k -ac 2 -ar 44100 clip.mp4`,
    { stdio: 'inherit' }
  );
  return { original: `${id}.mp4`, clip: 'clip.mp4' };
}

async function assertCorrectAccount() {
  if (!EXPECTED) return;
  
  try {
    const me = await client.v2.me();
    const actual = (me.data?.username || '').toLowerCase();
    if (actual !== EXPECTED) {
      console.error(`Refusing to post: authenticated user @${actual} != expected @${EXPECTED}`);
      process.exit(2);
    }
    console.log(`[yt2x] ✅ Authenticated as @${actual}`);
  } catch (e) {
    if ((e?.code === 429) || (e?.status === 429) || (e?.data?.status === 429)) {
      console.warn(`[yt2x] Rate limited during identity check, will retry in main loop`);
      // Don't exit, let the main loop handle the 429
      return;
    }
    console.error(`[yt2x] Identity check failed:`, e?.message || e);
    process.exit(2);
  }
}

async function getUnseenVideos(lastSeenId) {
  try {
    const res = await fetch(FEED, { headers: { 'User-Agent': 'yt2x/1.0' }});
    if (!res.ok) {
      if (res.status === 429) {
        // bubble a recognizable 429
        const err = new Error('RSS rate limited');
        err.status = 429;
        throw err;
      }
      throw new Error(`RSS fetch failed: ${res.status}`);
    }
    const xml = await res.text();
    const parsed = new XMLParser().parse(xml);
    
    // Get all entries (last ~15 videos)
    const entries = parsed?.feed?.entry || parsed?.entry || [];
    if (!Array.isArray(entries)) {
      throw new Error('No entries in RSS');
    }
    
    // Convert to array of {title, videoId, published} and sort by published date (newest first)
    const videos = entries
      .map(entry => ({
        title: entry.title,
        videoId: entry['yt:videoId'],
        published: entry.published
      }))
      .filter(v => v.videoId) // filter out any malformed entries
      .sort((a, b) => new Date(b.published) - new Date(a.published)); // newest first
    
    if (videos.length === 0) {
      throw new Error('No valid video entries found');
    }
    
    // Find the index of lastSeenId in the sorted list
    const lastSeenIndex = lastSeenId ? videos.findIndex(v => v.videoId === lastSeenId) : -1;
    
    // Return all videos after the last seen one (up to 5 per cycle to avoid overwhelming)
    const unseenVideos = lastSeenIndex >= 0 
      ? videos.slice(0, lastSeenIndex) // everything before (newer than) lastSeenId
      : videos.slice(0, 1); // if no lastSeenId, just process the newest
    
    // Limit to 5 videos per cycle to avoid overwhelming the system
    return unseenVideos.slice(0, 5);
  } catch (e) {
    throw e;
  }
}

function ensureDirForState() {
  const dir = path.dirname(STATE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// --- X media processing helper (single definition) ---
async function waitForMediaReady(client, mediaId) {
  for (let i = 0; i < 40; i++) {
    const info = await client.v1.get('media/upload', { command: 'STATUS', media_id: mediaId });
    const pi = info.processing_info;
    if (!pi || pi.state === 'succeeded') return;
    if (pi.state === 'failed') throw new Error(`Media processing failed: ${pi.error?.message || 'unknown'}`);
    const delay = Math.min((pi.check_after_secs || 2), 10) * 1000;
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('Media processing timed out');
}

// --- Post to X with native video (single definition) ---
async function postToX({ title, videoId, clipPath, client }) {
  const text = `${title}\n\nWatch full on YouTube: https://youtu.be/${videoId}`;

  if (process.env.DRY_RUN === '1') {
    console.log(`[DRY_RUN] Would upload video and tweet: ${text}`);
    return;
  }

  try {
    const mediaId = await client.v1.uploadMedia(clipPath, { mimeType: 'video/mp4' });
    await waitForMediaReady(client, mediaId);
    await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
    console.log('[yt2x] Tweeted with native video.');
  } catch (e) {
    console.error('[yt2x] Native video tweet failed:', e?.data || e?.message || e);
    if (process.env.ALLOW_LINK_FALLBACK === '1') {
      try {
        await client.v2.tweet({ text });
        console.warn('[yt2x] Fallback link-only tweet posted.');
      } catch (e2) {
        console.error('[yt2x] Fallback link-only failed:', e2?.data || e2?.message || e2);
      }
    } else {
      console.warn('[yt2x] Skipping link-only fallback (set ALLOW_LINK_FALLBACK=1 to enable).');
    }
  }
}

(async () => {
  // Ensure yt-dlp is working at startup
  ensureYtDlpOk();
  
  while (true) {
    try {
      touchHeartbeat();
      console.log(`[yt2x] Polling feed at ${new Date().toISOString()} …`);
      
      // Non-blocking identity check (allows YouTube polling to continue)
      await assertCorrectAccountNonBlocking();
      
      ensureDirForState();
      const lastSeenId = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8').trim() : '';
      const unseenVideos = await getUnseenVideos(lastSeenId);

      if (unseenVideos.length === 0) {
        console.log('[yt2x] No new videos. Sleeping…');
        await sleep(POLL_SECONDS * 1000);
        continue;
      }

      console.log(`[yt2x] Found ${unseenVideos.length} unseen video(s). Processing oldest to newest...`);
      
      // Process videos from oldest to newest (reverse order)
      const videosToProcess = [...unseenVideos].reverse();
      let lastSuccessfullyProcessedId = lastSeenId;
      
      for (const { title, videoId } of videosToProcess) {
        console.log(`[yt2x] Processing video: ${videoId} - ${title}`);
        
        let paths;
        try {
          paths = await downloadAndClip(videoId);
          if (!paths) {                  // upcoming live → don't write state; just wait
            console.log(`[yt2x] Skipping upcoming live: ${videoId}`);
            continue;
          }

          // Gate posting on identity confirmation
          if (!identityOk) {
            console.log('[yt2x] Waiting for identity confirmation; skipping post this cycle.');
            // do NOT write state, so we'll try again next poll
            break; // exit the video processing loop
          }

          try {
            await postToX({ title, videoId, clipPath: paths.clip, client });
            lastSuccessfullyProcessedId = videoId; // only advance state on successful post
            console.log(`[yt2x] Successfully posted: ${videoId}`);
          } catch (e) {
            try { await backoffOn429(e, 'tweet'); break; } catch(_) {}
            console.error(`[yt2x] Post failed for ${videoId}:`, e?.message || e);
            // Don't advance state on post failure - will retry next poll
            break; // exit the video processing loop on post failure
          }
        } catch (e) {
          console.error(`[yt2x] Download/process failed for ${videoId}:`, e?.message || e);
          // Don't advance state on download failure - will retry next poll
          break; // exit the video processing loop on download failure
        } finally {
          try { if (paths?.original) fs.unlinkSync(paths.original); } catch {}
          try { if (paths?.clip) fs.unlinkSync(paths.clip); } catch {}
        }
      }
      
      // Only update state file if we successfully processed at least one video
      if (lastSuccessfullyProcessedId !== lastSeenId) {
        fs.writeFileSync(STATE, lastSuccessfullyProcessedId);
        console.log(`[yt2x] Updated state to: ${lastSuccessfullyProcessedId}`);
      }

      await sleep(POLL_SECONDS * 1000);
    } catch (e) {
      if ((e?.status === 429) || (e?.code === 429) || (e?.data?.status === 429)) {
        await backoffOn429(e, 'RSS/X');
        continue;
      }
      console.error('[yt2x] Fatal loop error:', e?.message || e);
      await sleep(jitter(POLL_SECONDS * 1000));
    }
  }
})();
