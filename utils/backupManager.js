// utils/backupManager.js
const db = require('../database');
const { v4: uuidv4 } = require('uuid'); // se vuoi usare UUID per backup_id
// Se preferisci usare solo timestamp, puoi evitare uuid e usare Date.now().toString()

module.exports = {
    /**
     * Crea un backup (ruoli + canali) e lo salva in DB.
     * Restituisce l'ID del backup creato.
     * @param {Guild} guild - oggetto Discord.js Guild
     * @returns {Promise<string>} backupId
     */
    async createBackup(guild) {
        // Costruisci il JSON dei dati
        const data = {
            roles: guild.roles.cache.map(r => ({
                name: r.name,
                color: r.color,
                hoist: r.hoist,
                position: r.rawPosition ?? r.position, // potresti voler memorizzare posizione relativa
                permissions: r.permissions.bitfield.toString(),
                mentionable: r.mentionable
            })),
            channels: guild.channels.cache.map(c => ({
                name: c.name,
                type: c.type, // 'GUILD_TEXT', 'GUILD_VOICE', ecc.
                parentId: c.parentId,
                position: c.rawPosition ?? c.position,
                topic: c.topic ?? null,
                nsfw: c.nsfw ?? false,
                bitrate: c.bitrate ?? null,
                userLimit: c.userLimit ?? null,
                permissionOverwrites: c.permissionOverwrites.cache.map(o => o.toJSON())
            }))
        };

        // Genera un ID univoco: puoi usare UUID o timestamp
        // const backupId = Date.now().toString();
        const backupId = uuidv4();

        // Inserisci in PostgreSQL
        try {
            await db.query(
                `INSERT INTO backups (guild_id, backup_id, data)
         VALUES ($1, $2, $3)`,
                [guild.id, backupId, data]
            );
            return backupId;
        } catch (err) {
            console.error('Errore createBackup:', err);
            throw err;
        }
    },

    /**
     * Recupera il JSON del backup dal DB. Restituisce null se non trovato.
     * @param {string} backupId
     * @returns {Promise<object|null>}
     */
    async getBackupData(backupId) {
        const res = await db.query(
            `SELECT data
         FROM backups
        WHERE backup_id = $1`,
            [backupId]
        );
        if (res.rowCount === 0) return null;
        return res.rows[0].data;
    },

    /**
     * Elenca i backup per un determinato guildId: restituisce array di { backupId, createdAt } ordinati per data decrescente.
     * @param {string} guildId
     * @returns {Promise<Array<{ backupId: string, createdAt: string }>>}
     */
    async listBackups(guildId) {
        const res = await db.query(
            `SELECT backup_id, created_at
         FROM backups
        WHERE guild_id = $1
        ORDER BY created_at DESC`,
            [guildId]
        );
        return res.rows.map(r => ({
            backupId: r.backup_id,
            createdAt: r.created_at
        }));
    },

    /**
     * Elimina un backup specifico.
     * @param {string} backupId
     * @returns {Promise<boolean>} true se eliminato, false se non esisteva
     */
    async deleteBackup(backupId) {
        const res = await db.query(
            `DELETE FROM backups WHERE backup_id = $1`,
            [backupId]
        );
        return res.rowCount > 0;
    },

    /**
     * Ripristina il backup nel guild: legge il JSON e ricrea ruoli e canali.
     * ATTENZIONE: richiede che il bot abbia permessi adeguati. Usa con cautela.
     * @param {string} backupId
     * @param {Guild} guild
     */
    async restoreBackup(backupId, guild) {
        const data = await this.getBackupData(backupId);
        if (!data) {
            throw new Error(`Backup con ID ${backupId} non trovato`);
        }

        // 1. Creazione ruoli
        // Puoi decidere se eliminare ruoli esistenti o aggiungerne di nuovi; qui prendiamo l'approccio di creare nuovi ruoli
        // con un nome magari prefixato, oppure se vuoi eliminare tutti e ricreare da zero, devi usare cautela.
        // Esempio: creiamo ruoli nuovi con lo stesso nome + timestamp per evitare conflitti:
        const createdRolesMap = new Map(); // nomeOriginale -> ruolo creato
        for (const r of data.roles) {
            try {
                const newRole = await guild.roles.create({
                    name: r.name,
                    color: r.color,
                    hoist: r.hoist,
                    permissions: BigInt(r.permissions),
                    mentionable: r.mentionable,
                    reason: `Restore backup ${backupId}`
                });
                createdRolesMap.set(r.name, newRole);
                // Opzionale: puoi regolare la posizione con newRole.setPosition(r.position), ma attenzione a rate limits
                // await newRole.setPosition(r.position);
            } catch (err) {
                console.error(`Errore creando ruolo ${r.name}:`, err);
            }
        }

        // 2. Creazione categorie (parent) prima di canali non-categoria
        // Filtra canali di tipo categoria
        const categories = data.channels.filter(c => c.type === 'GUILD_CATEGORY' || c.type === 4);
        const nonCategories = data.channels.filter(c => !(c.type === 'GUILD_CATEGORY' || c.type === 4));

        const createdChannelsMap = new Map(); // info per successivo ordine

        // Crea categorie
        for (const c of categories) {
            try {
                const newCat = await guild.channels.create(c.name, {
                    type: 'GUILD_CATEGORY',
                    permissionOverwrites: c.permissionOverwrites,
                    reason: `Restore backup ${backupId}`
                });
                createdChannelsMap.set(c.name, newCat);
                // posizione: se vuoi, setta posizione con newCat.setPosition(c.position)
            } catch (err) {
                console.error(`Errore creando categoria ${c.name}:`, err);
            }
        }

        // Crea gli altri canali, assegnando parent se esiste
        for (const c of nonCategories) {
            try {
                const opts = {
                    type: c.type,
                    topic: c.topic || undefined,
                    nsfw: c.nsfw || undefined,
                    bitrate: c.bitrate || undefined,
                    userLimit: c.userLimit || undefined,
                    permissionOverwrites: c.permissionOverwrites,
                    reason: `Restore backup ${backupId}`
                };
                // Se parentId salvato: qui in backup avevamo salvato solo l'ID originale, non lo useremo perché non esiste più.
                // Dovremmo invece basarci sul nome della categoria: se in data.channels avevi anche il nome della parent, potresti includerlo.
                // Qui assumiamo che parentId non sia direttamente riutilizzabile; meglio salvare parentName nel backup se serve.
                // Ad esempio se nel backup aggiungi parentName: c.parentName, allora:
                // if (c.parentName && createdChannelsMap.has(c.parentName)) opts.parent = createdChannelsMap.get(c.parentName).id;
                if (c.parentId) {
                    // Non riusiamo parentId: potresti aver salvato parentName in fase di backup. Se no, ometti questa parte o salva parentName.
                }
                const newCh = await guild.channels.create(c.name, opts);
                createdChannelsMap.set(c.name, newCh);
                // Posizione: newCh.setPosition(c.position);
            } catch (err) {
                console.error(`Errore creando canale ${c.name}:`, err);
            }
        }

        // Nota: gestione ordine e parent richiede che nel backup memorizzi anche il nome della categoria (parentName)
        // Se vuoi fare restore più preciso, nel JSON di backup includi: parentName: guild.channels.cache.get(c.parentId)?.name
        // e in fase di restore usi createdChannelsMap.get(parentName).id come parent.

        // 3. (Facoltativo) Ritornare mappe o report
        return { roles: createdRolesMap, channels: createdChannelsMap };
    }
};