// configManager.js
const db = require('./database');

module.exports = {
    // --- Altre funzioni esistenti di configManager ---
    // get, set, delete per configurazioni specifiche se ne hai

    /**
     * Ottiene un’impostazione (JSON) per guildId e chiave key, o null se non esiste.
     * @param {string} guildId
     * @param {string} key
     * @returns {Promise<any>}
     */
    async getSetting(guildId, key) {
        const res = await db.query(
            `SELECT value FROM settings WHERE guild_id = $1 AND key = $2`,
            [guildId, key]
        );
        if (res.rowCount === 0) return null;
        return res.rows[0].value;
    },

    /**
     * Imposta un’impostazione (qualsiasi JSON-serializzabile) per guildId e key.
     * @param {string} guildId
     * @param {string} key
     * @param {any} value
     * @returns {Promise<void>}
     */
    async setSetting(guildId, key, value) {
        await db.query(
            `INSERT INTO settings (guild_id, key, value)
         VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (guild_id, key) DO UPDATE
         SET value = EXCLUDED.value`,
            [guildId, key, value]
        );
    },

    /**
     * Rimuove l’impostazione per guildId e key. Restituisce true se eliminato.
     * @param {string} guildId
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async deleteSetting(guildId, key) {
        const res = await db.query(
            `DELETE FROM settings WHERE guild_id = $1 AND key = $2`,
            [guildId, key]
        );
        return res.rowCount > 0;
    },

    // Puoi aggiungere alias se preferisci:
    // async get(guildId, key) { return this.getSetting(guildId, key); },
    // async set(guildId, key, value) { return this.setSetting(guildId, key, value); },
    // async delete(guildId, key) { return this.deleteSetting(guildId, key); },
};