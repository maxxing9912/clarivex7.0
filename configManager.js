// configManager.js
const db = require('./database');

module.exports = {
    /**
     * Get a JSON setting for guildId and key, or null if absent.
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
     * Set a JSON-serializable setting for guildId and key.
     * @param {string} guildId
     * @param {string} key
     * @param {any} value
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
     * Delete setting for guildId and key.
     * @param {string} guildId
     * @param {string} key
     * @returns {Promise<boolean>} whether deleted
     */
    async deleteSetting(guildId, key) {
        const res = await db.query(
            `DELETE FROM settings WHERE guild_id = $1 AND key = $2`,
            [guildId, key]
        );
        return res.rowCount > 0;
    }
};
