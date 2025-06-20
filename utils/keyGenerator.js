// utils/keyGenerator.js
const crypto = require('crypto');

function makeKey() {
    return crypto.randomBytes(16).toString('hex').match(/.{1,8}/g).join('-').toUpperCase();
}

function generateKeys(n) {
    const set = new Set();
    while (set.size < n) set.add(makeKey());
    return Array.from(set);
}

module.exports = { generateKeys };