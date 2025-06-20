const mongoose = require("mongoose");
const axios = require("axios");
const AuctionCache = require("./models/auctioncache.model");
require('dotenv').config();

const MONGO_URI = "mongodb+srv://ribarnica:carapa123321@cluster0.eoquyx7.mongodb.net/wow-companion";

let blizzardToken = null;
let blizzardTokenExpiry = 0;

async function getBlizzardAccessToken() {
  const now = Date.now();
  if (blizzardToken && now < blizzardTokenExpiry - 60000) {
    return blizzardToken;
  }
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing Blizzard API credentials');
  }
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  try {
    const response = await axios.post(
      `https://eu.battle.net/oauth/token`,
      params,
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
      }
    );
    blizzardToken = response.data.access_token;
    blizzardTokenExpiry = now + response.data.expires_in * 1000;
    return blizzardToken;
  } catch (err) {
    console.error('[Blizzard Token] Failed to fetch access token:', err.response ? err.response.data : err);
    throw err;
  }
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const region = 'eu';
  let accessToken;
  try {
    accessToken = await getBlizzardAccessToken();
  } catch (err) {
    console.error('[AuctionCache Cron] Could not get Blizzard access token. Skipping.');
    process.exit(1);
  }
  // Fetch and cache commodities
  try {
    const commoditiesUrl = `https://${region}.api.blizzard.com/data/wow/auctions/commodities`;
    const commoditiesRes = await axios.get(commoditiesUrl, {
      params: { namespace: `dynamic-${region}`, locale: 'en_US' },
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'json',
      validateStatus: () => true, // allow all statuses for logging
    });
    console.log('--- Commodities Response ---');
    console.log('Status:', commoditiesRes.status);
    console.log('Headers:', commoditiesRes.headers);
    if (typeof commoditiesRes.data === 'object') {
      const preview = JSON.stringify(commoditiesRes.data).slice(0, 500);
      console.log('Data (preview):', preview);
    } else {
      console.log('Data (raw):', String(commoditiesRes.data).slice(0, 500));
    }
    if (commoditiesRes.status !== 200) {
      throw new Error('Non-200 response from Blizzard API');
    }
    const allAuctions = commoditiesRes.data.auctions || [];
    const chunkSize = 5000;
    let docCount = 0;
    for (let i = 0; i < allAuctions.length; i += chunkSize) {
      const chunk = allAuctions.slice(i, i + chunkSize);
      await AuctionCache.create({
        type: 'commodity',
        region,
        data: chunk,
        fetchedAt: new Date(),
      });
      docCount++;
    }
    console.log(`[AuctionCache Cron] Cached ${allAuctions.length} commodities for ${region} in ${docCount} documents`);
  } catch (err) {
    console.error('[AuctionCache Cron] Error caching commodities:', err.message);
    if (err.response) {
      console.error('Error response data:', err.response.data);
    }
  }
  // Fetch and cache auctions for a set of connectedRealmIds
  const connectedRealmIds = [1305, 1379, 1406];
  for (const realmId of connectedRealmIds) {
    try {
      const auctionsUrl = `https://${region}.api.blizzard.com/data/wow/connected-realm/${realmId}/auctions`;
      const auctionsRes = await axios.get(auctionsUrl, {
        params: { namespace: `dynamic-${region}`, locale: 'en_US' },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      await AuctionCache.create({
        type: 'auction',
        region,
        connectedRealmId: realmId,
        data: auctionsRes.data.auctions || [],
        fetchedAt: new Date(),
      });
      console.log(`[AuctionCache Cron] Cached ${auctionsRes.data.auctions?.length || 0} auctions for realm ${realmId}`);
    } catch (err) {
      console.error(`[AuctionCache Cron] Error caching auctions for realm ${realmId}:`, err.message);
    }
  }
  await mongoose.disconnect();
  console.log('Done.');
}

run(); 