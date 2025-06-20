// utils/permissionCheck.js
const permManager = require('./permManager');
const RANKS = permManager.RANKS;

/** Controlla se userId è l’Owner del server guildId */
function isOwner(userId, guildId) {
    return permManager.getOwner(guildId) === userId;
}

/** Restituisce true se userId ha rank >= requiredRank (0,1,2,3) */
function hasRequiredRank(userId, requiredRank) {
    return permManager.getRank(userId) >= requiredRank;
}

/**
 * Restituisce true se userId è Owner di guildId
 * oppure se ha rank >= requiredRank.
 * requiredRank è un numero: 0=Member,1=Officer,2=HICOM. 
 * L’Owner (3) passa sempre.
 */
function hasAccess(userId, guildId, requiredRank = RANKS.MEMBER) {
    if (isOwner(userId, guildId)) return true;
    return hasRequiredRank(userId, requiredRank);
}

module.exports = {
    isOwner,
    hasRequiredRank,
    hasAccess,
    RANKS
};