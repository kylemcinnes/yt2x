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

async function assertCorrectAccount() {
  if (!EXPECTED) return;
  const me = await client.v2.me();
  const actual = (me.data?.username || '').toLowerCase();
  if (actual !== EXPECTED) {
    console.error(`Refusing to post: authenticated user @${actual} != expected @${EXPECTED}`);
    process.exit(2);
  }
}

async function getLatest() {
  const res = await fetch(FEED, { headers: { 'User-Agent': 'yt2x/1.0' }});
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();
  const parsed = new XMLParser().parse(xml);
  const entry = parsed?.feed?.entry?.[0] || parsed?.entry?.[0] || parsed?.feed?.entry;
  if (!entry) throw new Error('No entries in RSS');
  const title = entry.title;
  const videoId = entry['yt:videoId'];
  if (!videoId) throw new Error('Missing yt:videoId in feed entry');
  return { title, videoId };
}

function ensureDirForState() {
  const dir = path.dirname(STATE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadAndClip(id) {
  // 1) Download mp4 (best available) as {id}.mp4
  execSync(`yt-dlp -f mp4 -o "${id}.mp4" "https://www.youtube.com/watch?v=${id}"`, { stdio: 'inherit' });
  // 2) Clip first SECS seconds to clip.mp4 (stream copy to keep it fast)
  execSync(`ffmpeg -y -ss 0 -t ${SECS} -i "${id}.mp4" -c copy clip.mp4`, { stdio: 'inherit' });
  return { original: `${id}.mp4`, clip: 'clip.mp4' };
}

async function postToX({ title, videoId, clipPath }) {
  // Chunked media upload handled by v1 helper internally.
  const mediaId = await client.v1.uploadMedia(clipPath, { type: 'video/mp4' });
  const text = `New: ${title} https://youtu.be/${videoId}`;
  await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
}

(async () => {
  await assertCorrectAccount();
  ensureDirForState();
  const { title, videoId } = await getLatest();

  const seen = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8').trim() : '';
  if (!videoId || videoId === seen) {
    process.exit(0); // nothing to do
  }

  let paths;
  try {
    paths = downloadAndClip(videoId);
    try {
      if (DRY) {
        console.log(`[DRY_RUN] Would post: New: ${title} https://youtu.be/${videoId} (with native video)`);
        fs.writeFileSync(STATE, videoId);
      } else {
        await postToX({ title, videoId, clipPath: paths.clip });
        fs.writeFileSync(STATE, videoId);
      }
    } catch (e) {
      console.error('Media upload failed, falling back to link-only tweet:', e?.message || e);
      // Fallback: post text-only with one YouTube link for card preview
      const text = `New: ${title} https://youtu.be/${videoId}`;
      if (DRY) {
        console.log(`[DRY_RUN] Would post fallback: New: ${title} https://youtu.be/${videoId}`);
        fs.writeFileSync(STATE, videoId);
      } else {
        await client.v2.tweet({ text });
        fs.writeFileSync(STATE, videoId);
      }
    }
  } finally {
    // Cleanup
    try { if (paths?.original) fs.unlinkSync(paths.original); } catch {}
    try { if (paths?.clip) fs.unlinkSync(paths.clip); } catch {}
  }
})();
