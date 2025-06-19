const mongoose = require("mongoose");

const Realms = new mongoose.Schema(
  {
    connectedRealmId: { type: Number, required: true, unique: true },
    realmIds: [{ type: Number, required: true }]
  },
  { collection: "realms" }
);

const model = mongoose.model("Realms", Realms);
module.exports = model; 