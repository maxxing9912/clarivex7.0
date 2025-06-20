// utils/setupManager.js

const db = require('../database');        // Postgres wrapper: db.query(sql, params)
// Esempio di QuickDB legacy: importa il tuo modulo QuickDB
// Adatta in base a come interagisci con QuickDB: p.es.:
// const quick = require('../utils/quickdb'); // supponiamo esponga get(key), set(key, val), delete(key)
const quick = require('../utils/quickdb');

function parseJSON(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

module.exports = {
    /**
     * Ottiene la configurazione per guildId:
     * 1) Prova a leggere da Postgres.
     * 2) Se non esiste, tenta fallback da QuickDB (legacy).
     *    Se trova, migra in Postgres e cancella da QuickDB.
     * 3) Se non c’è neanche in QuickDB, restituisce default.
     */
    async getConfig(guildId) {
        console.log(`[setupManager] getConfig for guild ${guildId}`);
        // 1) Leggi da Postgres
        const res = await db.query(
            `SELECT data FROM configs WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount > 0) {
            const data = parseJSON(res.rows[0].data, {});
            console.log(`[setupManager] getConfig(Postgres):`, data);
            return data;
        }
        console.log(`[setupManager] getConfig: none in Postgres for guild ${guildId}, checking QuickDB fallback`);
        // 2) Fallback QuickDB
        let legacy = null;
        try {
            legacy = await quick.get(`config_${guildId}`);
        } catch (err) {
            console.error('[setupManager] QuickDB get error:', err);
        }
        if (legacy) {
            console.log(`[setupManager] Found legacy config in QuickDB for guild ${guildId}:`, legacy);
            // Migra in Postgres
            try {
                const payload = {
                    groupId: legacy.groupId ?? null,
                    premiumKey: legacy.premiumKey ?? null,
                    roleBindings: legacy.roleBindings ?? [],
                    verificationRoleId: legacy.verificationRoleId ?? null,
                    unverifiedRoleId: legacy.unverifiedRoleId ?? null,
                    bypassRoleId: legacy.bypassRoleId ?? null
                };
                const json = JSON.stringify(payload);
                await db.query(
                    `INSERT INTO configs (guild_id, data)
                     VALUES ($1, $2)
                     ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                    [guildId, json]
                );
                console.log(`[setupManager] Migrated legacy config to Postgres for guild ${guildId}`);
                // Cancella legacy
                try {
                    await quick.delete(`config_${guildId}`);
                    console.log(`[setupManager] Deleted legacy QuickDB config for guild ${guildId}`);
                } catch (delErr) {
                    console.warn(`[setupManager] Could not delete legacy QuickDB config for guild ${guildId}:`, delErr);
                }
                return payload;
            } catch (pgErr) {
                console.error('[setupManager] Error migrating legacy config to Postgres:', pgErr);
                // Se migrazione fallisce, restituisci legacy in memoria senza salvare
                return legacy;
            }
        }
        // 3) Nessuna configurazione esistente
        console.log(`[setupManager] getConfig: no config found for guild ${guildId}`);
        return {
            groupId: null,
            premiumKey: null,
            roleBindings: [],
            verificationRoleId: null,
            unverifiedRoleId: null,
            bypassRoleId: null
        };
    },

    async setConfig(guildId, config) {
        console.log(`[setupManager] setConfig called for guild ${guildId}:`, config);
        // Cancella pending
        await this.clearPendingSetup(guildId);
        await this.clearPendingTransfer(guildId);

        // Salva in Postgres
        const payload = {
            groupId: config.groupId ?? null,
            premiumKey: config.premiumKey ?? null,
            roleBindings: config.roleBindings ?? [],
            verificationRoleId: config.verificationRoleId ?? null,
            unverifiedRoleId: config.unverifiedRoleId ?? null,
            bypassRoleId: config.bypassRoleId ?? null
        };
        const json = JSON.stringify(payload);
        try {
            await db.query(
                `INSERT INTO configs (guild_id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                [guildId, json]
            );
            console.log(`[setupManager] setConfig: saved to Postgres for guild ${guildId}`);
        } catch (err) {
            console.error('[setupManager] setConfig Postgres error:', err);
        }
    },

    // ... gli altri metodi rimangono come in implementazione Postgres precedente ...
    async updateConfig(guildId, partial) {
        const existing = await this.getConfig(guildId);
        const merged = {
            groupId: partial.groupId ?? existing.groupId,
            premiumKey: partial.premiumKey ?? existing.premiumKey,
            roleBindings: partial.roleBindings ?? existing.roleBindings,
            verificationRoleId: partial.verificationRoleId ?? existing.verificationRoleId,
            unverifiedRoleId: partial.unverifiedRoleId ?? existing.unverifiedRoleId,
            bypassRoleId: partial.bypassRoleId ?? existing.bypassRoleId
        };
        return this.setConfig(guildId, merged);
    },

    async setPendingSetup(guildId, data) {
        console.log(`[setupManager] setPendingSetup for guild ${guildId}:`, data);
        const json = JSON.stringify(data);
        await db.query(
            `INSERT INTO pending_setups (guild_id, data)
             VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
            [guildId, json]
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
        const data = parseJSON(res.rows[0].data, null);
        console.log(`[setupManager] getPendingSetup: returning`, data);
        return data;
    },

    async clearPendingSetup(guildId) {
        console.log(`[setupManager] clearPendingSetup for guild ${guildId}`);
        await db.query(`DELETE FROM pending_setups WHERE guild_id = $1`, [guildId]);
    },

    async setPendingTransfer(guildId, data) {
        console.log(`[setupManager] setPendingTransfer for guild ${guildId}:`, data);
        const json = JSON.stringify(data);
        await db.query(
            `INSERT INTO pending_transfers (guild_id, data)
             VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
            [guildId, json]
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
        const data = parseJSON(res.rows[0].data, null);
        console.log(`[setupManager] getPendingTransfer: returning`, data);
        return data;
    },

    async clearPendingTransfer(guildId) {
        console.log(`[setupManager] clearPendingTransfer for guild ${guildId}`);
        await db.query(`DELETE FROM pending_transfers WHERE guild_id = $1`, [guildId]);
    },

    async findGuildByGroupId(groupId) {
        console.log(`[setupManager] findGuildByGroupId for groupId ${groupId}`);
        const res = await db.query(
            `SELECT guild_id FROM configs WHERE (data->>'groupId') = $1 LIMIT 1`,
            [String(groupId)]
        );
        if (res.rowCount === 0) {
            console.log(`[setupManager] findGuildByGroupId: none found`);
            return null;
        }
        const found = res.rows[0].guild_id;
        console.log(`[setupManager] findGuildByGroupId: found guild ${found}`);
        return found;
    },

    async findPendingGuildByGroupId(groupId) {
        console.log(`[setupManager] findPendingGuildByGroupId for groupId ${groupId}`);
        const res = await db.query(
            `SELECT guild_id FROM pending_setups WHERE (data->>'groupId') = $1 LIMIT 1`,
            [String(groupId)]
        );
        if (res.rowCount === 0) {
            console.log(`[setupManager] findPendingGuildByGroupId: none found`);
            return null;
        }
        const found = res.rows[0].guild_id;
        console.log(`[setupManager] findPendingGuildByGroupId: found guild ${found}`);
        return found;
    },

    // Metodi di debug
    async loadAllConfigs() {
        console.log('[setupManager] loadAllConfigs');
        const res = await db.query(`SELECT guild_id, data FROM configs`);
        return res.rows.map(r => ({ guildId: r.guild_id, config: parseJSON(r.data, {}) }));
    },
    async loadAllPendingSetups() {
        console.log('[setupManager] loadAllPendingSetups');
        const res = await db.query(`SELECT guild_id, data FROM pending_setups`);
        return res.rows.map(r => ({ guildId: r.guild_id, pending: parseJSON(r.data, {}) }));
    }
};
