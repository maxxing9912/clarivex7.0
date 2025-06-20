// utils/setupManager.js

const db = require('../database'); // wrapper che espone db.query(sql, params)

function parseJSON(value, fallback) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

module.exports = {
    /**
     * Ottiene la configurazione finale per una guild: se non esiste in DB, restituisce valori di default.
     * La tabella SQL è `configs(guild_id TEXT PRIMARY KEY, data JSONB)`.
     */
    async getConfig(guildId) {
        console.log(`[setupManager] getConfig for guild ${guildId}`);
        const res = await db.query(
            `SELECT data FROM configs WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) {
            console.log(`[setupManager] getConfig: none for guild ${guildId}`);
            return {
                groupId: null,
                premiumKey: null,
                roleBindings: [],
                verificationRoleId: null,
                unverifiedRoleId: null,
                bypassRoleId: null
            };
        }
        const data = parseJSON(res.rows[0].data, {});
        console.log(`[setupManager] getConfig: returning`, data);
        return data;
    },

    /**
     * Imposta la configurazione definitiva per la guild: scrive in `configs`, e pulisce eventuali pending.
     * config dovrebbe contenere { groupId, premiumKey, roleBindings, verificationRoleId, unverifiedRoleId, bypassRoleId }.
     */
    async setConfig(guildId, config) {
        console.log(`[setupManager] setConfig called for guild ${guildId} with:`, config);
        // Rimuovi pending
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
        await db.query(
            `INSERT INTO configs (guild_id, data)
             VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
            [guildId, json]
        );
        console.log(`[setupManager] setConfig: saved for guild ${guildId}`);
    },

    /**
     * Merge di parziali nella config esistente.
     */
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
    /**
     * Salva una richiesta pendente in `pending_setups(guild_id TEXT PRIMARY KEY, data JSONB)`.
     * data: { groupId, premiumKey, ownerDiscordId, invokingChannelId, ... }
     */
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

    /**
     * Ottiene la richiesta pendente (o null). Restituisce l'oggetto salvato.
     */
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

    /**
     * Cancella la richiesta pendente per la guild.
     */
    async clearPendingSetup(guildId) {
        console.log(`[setupManager] clearPendingSetup for guild ${guildId}`);
        await db.query(
            `DELETE FROM pending_setups WHERE guild_id = $1`,
            [guildId]
        );
    },

    // --- Pending transfer (se usato) ---
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
        await db.query(
            `DELETE FROM pending_transfers WHERE guild_id = $1`,
            [guildId]
        );
    },

    // --- Lookup by Roblox groupId ---
    /**
     * Cerca in `configs` un record dove data->>'groupId' = groupId.
     * Restituisce guild_id se trovato, o null.
     */
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

    // Opzionali: caricare tutti per debug
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
