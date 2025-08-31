import fs from 'fs';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';

const FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=UCnaEIU-gr43C7oL3Bzu3dGg";

function fetch(url) {
  return new Promise((resolve, reject) => https.get(url, (res) => {
    let d=''; res.on('data', c=>d+=c); res.on('end', ()=>resolve(d));
  }).on('error', reject));
}

(async () => {
  const lastSeenId = "H0_aovRF-RY";
  console.log("Testing getUnseenVideos logic with lastSeenId:", lastSeenId);
  
  const xml = await fetch(FEED);
  const parsed = new XMLParser().parse(xml);
  
  const entries = parsed?.feed?.entry || parsed?.entry || [];
  console.log("Total entries found:", entries.length);
  
  const videos = entries
    .map(entry => ({
      title: entry.title,
      videoId: entry['yt:videoId'],
      published: entry.published
    }))
    .filter(v => v.videoId)
    .sort((a, b) => new Date(b.published) - new Date(a.published));
  
  console.log("Top 5 videos (newest first):");
  videos.slice(0, 5).forEach((v, i) => {
    console.log(`  ${i}: ${v.videoId} - ${v.title.substring(0, 50)}...`);
  });
  
  const lastSeenIndex = lastSeenId ? videos.findIndex(v => v.videoId === lastSeenId) : -1;
  console.log("lastSeenIndex:", lastSeenIndex);
  
  const unseenVideos = lastSeenIndex >= 0 
    ? videos.slice(0, lastSeenIndex)
    : videos.slice(0, 1);
  
  console.log("Unseen videos count:", unseenVideos.length);
  unseenVideos.forEach((v, i) => {
    console.log(`  ${i}: ${v.videoId} - ${v.title.substring(0, 50)}...`);
  });
})();
