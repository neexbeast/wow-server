const mongoose = require("mongoose");

const PriceHistory = new mongoose.Schema(
  {
    itemId: { type: Number, required: true },
    region: { type: String, required: true }, // e.g., 'eu', 'us'
    date: { type: Date, required: true }, // snapshot time
    median: { type: Number, required: true }, // in copper
    mean: { type: Number, required: true },   // in copper
    min: { type: Number, required: true },    // in copper
    max: { type: Number, required: true },    // in copper
    available: { type: Number, required: true }
  },
  { collection: "price-history" }
);

module.exports = mongoose.model("PriceHistory", PriceHistory); 