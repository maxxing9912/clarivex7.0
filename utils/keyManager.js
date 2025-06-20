const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'setupConfig.json');

function load() {
    let cfg = {};
    if (fs.existsSync(FILE)) {
        try {
            cfg = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
        } catch {
            cfg = {};
        }
    }
    return {
        generatedKeys: Array.isArray(cfg.generatedKeys) ? cfg.generatedKeys : [],
        premiumUsers: typeof cfg.premiumUsers === 'object' ? cfg.premiumUsers : {}, // puoi anche rimuoverlo se vuoi
        userKeys: typeof cfg.userKeys === 'object' ? cfg.userKeys : {}
    };
}

function save(partial) {
    const base = load();
    const merged = { ...base, ...partial };
    fs.writeFileSync(FILE, JSON.stringify(merged, null, 2));
}

module.exports = {
    addGeneratedKeys(keys) {
        const cfg = load();
        cfg.generatedKeys = Array.from(new Set([...cfg.generatedKeys, ...keys]));
        save({ generatedKeys: cfg.generatedKeys });
    },

    redeemKey(userId, key) {
        const cfg = load();
        if (!cfg.generatedKeys.includes(key)) {
            return { success: false, message: 'Invalid or already redeemed key.' };
        }
        if (cfg.userKeys[userId]) {  // controllo duplicati basato su userKeys, non più premiumUsers
            return { success: false, message: 'You have already redeemed a key.' };
        }
        // Mark redeemed
        cfg.generatedKeys = cfg.generatedKeys.filter(k => k !== key);
        // NON toccare più premiumUsers qui!
        cfg.userKeys[userId] = key;
        save({
            generatedKeys: cfg.generatedKeys,
            userKeys: cfg.userKeys
        });
        return { success: true, message: 'Key redeemed successfully.' };
    },

    isPremium(userId) {
        // **NON USARE PIÙ QUESTO** nel bot, usa xpManager.isPremiumUser()
        const cfg = load();
        return Boolean(cfg.premiumUsers[userId]);
    },

    getUserKey(userId) {
        const cfg = load();
        return cfg.userKeys[userId] || null;
    },

    getGeneratedKeys() {
        return load().generatedKeys;
    }
};