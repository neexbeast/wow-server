const mongoose = require("mongoose");

const User = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    quote: { type: String },
    firebaseUid: { type: String, required: true, unique: true },
    firstName: { type: String },
    lastName: { type: String },
    username: { type: String, unique: true, sparse: true },
    photoUrl: { type: String },
    customCrafts: [{
      name: { type: String, required: true },
      outputItemId: { type: Number, required: true },
      outputItemName: { type: String, required: true },
      ingredients: [{ itemId: Number, name: String, quantity: Number }],
      includeAhCut: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now }
    }],
    subscriptionTier: { type: String, enum: ['free', 'tier1', 'tier2'], default: 'free' },
    subscriptionExpiresAt: { type: Date },
  },
  { collection: "user-data" }
);

const model = mongoose.model("UserData", User);

module.exports = model;
