const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const wf_identifiers_counter = new Schema({
    _id: { type: String },
    seq: { type: Number, default: 0 }
}, { 
    collection: "wf_identifiers_counter",
    timestamps: true 
});

const wf_identifier_counter = (conn) => conn.model("WF_IDENTIFIERS_COUNTER", wf_identifiers_counter, "wf_identifiers_counter");

module.exports = wf_identifier_counter;