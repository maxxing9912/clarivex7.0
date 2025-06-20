// utils/setupManager.js

const db = require('../database'); // il tuo modulo Pool-wrapper

// helper per serializzare/deserializzare i JSON
function parseJSON(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

module.exports = {
    // --- Configurazione principale ---
    async getConfig(guildId) {
        const res = await db.query(
            `SELECT data
         FROM configs
        WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) {
            // default
            return {
                groupId: null,
                premiumKey: null,
                roleBindings: [],
                verificationRoleId: null,
                unverifiedRoleId: null,
                bypassRoleId: null,
            };
        }
        return parseJSON(res.rows[0].data, {});
    },

    async setConfig(guildId, config) {
        // rimuovi eventuali pending
        await this.clearPendingSetup(guildId);
        await this.clearPendingTransfer(guildId);

        const data = JSON.stringify({
            groupId: config.groupId ?? null,
            premiumKey: config.premiumKey ?? null,
            roleBindings: config.roleBindings ?? [],
            verificationRoleId: config.verificationRoleId ?? null,
            unverifiedRoleId: config.unverifiedRoleId ?? null,
            bypassRoleId: config.bypassRoleId ?? null,
        });

        // upsert in PostgreSQL
        await db.query(
            `INSERT INTO configs (guild_id, data)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE
         SET data = EXCLUDED.data`,
            [guildId, data]
        );
    },

    async updateConfig(guildId, partial) {
        const existing = await this.getConfig(guildId);
        const merged = {
            groupId: partial.groupId ?? existing.groupId,
            premiumKey: partial.premiumKey ?? existing.premiumKey,
            roleBindings: partial.roleBindings ?? existing.roleBindings,
            verificationRoleId: partial.verificationRoleId ?? existing.verificationRoleId,
            unverifiedRoleId: partial.unverifiedRoleId ?? existing.unverifiedRoleId,
            bypassRoleId: partial.bypassRoleId ?? existing.bypassRoleId,
        };
        return this.setConfig(guildId, merged);
    },

    // --- Pending setup ---
    async setPendingSetup(guildId, data) {
        const payload = JSON.stringify(data);
        await db.query(
            `INSERT INTO pending_setups (guild_id, data)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE
         SET data = EXCLUDED.data`,
            [guildId, payload]
        );
    },

    async getPendingSetup(guildId) {
        const res = await db.query(
            `SELECT data
         FROM pending_setups
        WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) return null;
        return parseJSON(res.rows[0].data, null);
    },

    async clearPendingSetup(guildId) {
        await db.query(
            `DELETE FROM pending_setups WHERE guild_id = $1`,
            [guildId]
        );
    },

    // --- Pending transfer ---
    async setPendingTransfer(guildId, data) {
        const payload = JSON.stringify(data);
        await db.query(
            `INSERT INTO pending_transfers (guild_id, data)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE
         SET data = EXCLUDED.data`,
            [guildId, payload]
        );
    },

    async getPendingTransfer(guildId) {
        const res = await db.query(
            `SELECT data
         FROM pending_transfers
        WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) return null;
        return parseJSON(res.rows[0].data, null);
    },

    async clearPendingTransfer(guildId) {
        await db.query(
            `DELETE FROM pending_transfers WHERE guild_id = $1`,
            [guildId]
        );
    },

    // --- Verifica esistenza gruppo già configurato altrove ---
    async findGuildByGroupId(groupId) {
        const res = await db.query(
            `SELECT guild_id
         FROM configs
        WHERE (data->>'groupId')::text = $1`,
            [groupId]
        );
        return res.rowCount ? res.rows[0].guild_id : null;
    },

    async findPendingGuildByGroupId(groupId) {
        const res = await db.query(
            `SELECT guild_id
         FROM pending_setups
        WHERE (data->>'groupId')::text = $1`,
            [groupId]
        );
        return res.rowCount ? res.rows[0].guild_id : null;
    },

    // --- Metodi di debug / utilità ---
    async loadAllConfigs() {
        const res = await db.query(`SELECT guild_id, data FROM configs`);
        return res.rows.map(r => ({ guildId: r.guild_id, config: parseJSON(r.data, {}) }));
    },

    async loadAllPendingSetups() {
        const res = await db.query(`SELECT guild_id, data FROM pending_setups`);
        return res.rows.map(r => ({ guildId: r.guild_id, pending: parseJSON(r.data, null) }));
    },

    async isGroupConfigured(groupId) {
        const gid = await this.findGuildByGroupId(groupId);
        return gid !== null;
    }
};