require('dotenv').config();
const express = require("express");
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/user.model");
const Items = require("./models/items.model");
const axios = require('axios');
const RealmName = require("./models/realmnames.model");
const Realms = require("./models/realms.model");
const PriceHistory = require('./models/pricehistory.model');
const schedule = require('node-schedule');
const firebaseAuth = require('./middleware/firebaseAuth');
const CustomCraft = require("./models/customcraft.model");

module.exports = User;
module.exports = Items;

app.use(cors());
app.use(express.json());

mongoose.connect(
  "mongodb+srv://ribarnica:carapa123321@cluster0.eoquyx7.mongodb.net/wow-companion"
);

// In-memory cache for auction data
const auctionCache = {}; // { [connectedRealmId]: { data: ..., timestamp: ... } }
const commoditiesCache = {}; // { [region]: { data: ..., timestamp: ... } }
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Blizzard API token management
let blizzardToken = null;
let blizzardTokenExpiry = 0;

async function getBlizzardAccessToken() {
  const now = Date.now();
  if (blizzardToken && now < blizzardTokenExpiry - 60000) {
    return blizzardToken;
  }
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  console.log('clientId', clientId);
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[Blizzard Token] BLIZZARD_CLIENT_ID or BLIZZARD_CLIENT_SECRET not set in environment.');
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

app.get(`/api/item/:imeItema`, async (req, res) => {
  const token = req.headers["x-access-token"];

  try {
    const item = await Items.find({
      name: new RegExp(req.params.imeItema, "i"),
    });
    console.log("item", item);

    return res.json({ status: "ok", item: item });
  } catch (error) {
    console.log(error);
    res.json({ status: "error", error: "invalid token" });
  }
});

app.get("/api/items/search", async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ status: "error", error: "Name parameter is required" });
    }

    const items = await Items.find({
      name: new RegExp(name, "i")
    }).limit(10);

    return res.json({ status: "ok", data: items });
  } catch (error) {
    console.error("Error searching items:", error);
    return res.status(500).json({ status: "error", error: "Internal server error" });
  }
});

app.post("/api/quote", async (req, res) => {
  const token = req.headers["x-access-token"];

  try {
    const decoded = jwt.verify(token, "secret123");
    const email = decoded.email;
    await User.updateOne({ email: email }, { $set: { quote: req.body.quote } });

    return res.json({ status: "ok" });
  } catch (error) {
    console.log(error);
    res.json({ status: "error", error: "invalid token" });
  }
});

app.get('/api/realms', async (req, res) => {
  try {
    console.log('GET /api/realms called');
    const accessToken = req.query.access_token;
    if (!accessToken) {
      console.log('No access token provided');
      return res.status(400).json({ status: 'error', error: 'Missing access token' });
    }
    const blizzardUrl = 'https://eu.api.blizzard.com/data/wow/connected-realm/index';
    const response = await axios.get(blizzardUrl, {
      params: {
        namespace: 'dynamic-eu',
        locale: 'en_US'
      },
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const connectedRealms = response.data.connected_realms;
    // Fetch details for each connected realm to get realm names
    const realmDetails = await Promise.all(
      connectedRealms.slice(0, 100).map(async (cr) => { // limit to 50 for speed
        try {
          const detailRes = await axios.get(cr.href, {
            params: {
              namespace: 'dynamic-eu',
              locale: 'en_US'
            },
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          });
          // Each connected realm can have multiple realms (e.g., merged)
          return detailRes.data.realms.map(r => ({ id: r.id, name: r.name }));
        } catch (err) {
          return [];
        }
      })
    );
    // Flatten and deduplicate by id
    const allRealms = [].concat(...realmDetails);
    const uniqueRealms = Object.values(allRealms.reduce((acc, r) => {
      acc[r.id] = r;
      return acc;
    }, {}));
    // Sort by name
    uniqueRealms.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ status: 'ok', realms: uniqueRealms });
  } catch (error) {
    if (error.response) {
      console.log('error.response', error.response);
      console.error('Blizzard API error response:', error.response.data);
    }
    console.error('Error fetching realms from Blizzard:', error.message);
    res.status(500).json({ status: 'error', error: 'Failed to fetch realms from Blizzard' });
  }
});

app.get('/api/auctions', async (req, res) => {
  try {
    const { connected_realm_id, access_token } = req.query;
    if (!connected_realm_id) {
      return res.status(400).json({ status: 'error', error: 'Missing connected_realm_id' });
    }
    // Dev override: use access_token from query if provided, else use backend token
    let token = access_token;
    if (!token) {
      try {
        token = await getBlizzardAccessToken();
      } catch (err) {
        return res.status(400).json({ status: 'error', error: 'Missing access_token and failed to get backend token' });
      }
    }
    // Check cache
    const now = Date.now();
    if (
      auctionCache[connected_realm_id] &&
      now - auctionCache[connected_realm_id].timestamp < CACHE_DURATION
    ) {
      return res.json({ status: 'ok', auctions: auctionCache[connected_realm_id].data });
    }

    // Fetch from Blizzard
    const blizzardUrl = `https://eu.api.blizzard.com/data/wow/connected-realm/${connected_realm_id}/auctions`;
    const response = await axios.get(blizzardUrl, {
      params: {
        namespace: 'dynamic-eu',
        locale: 'en_US',
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Cache and return
    auctionCache[connected_realm_id] = {
      data: response.data.auctions,
      timestamp: now,
    };
    res.json({ status: 'ok', auctions: response.data.auctions });
  } catch (error) {
    if (error.response) {
      console.error('Blizzard API error response:', error.response.data);
    }
    console.error('Error fetching auctions from Blizzard:', error.message);
    res.status(500).json({ status: 'error', error: 'Failed to fetch auctions from Blizzard' });
  }
});

// Fetch all realm names
app.get('/api/realm-names', async (req, res) => {
  try {
    const names = await RealmName.find({});
    res.json({ status: 'ok', data: names });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Failed to fetch realm names' });
  }
});

// Fetch all connected realms
app.get('/api/realm-list', async (req, res) => {
  try {
    const realms = await Realms.find({});
    res.json({ status: 'ok', data: realms });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Failed to fetch realm list' });
  }
});

// Fetch region-wide commodity auctions
app.get('/api/commodities', async (req, res) => {
  try {
    const { access_token, region } = req.query;
    const regionCode = region || 'eu';
    // Dev override: use access_token from query if provided, else use backend token
    let token = access_token;
    if (!token) {
      try {
        token = await getBlizzardAccessToken();
      } catch (err) {
        return res.status(400).json({ status: 'error', error: 'Missing access_token and failed to get backend token' });
      }
    }
    // Check cache
    const cacheKey = regionCode.toLowerCase();
    const now = Date.now();
    if (
      commoditiesCache[cacheKey] &&
      now - commoditiesCache[cacheKey].timestamp < CACHE_DURATION
    ) {
      return res.json({ status: 'ok', auctions: commoditiesCache[cacheKey].data });
    }
    const blizzardUrl = `https://${regionCode}.api.blizzard.com/data/wow/auctions/commodities`;
    const response = await axios.get(blizzardUrl, {
      params: {
        namespace: `dynamic-${regionCode}`,
        locale: 'en_US',
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    // Cache and return
    commoditiesCache[cacheKey] = {
      data: response.data.auctions,
      timestamp: now,
    };
    res.json({ status: 'ok', auctions: response.data.auctions });
  } catch (error) {
    if (error.response) {
      console.error('Blizzard API error response:', error.response.data);
    }
    console.error('Error fetching commodities from Blizzard:', error.message);
    res.status(500).json({ status: 'error', error: 'Failed to fetch commodities from Blizzard' });
  }
});

// Endpoint to fetch price history for an item
app.get('/api/price-history/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { region = 'eu', days = 7 } = req.query;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const history = await PriceHistory.find({
      itemId: Number(itemId),
      region,
      date: { $gte: since }
    }).sort({ date: 1 });
    res.json({ status: 'ok', history });
  } catch (error) {
    res.status(500).json({ status: 'error', error: 'Failed to fetch price history' });
  }
});

// Cron job to snapshot commodity prices every hour for region 'eu'
schedule.scheduleJob('0 * * * *', async () => {
  try {
    const region = 'eu';
    // Use dynamic Blizzard access token
    let accessToken;
    try {
      accessToken = await getBlizzardAccessToken();
    } catch (err) {
      console.error('[PriceHistory Cron] Could not get Blizzard access token. Skipping snapshot.');
      return;
    }
    const blizzardUrl = `https://${region}.api.blizzard.com/data/wow/auctions/commodities`;
    const response = await axios.get(blizzardUrl, {
      params: {
        namespace: `dynamic-${region}`,
        locale: 'en_US',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const auctions = response.data.auctions || [];
    // Group by itemId
    const byItem = {};
    auctions.forEach(a => {
      if (!a.item || !a.item.id) return;
      const id = a.item.id;
      if (!byItem[id]) byItem[id] = [];
      byItem[id].push(a);
    });
    const now = new Date();
    for (const itemIdStr in byItem) {
      const itemId = Number(itemIdStr);
      const group = byItem[itemId];
      const prices = group.map(a => a.unit_price ?? a.buyout ?? 0).sort((a, b) => a - b);
      const quantities = group.map(a => a.quantity ?? 0);
      const available = quantities.reduce((a, b) => a + b, 0);
      const mean = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      const median = prices.length % 2 === 0
        ? Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
        : prices[Math.floor(prices.length / 2)];
      const min = prices[0];
      const max = prices[prices.length - 1];
      await PriceHistory.create({
        itemId,
        region,
        date: now,
        median,
        mean,
        min,
        max,
        available
      });
    }
    console.log(`[PriceHistory Cron] Snapshotted ${Object.keys(byItem).length} items at ${now}`);
  } catch (err) {
    console.error('[PriceHistory Cron] Error:', err);
  }
});

// Create or update user profile after Firebase registration
app.post('/api/profile', firebaseAuth, async (req, res) => {
  try {
    const { name, password, firstName, lastName, username, photoUrl, ...extraData } = req.body;
    const firebaseUid = req.firebaseUser.uid;
    let user = await User.findOne({ firebaseUid });
    if (!user) {
      const userData = {
        firebaseUid,
        name,
        email: req.firebaseUser.email,
        firstName,
        lastName,
        username,
        photoUrl,
        ...extraData,
      };
      if (password) userData.password = password;
      user = await User.create(userData);
    } else {
      user.name = name || user.name;
      if (password) user.password = password;
      if (firstName !== undefined) user.firstName = firstName;
      if (lastName !== undefined) user.lastName = lastName;
      if (username !== undefined) user.username = username;
      if (photoUrl !== undefined) user.photoUrl = photoUrl;
      Object.assign(user, extraData);
      await user.save();
    }
    res.json({ status: 'ok', user });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Get user profile
app.get('/api/profile', firebaseAuth, async (req, res) => {
  try {
    const firebaseUid = req.firebaseUser.uid;
    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ status: 'error', error: 'User not found' });
    res.json({ status: 'ok', user });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Save or update a custom craft
app.post('/api/crafts', firebaseAuth, async (req, res) => {
  try {
    const firebaseUid = req.firebaseUser.uid;
    const { name, outputItemId, outputItemName, ingredients, includeAhCut } = req.body;
    if (!name || !outputItemId || !outputItemName || !Array.isArray(ingredients)) {
      return res.status(400).json({ status: 'error', error: 'Missing required fields' });
    }
    // Enforce craft limits by subscription tier
    const user = await User.findOne({ firebaseUid });
    const tierLimits = { free: 3, tier1: 5, tier2: Infinity };
    const userTier = user?.subscriptionTier || 'free';
    const currentCrafts = await CustomCraft.countDocuments({ userId: firebaseUid });
    if (currentCrafts >= (tierLimits[userTier] ?? 3)) {
      return res.status(403).json({ status: 'error', error: 'Craft limit reached for your subscription tier.' });
    }
    const craft = await CustomCraft.create({
      userId: firebaseUid,
      name,
      outputItemId,
      outputItemName,
      ingredients,
      includeAhCut
    });
    res.json({ status: 'ok', craft });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Get all custom crafts for the user
app.get('/api/crafts', firebaseAuth, async (req, res) => {
  try {
    const firebaseUid = req.firebaseUser.uid;
    const crafts = await CustomCraft.find({ userId: firebaseUid }).sort({ createdAt: -1 });
    res.json({ status: 'ok', crafts });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Delete a custom craft by _id
app.delete('/api/crafts/:id', firebaseAuth, async (req, res) => {
  try {
    const firebaseUid = req.firebaseUser.uid;
    const { id } = req.params;
    const craft = await CustomCraft.findOneAndDelete({ _id: id, userId: firebaseUid });
    if (!craft) return res.status(404).json({ status: 'error', error: 'Craft not found' });
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.listen(1337, () => {
  console.log("Server started on 1337");
});
