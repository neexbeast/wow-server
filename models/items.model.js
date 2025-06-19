const mongoose = require("mongoose");

const Items = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    name: { type: String, required: true, unique: true },
  },
  { collection: "items" }
);

const model = mongoose.model("ItemData", Items);

module.exports = model;
