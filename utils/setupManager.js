const db = require('../database');
let quick = null;

try {
    quick = require('../utils/quickdb');
    console.log('[setupManager] QuickDB fallback enabled.');
} catch {
    console.log('[setupManager] No QuickDB fallback.');
    quick = null;
}

function parseJSON(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
}

module.exports = {
    async getConfig(guildId) {
        console.log(`[setupManager] getConfig for guild ${guildId}`);
        const SQL = `SELECT data FROM configs WHERE guild_id::text = $1`;
        try {
            const res = await db.query(SQL, [String(guildId)]);
            console.log(`[setupManager] Postgres returned ${res.rowCount} rows`);
            if (res.rowCount > 0) {
                const data = parseJSON(res.rows[0].data, {});
                console.log('[setupManager] getConfig(Postgres):', data);
                return data;
            }
        } catch (err) {
            console.error('[setupManager] getConfig Postgres error:', err);
        }

        if (quick && typeof quick.get === 'function') {
            console.log(`[setupManager] Checking QuickDB for guild ${guildId}`);
            try {
                const legacy = await quick.get(`config_${guildId}`);
                if (legacy) {
                    console.log('[setupManager] Found legacy:', legacy);
                    const payload = {
                        groupId: legacy.groupId ?? null,
                        premiumKey: legacy.premiumKey ?? null,
                        roleBindings: legacy.roleBindings ?? [],
                        verificationRoleId: legacy.verificationRoleId ?? null,
                        unverifiedRoleId: legacy.unverifiedRoleId ?? null,
                        bypassRoleId: legacy.bypassRoleId ?? null
                    };
                    await db.query(
                        `INSERT INTO configs (guild_id, data)
                         VALUES ($1, $2)
                         ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                        [guildId, JSON.stringify(payload)]
                    );
                    try { await quick.delete(`config_${guildId}`); } catch {}
                    return payload;
                }
            } catch (err) {
                console.error('[setupManager] QuickDB error:', err);
            }
        }

        console.log('[setupManager] Returning default configura­tion');
        return { groupId: null, premiumKey: null, roleBindings: [], verificationRoleId: null, unverifiedRoleId: null, bypassRoleId: null };
    },

    async setConfig(guildId, config) {
        console.log(`[setupManager] setConfig for guild ${guildId}`, config);
        await this.clearPendingSetup(guildId);
        await this.clearPendingTransfer(guildId);
        const payload = {
            groupId: config.groupId ?? null,
            premiumKey: config.premiumKey ?? null,
            roleBindings: config.roleBindings ?? [],
            verificationRoleId: config.verificationRoleId ?? null,
            unverifiedRoleId: config.unverifiedRoleId ?? null,
            bypassRoleId: config.bypassRoleId ?? null
        };
        try {
            await db.query(
                `INSERT INTO configs (guild_id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                [guildId, JSON.stringify(payload)]
            );
            console.log('[setupManager] setConfig saved');
        } catch (err) {
            console.error('[setupManager] setConfig error:', err);
        }
    },

    async clearPendingSetup(guildId) {
        console.log(`[setupManager] clearPendingSetup for guild ${guildId}`);
        try {
            const res = await db.query(
                `DELETE FROM pending_setups WHERE guild_id::text = $1`,
                [String(guildId)]
            );
            console.log(`[setupManager] clearPendingSetup deleted ${res.rowCount} rows`);
        } catch (err) {
            console.error('[setupManager] clearPendingSetup error:', err);
        }
    },

    async getPendingSetup(guildId) {
        console.log(`[setupManager] getPendingSetup for guild ${guildId}`);
        try {
            const res = await db.query(
                `SELECT data FROM pending_setups WHERE guild_id::text = $1`,
                [String(guildId)]
            );
            if (res.rowCount === 0) return null;
            const data = parseJSON(res.rows[0].data, null);
            console.log('[setupManager] getPendingSetup:', data);
            return data;
        } catch (err) {
            console.error('[setupManager] getPendingSetup error:', err);
            return null;
        }
    },

    async setPendingSetup(guildId, data) {
        console.log(`[setupManager] setPendingSetup for guild ${guildId}`, data);
        try {
            await db.query(
                `INSERT INTO pending_setups (guild_id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                [guildId, JSON.stringify(data)]
            );
            console.log('[setupManager] setPendingSetup saved');
        } catch (err) {
            console.error('[setupManager] setPendingSetup error:', err);
        }
    },

    async clearPendingTransfer(guildId) {
        console.log(`[setupManager] clearPendingTransfer for guild ${guildId}`);
        try {
            const res = await db.query(
                `DELETE FROM pending_transfers WHERE guild_id::text = $1`,
                [String(guildId)]
            );
            console.log(`[setupManager] clearPendingTransfer deleted ${res.rowCount} rows`);
        } catch (err) {
            console.error('[setupManager] clearPendingTransfer error:', err);
        }
    },

    async setPendingTransfer(guildId, data) {
        console.log(`[setupManager] setPendingTransfer for guild ${guildId}`, data);
        try {
            await db.query(
                `INSERT INTO pending_transfers (guild_id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                [guildId, JSON.stringify(data)]
            );
            console.log('[setupManager] setPendingTransfer saved');
        } catch (err) {
            console.error('[setupManager] setPendingTransfer error:', err);
        }
    },

    async getPendingTransfer(guildId) {
        console.log(`[setupManager] getPendingTransfer for guild ${guildId}`);
        try {
            const res = await db.query(
                `SELECT data FROM pending_transfers WHERE guild_id::text = $1`,
                [String(guildId)]
            );
            if (res.rowCount === 0) return null;
            const data = parseJSON(res.rows[0].data, null);
            console.log('[setupManager] getPendingTransfer:', data);
            return data;
        } catch (err) {
            console.error('[setupManager] getPendingTransfer error:', err);
            return null;
        }
    },

    async findGuildByGroupId(groupId) {
        console.log(`[setupManager] findGuildByGroupId ${groupId}`);
        try {
            const res = await db.query(
                `SELECT guild_id FROM configs WHERE (data->>'groupId') = $1 LIMIT 1`,
                [String(groupId)]
            );
            if (res.rowCount === 0) return null;
            console.log('[setupManager] findGuildByGroupId found', res.rows[0].guild_id);
            return res.rows[0].guild_id;
        } catch (err) {
            console.error('[setupManager] findGuildByGroupId error:', err);
            return null;
        }
    },

    async findPendingGuildByGroupId(groupId) {
        console.log(`[setupManager] findPendingGuildByGroupId ${groupId}`);
        try {
            const res = await db.query(
                `SELECT guild_id FROM pending_setups WHERE (data->>'groupId') = $1 LIMIT 1`,
                [String(groupId)]
            );
            if (res.rowCount === 0) return null;
            console.log('[setupManager] findPendingGuildByGroupId found', res.rows[0].guild_id);
            return res.rows[0].guild_id;
        } catch (err) {
            console.error('[setupManager] findPendingGuildByGroupId error:', err);
            return null;
        }
    },

    async loadAllConfigs() {
        console.log('[setupManager] loadAllConfigs');
        try {
            const res = await db.query(`SELECT guild_id, data FROM configs`);
            return res.rows.map(r => ({ guildId: r.guild_id, config: parseJSON(r.data, {}) }));
        } catch (err) {
            console.error('[setupManager] loadAllConfigs error:', err);
            return [];
        }
    },

    async loadAllPendingSetups() {
        console.log('[setupManager] loadAllPendingSetups');
        try {
            const res = await db.query(`SELECT guild_id, data FROM pending_setups`);
            return res.rows.map(r => ({ guildId: r.guild_id, pending: parseJSON(r.data, {}) }));
        } catch (err) {
            console.error('[setupManager] loadAllPendingSetups error:', err);
            return [];
        }
    }
};
