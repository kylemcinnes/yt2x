import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { execSync } from 'child_process';
import { TwitterApi } from 'twitter-api-v2';

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

async function waitForMediaReady(mediaId) {
  // twitter-api-v2 exposes v1.request for raw calls if needed
  for (let i = 0; i < 30; i++) {
    const info = await client.v1.get('media/upload', { command: 'STATUS', media_id: mediaId });
    const pi = info.processing_info;
    if (!pi || pi.state === 'succeeded') return;
    if (pi.state === 'failed') throw new Error(`Media processing failed: ${pi.error && pi.error.message}`);
    const delay = (pi.check_after_secs || 2) * 1000;
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('Media processing timed out');
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

async function downloadAndClip(id, secs) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const status = getLiveStatus(id);

  if (status === 'is_upcoming') {
    console.log(`[yt2x] Live is upcoming for ${id}. Will retry later.`);
    return null; // signal caller to skip but DO NOT write state
  }

  const dlCmd = (status === 'is_live')
    ? `yt-dlp --live-from-start -N 4 -o "${id}.mp4" "${url}"`
    : `yt-dlp -f mp4 -o "${id}.mp4" "${url}"`;

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
    `ffmpeg -y -ss 0 -t ${secs} -i "${id}.mp4" ` +
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

async function getLatest() {
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
    const entry = parsed?.feed?.entry?.[0] || parsed?.entry?.[0] || parsed?.feed?.entry;
    if (!entry) throw new Error('No entries in RSS');
    const title = entry.title;
    const videoId = entry['yt:videoId'];
    if (!videoId) throw new Error('Missing yt:videoId in feed entry');
    return { title, videoId };
  } catch (e) {
    throw e;
  }
}

function ensureDirForState() {
  const dir = path.dirname(STATE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}



async function postToX({ title, videoId, clipPath }) {
  // Chunked media upload handled by v1 helper internally.
  const mediaId = await client.v1.uploadMedia(clipPath, { type: 'video/mp4' });
  const text = `New: ${title} https://youtu.be/${videoId}`;
  await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
}

(async () => {
  while (true) {
    try {
      console.log(`[yt2x] Polling feed at ${new Date().toISOString()} …`);
      
      // Non-blocking identity check (allows YouTube polling to continue)
      await assertCorrectAccountNonBlocking();
      
      ensureDirForState();
      const { title, videoId } = await getLatest();
      const seen = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8').trim() : '';

      if (!videoId || videoId === seen) {
        console.log('[yt2x] No new video. Sleeping…');
        await sleep(POLL_SECONDS * 1000);
        continue;
      }

      let paths;
      try {
        paths = await downloadAndClip(videoId, SECS);
        if (!paths) {                  // upcoming live → don't write state; just wait
          await sleep(POLL_SECONDS * 1000);
          continue;
        }

        // Gate posting on identity confirmation
        if (!identityOk) {
          console.log('[yt2x] Waiting for identity confirmation; skipping post this cycle.');
          // do NOT write state, so we'll try again next poll
          await sleep(POLL_SECONDS * 1000);
          continue;
        }

        const text = `New: ${title} https://youtu.be/${videoId}`;
        try {
          if (process.env.DRY_RUN === '1') {
            console.log(`[DRY_RUN] Would post: ${text} (+ native video)`);
          } else {
            const mediaId = await client.v1.uploadMedia(paths.clip, { mimeType: 'video/mp4' });
            await waitForMediaReady(mediaId);
            await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
          }
          fs.writeFileSync(STATE, videoId);
        } catch (e) {
          try { await backoffOn429(e, 'tweet'); continue; } catch(_) {}
          // Fallback: at least post the link (but ONLY if not a live-upcoming)
          if (paths !== null) {
            const text = `New: ${title} https://youtu.be/${videoId}`;
            if (process.env.DRY_RUN === '1') {
              console.log(`[DRY_RUN] Would post fallback: ${text}`);
              fs.writeFileSync(STATE, videoId);
            } else {
              try { await client.v2.tweet({ text }); fs.writeFileSync(STATE, videoId); }
              catch (e2) { console.error('[yt2x] Fallback failed:', e2?.message || e2); }
            }
          }
        }
      } catch (e) {
        console.error('[yt2x] Post failed:', e?.message || e);
        // Fallback: at least post the link (but ONLY if not a live-upcoming)
        if (paths !== null) {
          const text = `New: ${title} https://youtu.be/${videoId}`;
          if (process.env.DRY_RUN === '1') {
            console.log(`[DRY_RUN] Would post fallback: ${text}`);
            fs.writeFileSync(STATE, videoId);
          } else {
            try { await client.v2.tweet({ text }); fs.writeFileSync(STATE, videoId); }
            catch (e2) { console.error('[yt2x] Fallback failed:', e2?.message || e2); }
          }
        }
      } finally {
        try { if (paths?.original) fs.unlinkSync(paths.original); } catch {}
        try { if (paths?.clip) fs.unlinkSync(paths.clip); } catch {}
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
