const mongoose = require("mongoose");

const RealmName = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String }
  },
  { collection: "realm-names" }
);

const model = mongoose.model("RealmName", RealmName);
module.exports = model; 