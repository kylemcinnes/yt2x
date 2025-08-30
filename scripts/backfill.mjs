#!/usr/bin/env node

/**
 * Backfill helper script for yt2x
 * 
 * This script allows you to reset the state to an older video ID,
 * which will cause the app to process all videos newer than that ID.
 * 
 * Usage:
 *   node scripts/backfill.mjs <video_id>
 * 
 * Example:
 *   node scripts/backfill.mjs H0_aovRF-RY
 * 
 * This will reset the state to H0_aovRF-RY, causing the app to
 * process cSTfxJSa2QY (and any other newer videos) on the next poll.
 */

import fs from 'fs';
import { execSync } from 'child_process';

const videoId = process.argv[2];

if (!videoId) {
  console.error('Usage: node scripts/backfill.mjs <video_id>');
  console.error('Example: node scripts/backfill.mjs H0_aovRF-RY');
  process.exit(1);
}

try {
  // Update the state file in the container
  execSync(`docker compose exec yt2x sh -lc 'echo "${videoId}" > /var/lib/yt2x/last.txt'`, { stdio: 'inherit' });
  
  console.log(`✅ Backfilled state to: ${videoId}`);
  console.log('The app will process all videos newer than this ID on the next poll cycle.');
  console.log('Monitor with: docker compose logs -f');
} catch (error) {
  console.error('❌ Backfill failed:', error.message);
  process.exit(1);
}
