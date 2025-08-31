import fs from 'fs';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';

const FEED = process.env.FEED_URL;
const statePath = './.state_last.txt';

function fetch(url) {
  return new Promise((resolve, reject) => https.get(url, (res) => {
    let d=''; res.on('data', c=>d+=c); res.on('end', ()=>resolve(d));
  }).on('error', reject));
}

(async () => {
  const last = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8').trim() : '<none>';
  console.log('WORKSPACE last.txt (mirror):', last);

  const feedXml = await fetch(FEED);
  const parsed = new XMLParser({ ignoreAttributes:false }).parse(feedXml);
  const entries = parsed?.feed?.entry || [];
  const list = entries.map(e => ({
    id: e['yt:videoId'],
    published: e.published,
    title: e.title
  }));
  console.log('Top 10 feed items:');
  for (const r of list.slice(0,10)) console.log(`${r.published}  ${r.id}  ${r.title}`);
})();
