// utils/setupManager.js

const db = require('../database'); // wrapper Postgres: espone query(sql, params)
let quick = null;

// Tentativo di importare il modulo QuickDB legacy, se esiste
try {
    quick = require('../utils/quickdb'); // adatta il path se il tuo modulo legacy ha nome diverso
    console.log('[setupManager] QuickDB module found, legacy fallback enabled.');
} catch (err) {
    console.log('[setupManager] QuickDB module not found, skipping legacy fallback.');
    quick = null;
}

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
     * 2) Se non esiste e quick è disponibile, tenta fallback da QuickDB (legacy), migra in Postgres e cancella legacy.
     * 3) Se non c’è neanche legacy o quick non esiste, restituisce default.
     */
    async getConfig(guildId) {
        console.log(`[setupManager] getConfig for guild ${guildId}`);
        // 1) Leggi da Postgres
        try {
            const res = await db.query(
                `SELECT data FROM configs WHERE guild_id = $1`,
                [guildId]
            );
            if (res.rowCount > 0) {
                const data = parseJSON(res.rows[0].data, {});
                console.log(`[setupManager] getConfig(Postgres):`, data);
                return data;
            }
            console.log(`[setupManager] getConfig: none in Postgres for guild ${guildId}`);
        } catch (err) {
            console.error('[setupManager] getConfig Postgres error:', err);
            // In caso di errore DB, possiamo proseguire con fallback legacy se esiste, oppure restituire default
        }

        // 2) Se QuickDB è disponibile, tenta fallback
        if (quick && typeof quick.get === 'function') {
            console.log(`[setupManager] Checking QuickDB legacy config for guild ${guildId}`);
            try {
                const legacy = await quick.get(`config_${guildId}`);
                if (legacy) {
                    console.log(`[setupManager] Found legacy QuickDB config for guild ${guildId}:`, legacy);
                    // Prepara payload coerente
                    const payload = {
                        groupId: legacy.groupId ?? null,
                        premiumKey: legacy.premiumKey ?? null,
                        roleBindings: legacy.roleBindings ?? [],
                        verificationRoleId: legacy.verificationRoleId ?? null,
                        unverifiedRoleId: legacy.unverifiedRoleId ?? null,
                        bypassRoleId: legacy.bypassRoleId ?? null
                    };
                    // Prova a salvare in Postgres
                    try {
                        const json = JSON.stringify(payload);
                        await db.query(
                            `INSERT INTO configs (guild_id, data)
                             VALUES ($1, $2)
                             ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                            [guildId, json]
                        );
                        console.log(`[setupManager] Migrated legacy QuickDB config to Postgres for guild ${guildId}`);
                        // Cancella legacy
                        try {
                            await quick.delete(`config_${guildId}`);
                            console.log(`[setupManager] Deleted legacy QuickDB config for guild ${guildId}`);
                        } catch (delErr) {
                            console.warn(`[setupManager] Could not delete legacy QuickDB config for guild ${guildId}:`, delErr);
                        }
                    } catch (pgErr) {
                        console.error('[setupManager] Error migrating QuickDB config to Postgres:', pgErr);
                        // Se la migrazione fallisce, restituisci comunque legacy per non bloccare l’utente
                    }
                    return payload;
                } else {
                    console.log(`[setupManager] No legacy QuickDB config for guild ${guildId}`);
                }
            } catch (quickErr) {
                console.error('[setupManager] QuickDB get error:', quickErr);
            }
        }

        // 3) Nessuna configurazione esistente
        console.log(`[setupManager] getConfig: returning default for guild ${guildId}`);
        return {
            groupId: null,
            premiumKey: null,
            roleBindings: [],
            verificationRoleId: null,
            unverifiedRoleId: null,
            bypassRoleId: null
        };
    },

    /**
     * Salva la configurazione definitiva in Postgres e cancella eventuali pending.
     */
    async setConfig(guildId, config) {
        console.log(`[setupManager] setConfig called for guild ${guildId}:`, config);
        // Cancella pending
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

    // --- Pending setup ---
    async setPendingSetup(guildId, data) {
        console.log(`[setupManager] setPendingSetup for guild ${guildId}:`, data);
        const json = JSON.stringify(data);
        try {
            await db.query(
                `INSERT INTO pending_setups (guild_id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                [guildId, json]
            );
        } catch (err) {
            console.error('[setupManager] setPendingSetup Postgres error:', err);
        }
    },

    async getPendingSetup(guildId) {
        console.log(`[setupManager] getPendingSetup for guild ${guildId}`);
        try {
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
        } catch (err) {
            console.error('[setupManager] getPendingSetup Postgres error:', err);
            return null;
        }
    },

    async clearPendingSetup(guildId) {
        console.log(`[setupManager] clearPendingSetup for guild ${guildId}`);
        try {
            await db.query(`DELETE FROM pending_setups WHERE guild_id = $1`, [guildId]);
        } catch (err) {
            console.error('[setupManager] clearPendingSetup Postgres error:', err);
        }
    },

    // --- Pending transfer ---
    async setPendingTransfer(guildId, data) {
        console.log(`[setupManager] setPendingTransfer for guild ${guildId}:`, data);
        const json = JSON.stringify(data);
        try {
            await db.query(
                `INSERT INTO pending_transfers (guild_id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
                [guildId, json]
            );
        } catch (err) {
            console.error('[setupManager] setPendingTransfer Postgres error:', err);
        }
    },

    async getPendingTransfer(guildId) {
        console.log(`[setupManager] getPendingTransfer for guild ${guildId}`);
        try {
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
        } catch (err) {
            console.error('[setupManager] getPendingTransfer Postgres error:', err);
            return null;
        }
    },

    async clearPendingTransfer(guildId) {
        console.log(`[setupManager] clearPendingTransfer for guild ${guildId}`);
        try {
            await db.query(`DELETE FROM pending_transfers WHERE guild_id = $1`, [guildId]);
        } catch (err) {
            console.error('[setupManager] clearPendingTransfer Postgres error:', err);
        }
    },

    // --- Lookup by Roblox groupId ---
    async findGuildByGroupId(groupId) {
        console.log(`[setupManager] findGuildByGroupId for groupId ${groupId}`);
        try {
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
        } catch (err) {
            console.error('[setupManager] findGuildByGroupId Postgres error:', err);
            return null;
        }
    },

    async findPendingGuildByGroupId(groupId) {
        console.log(`[setupManager] findPendingGuildByGroupId for groupId ${groupId}`);
        try {
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
        } catch (err) {
            console.error('[setupManager] findPendingGuildByGroupId Postgres error:', err);
            return null;
        }
    },

    // Debug: carica tutte le config
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
