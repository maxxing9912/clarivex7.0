// utils/permManager.js
const db = require('../database'); // il wrapper: query(text, params)

module.exports = {
    /**
     * Restituisce l'owner custom (se già salvato), altrimenti salva e restituisce
     * il vero guildOwnerId la prima volta che viene chiamato.
     * @param {string} guildId
     * @param {string} guildOwnerId
     * @returns {Promise<string>}
     */
    async getOwner(guildId, guildOwnerId) {
        // Prova a leggere dalla tabella guild_owners
        const res = await db.query(
            `SELECT owner_id
         FROM guild_owners
        WHERE guild_id = $1`,
            [guildId]
        );
        if (res.rowCount === 0) {
            // Non esiste: inserisci e ritorna guildOwnerId
            await db.query(
                `INSERT INTO guild_owners (guild_id, owner_id)
         VALUES ($1, $2)`,
                [guildId, guildOwnerId]
            );
            return guildOwnerId;
        } else {
            return res.rows[0].owner_id;
        }
    },

    /**
     * Sovrascrive l'owner custom per questo server
     * @param {string} guildId
     * @param {string} userId
     * @returns {Promise<void>}
     */
    async setOwner(guildId, userId) {
        // Upsert: se esiste, aggiorna; altrimenti inserisci
        await db.query(
            `INSERT INTO guild_owners (guild_id, owner_id)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE
         SET owner_id = EXCLUDED.owner_id`,
            [guildId, userId]
        );
    },

    /**
     * Restituisce il rank numerico di un utente in un server (0–3)
     * @param {string} guildId
     * @param {string} userId
     * @returns {Promise<number>}
     */
    async getRank(guildId, userId) {
        const res = await db.query(
            `SELECT rank
         FROM user_ranks
        WHERE guild_id = $1 AND user_id = $2`,
            [guildId, userId]
        );
        if (res.rowCount === 0) {
            return 0;
        }
        // Assicuriamoci che rank sia integer
        const r = parseInt(res.rows[0].rank, 10);
        return isNaN(r) ? 0 : r;
    },

    /**
     * Imposta il rank numerico di un utente (0–3).
     * Se rank <= 0, rimuove la riga dal DB; altrimenti fa upsert.
     * @param {string} guildId
     * @param {string} userId
     * @param {number} rank
     * @returns {Promise<void>}
     */
    async setRank(guildId, userId, rank) {
        const numRank = Number(rank) || 0;
        if (numRank <= 0) {
            // Elimina la riga se esiste (rank 0 considerato default)
            await db.query(
                `DELETE FROM user_ranks WHERE guild_id = $1 AND user_id = $2`,
                [guildId, userId]
            );
        } else {
            // Upsert: se esiste, aggiorna; altrimenti inserisci
            await db.query(
                `INSERT INTO user_ranks (guild_id, user_id, rank)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, user_id) DO UPDATE
           SET rank = EXCLUDED.rank`,
                [guildId, userId, numRank]
            );
        }
    },

    /**
     * Controlla se un utente ha almeno un certo rank
     * @param {string} guildId
     * @param {string} userId
     * @param {number} minRank
     * @returns {Promise<boolean>}
     */
    async hasRank(guildId, userId, minRank = 0) {
        const r = await this.getRank(guildId, userId);
        return r >= minRank;
    },

    /** Etichette di rank */
    RANKS: {
        MEMBER: 0,
        OFFICER: 1,
        HICOM: 2,
        OWNER: 3
    }
};