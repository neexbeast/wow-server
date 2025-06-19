const mongoose = require("mongoose");

const CustomCraft = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  outputItemId: { type: Number, required: true },
  outputItemName: { type: String, required: true },
  ingredients: [{ itemId: Number, name: String, quantity: Number }],
  includeAhCut: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { collection: "custom-crafts" });

const model = mongoose.model("CustomCraft", CustomCraft);

module.exports = model; 