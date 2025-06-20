const mongoose = require("mongoose");

const AuctionCache = new mongoose.Schema({
  type: { type: String, enum: ['auction', 'commodity'], required: true },
  region: { type: String, required: true },
  connectedRealmId: { type: Number }, // only for type 'auction'
  data: { type: Array, required: true },
  fetchedAt: { type: Date, default: Date.now, index: true },
}, {
  collection: "auction-cache"
});

AuctionCache.index({ type: 1, region: 1, connectedRealmId: 1, fetchedAt: -1 });

const model = mongoose.model("AuctionCache", AuctionCache);

module.exports = model; 