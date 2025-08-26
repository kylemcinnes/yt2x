import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';


async function main() {
  const required = ['X_APP_KEY','X_APP_SECRET','X_ACCESS_TOKEN','X_ACCESS_SECRET'];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing ${k} in .env`);
      process.exit(1);
    }
  }
  const client = new TwitterApi({
    appKey: process.env.X_APP_KEY,
    appSecret: process.env.X_APP_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });
  try {
    const me = await client.v2.me();
    console.log(`OK as @${me.data?.username}`);
    const expected = (process.env.X_EXPECTED_USERNAME || '').toLowerCase();
    if (expected && me.data?.username?.toLowerCase() !== expected) {
      console.error(`Refusing: authenticated @${me.data?.username} != expected @${expected}`);
      process.exit(2);
    }
  } catch (e) {
    console.error('FAIL', e?.data || e?.message || e);
    process.exit(1);
  }
}
main();
