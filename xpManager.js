// xpManager.js
const db = require('./database');

module.exports = {
    // --- XP Management ---
    /**
     * Incrementa XP per userId di 'amount' (può essere negativo). Restituisce il nuovo totale.
     */
    async addXP(userId, amount) {
        const res = await db.query(
            `INSERT INTO xp (user_id, xp)
         VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET xp = GREATEST(xp + EXCLUDED.xp, 0)
       RETURNING xp`,
            [userId, amount]
        );
        return res.rows[0].xp;
    },

    /**
     * Rimuove XP (decrementa) di 'amount', garantendo >= 0.
     */
    async removeXP(userId, amount) {
        return this.addXP(userId, -Math.abs(amount));
    },

    /**
     * Imposta XP esatto per userId (>= 0). Restituisce il valore.
     */
    async setXP(userId, value) {
        const safeValue = Math.max(0, value);
        await db.query(
            `INSERT INTO xp (user_id, xp)
         VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET xp = EXCLUDED.xp`,
            [userId, safeValue]
        );
        return safeValue;
    },

    /**
     * Ottiene XP corrente per userId. Se non esiste, restituisce 0.
     */
    async getXP(userId) {
        const res = await db.query(`SELECT xp FROM xp WHERE user_id = $1`, [userId]);
        if (res.rowCount === 0) return 0;
        return res.rows[0].xp;
    },

    /**
     * Restituisce array di tutti gli utenti con XP: [ { userId, xp }, ... ].
     * Attenzione: se tabella grande, può essere pesante.
     */
    async getAllXp() {
        const res = await db.query(`SELECT user_id, xp FROM xp`);
        return res.rows.map(r => ({ userId: r.user_id, xp: r.xp }));
    },

    // --- Warning Management (server-specific) ---
    /**
     * Aggiunge un warning per userId in guildId. Restituisce lista aggiornata di testi warning.
     */
    async addWarning(userId, guildId, warning) {
        await db.query(
            `INSERT INTO warnings (guild_id, user_id, warning)
       VALUES ($1, $2, $3)`,
            [guildId, userId, warning]
        );
        const res = await db.query(
            `SELECT warning FROM warnings
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY created_at ASC, id ASC`,
            [guildId, userId]
        );
        return res.rows.map(r => r.warning);
    },

    /**
     * Rimuove un warning all'indice 'index' (0-based). Restituisce il testo rimosso.
     */
    async removeWarning(userId, guildId, index) {
        const res = await db.query(
            `SELECT id, warning FROM warnings
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY created_at ASC, id ASC`,
            [guildId, userId]
        );
        const rows = res.rows;
        if (index < 0 || index >= rows.length) {
            throw new Error('Invalid warning index');
        }
        const rowToRemove = rows[index];
        await db.query(`DELETE FROM warnings WHERE id = $1`, [rowToRemove.id]);
        return rowToRemove.warning;
    },

    /**
     * Ottiene lista warning (testi) per userId in guildId.
     */
    async getWarnings(userId, guildId) {
        const res = await db.query(
            `SELECT warning FROM warnings
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY created_at ASC, id ASC`,
            [guildId, userId]
        );
        return res.rows.map(r => r.warning);
    },

    // --- Badge Management (server-specific) ---
    /**
     * Aggiunge badge badgeName per userId in guildId. Restituisce lista aggiornata.
     */
    async addBadge(userId, guildId, badgeName) {
        await db.query(
            `INSERT INTO badges (guild_id, user_id, badge_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, user_id, badge_name) DO NOTHING`,
            [guildId, userId, badgeName]
        );
        const res = await db.query(
            `SELECT badge_name FROM badges
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY badge_name ASC`,
            [guildId, userId]
        );
        return res.rows.map(r => r.badge_name);
    },

    /**
     * Rimuove badge badgeName per userId in guildId. Restituisce lista aggiornata.
     */
    async removeBadge(userId, guildId, badgeName) {
        const res = await db.query(
            `DELETE FROM badges
         WHERE guild_id = $1 AND user_id = $2 AND badge_name = $3
       RETURNING badge_name`,
            [guildId, userId, badgeName]
        );
        if (res.rowCount === 0) {
            throw new Error('Badge not found');
        }
        const res2 = await db.query(
            `SELECT badge_name FROM badges
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY badge_name ASC`,
            [guildId, userId]
        );
        return res2.rows.map(r => r.badge_name);
    },

    /**
     * Ottiene lista badge per userId in guildId.
     */
    async getBadges(userId, guildId) {
        const res = await db.query(
            `SELECT badge_name FROM badges
         WHERE guild_id = $1 AND user_id = $2
         ORDER BY badge_name ASC`,
            [guildId, userId]
        );
        return res.rows.map(r => r.badge_name);
    },

    // --- Verification / Linking ---
    /**
     * Imposta codice verifica per userId.
     */
    async setCode(userId, code) {
        await db.query(
            `INSERT INTO verif_codes (user_id, code, created_at)
         VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET code = EXCLUDED.code,
             created_at = EXCLUDED.created_at`,
            [userId, code]
        );
    },

    /**
     * Ottiene codice verifica per userId, o null.
     */
    async getCode(userId) {
        const res = await db.query(`SELECT code FROM verif_codes WHERE user_id = $1`, [userId]);
        if (res.rowCount === 0) return null;
        return res.rows[0].code;
    },

    /**
     * Cancella codice verifica e tempUser per userId.
     */
    async clearTemp(userId) {
        await db.query(`DELETE FROM verif_codes WHERE user_id = $1`, [userId]);
        await db.query(`DELETE FROM temp_users WHERE user_id = $1`, [userId]);
    },

    /**
     * Imposta robloxName temporaneo per userId.
     */
    async setTempUser(userId, robloxName) {
        await db.query(
            `INSERT INTO temp_users (user_id, roblox_name, created_at)
         VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET roblox_name = EXCLUDED.roblox_name,
             created_at = EXCLUDED.created_at`,
            [userId, robloxName]
        );
    },

    /**
     * Ottiene robloxName temporaneo per userId, o null.
     */
    async getTempUser(userId) {
        const res = await db.query(`SELECT roblox_name FROM temp_users WHERE user_id = $1`, [userId]);
        if (res.rowCount === 0) return null;
        return res.rows[0].roblox_name;
    },

    /**
     * Collega permanentemente userId a robloxName.
     */
    async linkRoblox(userId, robloxName) {
        await db.query(
            `INSERT INTO links (user_id, roblox_name)
         VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET roblox_name = EXCLUDED.roblox_name`,
            [userId, robloxName]
        );
    },

    /**
     * Restituisce robloxName collegato a userId, o null.
     */
    async getLinked(userId) {
        const res = await db.query(`SELECT roblox_name FROM links WHERE user_id = $1`, [userId]);
        if (res.rowCount === 0) return null;
        return res.rows[0].roblox_name;
    },

    /**
     * Rimuove il link per userId.
     */
    async removeLink(userId) {
        await db.query(`DELETE FROM links WHERE user_id = $1`, [userId]);
    },

    /**
     * Ottiene array di tutti i link: [ { discordId, robloxName }, ... ].
     */
    async getAllLinked() {
        const res = await db.query(`SELECT user_id, roblox_name FROM links`);
        return res.rows.map(r => ({ discordId: r.user_id, robloxName: r.roblox_name }));
    },

    /**
     * Data una robloxName, restituisce discordId (case-insensitive), o null.
     */
    async getDiscordUserIdFromRobloxName(robloxName) {
        const res = await db.query(
            `SELECT user_id FROM links WHERE LOWER(roblox_name) = LOWER($1) LIMIT 1`,
            [robloxName]
        );
        if (res.rowCount === 0) return null;
        return res.rows[0].user_id;
    },

    // --- XP Config Management (server-specific) ---
    /**
     * Recupera configurazione XP per guildId. Se non esiste, ritorna { thresholds: [] }.
     */
    async getXPConfigForGuild(guildId) {
        const res = await db.query(`SELECT data FROM xp_configs WHERE guild_id = $1`, [guildId]);
        if (res.rowCount === 0) {
            return { thresholds: [] };
        }
        return res.rows[0].data;
    },

    /**
     * Imposta o aggiorna interamente config per guildId.
     */
    async setXPConfigForGuild(guildId, config) {
        await db.query(
            `INSERT INTO xp_configs (guild_id, data)
         VALUES ($1, $2::jsonb)
       ON CONFLICT (guild_id) DO UPDATE
         SET data = EXCLUDED.data`,
            [guildId, config]
        );
        return config;
    },

    // --- Premium Management (global) ---
    /**
     * Imposta lo stato premium per userId (true/false).
     * Se false, rimuove la riga.
     */
    async setPremiumUser(userId, value) {
        if (value) {
            await db.query(
                `INSERT INTO premium_users (user_id, is_premium, updated_at)
           VALUES ($1, TRUE, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET is_premium = TRUE,
               updated_at = EXCLUDED.updated_at`,
                [userId]
            );
        } else {
            await db.query(`DELETE FROM premium_users WHERE user_id = $1`, [userId]);
        }
    },

    /**
     * Verifica se userId è premium (true/false).
     */
    async isPremiumUser(userId) {
        const res = await db.query(`SELECT is_premium FROM premium_users WHERE user_id = $1`, [userId]);
        if (res.rowCount === 0) return false;
        return res.rows[0].is_premium;
    },

    // --- Server-specific Premium Management ---
    /**
     * Imposta premium per userId in guildId (true/false).
     */
    async setGuildPremium(guildId, userId, value = true) {
        if (value) {
            await db.query(
                `INSERT INTO guild_premiums (guild_id, user_id, is_premium, updated_at)
           VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (guild_id, user_id) DO UPDATE
           SET is_premium = TRUE,
               updated_at = EXCLUDED.updated_at`,
                [guildId, userId]
            );
        } else {
            await db.query(`DELETE FROM guild_premiums WHERE guild_id = $1 AND user_id = $2`, [guildId, userId]);
        }
    },

    /**
     * Verifica se userId è premium in guildId.
     */
    async isPremiumInGuild(guildId, userId) {
        const res = await db.query(
            `SELECT is_premium FROM guild_premiums WHERE guild_id = $1 AND user_id = $2`,
            [guildId, userId]
        );
        if (res.rowCount === 0) return false;
        return res.rows[0].is_premium;
    },

    /**
     * Wrapper legacy se serviva getRobloxId.
     */
    async getRobloxId(userId) {
        return this.getLinked(userId);
    }
};