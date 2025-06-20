// utils/setupManager.js

const db = require('../database'); // your Pool-wrapper

function parseJSON(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

module.exports = {
    // Main config
    async getConfig(guildId) {
        // console.log(`[setupManager] getConfig for guild ${guildId}`);
        const res = await db.query(
            `SELECT data FROM configs WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) {
            return {
                groupId: null,
                premiumKey: null,
                roleBindings: [],
                verificationRoleId: null,
                unverifiedRoleId: null,
                bypassRoleId: null
            };
        }
        return parseJSON(res.rows[0].data, {});
    },

    async setConfig(guildId, config) {
        // console.log(`[setupManager] setConfig for guild ${guildId}:`, config);
        // clear any pending on write
        await this.clearPendingSetup(guildId);
        await this.clearPendingTransfer(guildId);

        const data = JSON.stringify({
            groupId: config.groupId ?? null,
            premiumKey: config.premiumKey ?? null,
            roleBindings: config.roleBindings ?? [],
            verificationRoleId: config.verificationRoleId ?? null,
            unverifiedRoleId: config.unverifiedRoleId ?? null,
            bypassRoleId: config.bypassRoleId ?? null
        });

        await db.query(
            `INSERT INTO configs (guild_id, data)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
            [guildId, data]
        );
    },

    // Pending setup
    async setPendingSetup(guildId, data) {
        console.log(`[setupManager] setPendingSetup for guild ${guildId}:`, data);
        const payload = JSON.stringify(data);
        await db.query(
            `INSERT INTO pending_setups (guild_id, data)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
            [guildId, payload]
        );
    },

    async getPendingSetup(guildId) {
        console.log(`[setupManager] getPendingSetup for guild ${guildId}`);
        const res = await db.query(
            `SELECT data FROM pending_setups WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) {
            console.log(`[setupManager] getPendingSetup: none for guild ${guildId}`);
            return null;
        }
        const parsed = parseJSON(res.rows[0].data, null);
        console.log(`[setupManager] getPendingSetup: returning`, parsed);
        return parsed;
    },

    async clearPendingSetup(guildId) {
        console.log(`[setupManager] clearPendingSetup for guild ${guildId}`);
        await db.query(
            `DELETE FROM pending_setups WHERE guild_id = $1`,
            [guildId]
        );
    },

    // Pending transfer (if used)
    async setPendingTransfer(guildId, data) {
        console.log(`[setupManager] setPendingTransfer for guild ${guildId}:`, data);
        const payload = JSON.stringify(data);
        await db.query(
            `INSERT INTO pending_transfers (guild_id, data)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
            [guildId, payload]
        );
    },

    async getPendingTransfer(guildId) {
        console.log(`[setupManager] getPendingTransfer for guild ${guildId}`);
        const res = await db.query(
            `SELECT data FROM pending_transfers WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) {
            console.log(`[setupManager] getPendingTransfer: none for guild ${guildId}`);
            return null;
        }
        const parsed = parseJSON(res.rows[0].data, null);
        console.log(`[setupManager] getPendingTransfer: returning`, parsed);
        return parsed;
    },

    async clearPendingTransfer(guildId) {
        console.log(`[setupManager] clearPendingTransfer for guild ${guildId}`);
        await db.query(
            `DELETE FROM pending_transfers WHERE guild_id = $1`,
            [guildId]
        );
    },

    // Lookups by groupId
    async findGuildByGroupId(groupId) {
        const res = await db.query(
            `SELECT guild_id FROM configs WHERE (data->>'groupId') = $1`,
            [groupId]
        );
        return res.rowCount ? res.rows[0].guild_id : null;
    },

    async findPendingGuildByGroupId(groupId) {
        const res = await db.query(
            `SELECT guild_id FROM pending_setups WHERE (data->>'groupId') = $1`,
            [groupId]
        );
        return res.rowCount ? res.rows[0].guild_id : null;
    }
};
