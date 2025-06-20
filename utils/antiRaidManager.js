// utils/antiRaidManager.js
// AntiRaidManager: rileva ondate di join e applica lockdown/kick/ban automatico.
// Usa configManager per leggere/salvare impostazioni per guild.

const { EmbedBuilder } = require('discord.js');
const configManager = require('../configManager');

class AntiRaidManager {
    /**
     * client: istanza di Discord.Client
     * Registra automaticamente l'handler per guildMemberAdd.
     */
    constructor(client) {
        this.client = client;
        /** Cache dei config anti-raid per guildId */
        this.configCache = new Map();
        /** Records di join recenti per guildId: array di timestamp (ms) */
        this.joinRecords = new Map();
        /** Timer di lockdown per guildId */
        this.lockdownTimers = new Map();

        client.on('guildMemberAdd', member => {
            this.onMemberJoin(member).catch(err => console.error('AntiRaid onMemberJoin error:', err));
        });
    }

    /** Carica o inizializza il config anti-raid per una guild */
    async loadConfig(guildId) {
        let cfg = await configManager.getSetting(guildId, 'antiRaid');
        if (!cfg) {
            // Impostazioni di default
            cfg = {
                enabled: false,            // disabilitato di default
                joinThreshold: 5,          // numero di join entro timeWindow per attivare
                timeWindow: 10,            // finestra in secondi
                lockdownDuration: 300,     // durata lockdown in secondi
                action: 'kick',            // 'kick' o 'ban' sui nuovi membri durante lockdown o al superamento soglia
                exemptRoles: [],           // array di roleId esenti dal controllo
                exemptUsers: [],           // array di userId esenti
                // campo runtime:
                lockdown: { active: false, since: null }
            };
            await configManager.setSetting(guildId, 'antiRaid', cfg);
        }
        // Assicuriamoci che lockdown campo esista
        if (!cfg.lockdown) {
            cfg.lockdown = { active: false, since: null };
        }
        this.configCache.set(guildId, cfg);
        return cfg;
    }

    /** Ricarica config in cache */
    async updateConfigCache(guildId) {
        return this.loadConfig(guildId);
    }

    /** Verifica se in lockdown attivo */
    isInLockdown(guildId) {
        const cfg = this.configCache.get(guildId);
        return cfg && cfg.lockdown && cfg.lockdown.active;
    }

    /** Handler di join membro */
    async onMemberJoin(member) {
        const guildId = member.guild.id;
        let cfg = this.configCache.get(guildId);
        if (!cfg) {
            cfg = await this.loadConfig(guildId);
        }
        if (!cfg.enabled) return;

        // Se membro esente per ruolo
        if (Array.isArray(cfg.exemptRoles) && cfg.exemptRoles.length) {
            for (const roleId of cfg.exemptRoles) {
                if (member.roles.cache.has(roleId)) {
                    return;
                }
            }
        }
        // Se membro esente per userId
        if (Array.isArray(cfg.exemptUsers) && cfg.exemptUsers.includes(member.id)) {
            return;
        }

        // Se lockdown attivo: agisci immediatamente
        if (cfg.lockdown.active) {
            await this.takeAction(member, 'Lockdown attivo');
            return;
        }

        // Registra timestamp del join
        const now = Date.now();
        let arr = this.joinRecords.get(guildId);
        if (!arr) {
            arr = [];
            this.joinRecords.set(guildId, arr);
        }
        arr.push(now);
        // Filtra i timestamp fuori dalla finestra
        const windowMs = cfg.timeWindow * 1000;
        const cutoff = now - windowMs;
        arr = arr.filter(ts => ts >= cutoff);
        this.joinRecords.set(guildId, arr);

        // Se supera soglia, attiva lockdown
        if (arr.length >= cfg.joinThreshold) {
            await this.triggerLockdown(member.guild, arr.length);
        }
    }

    /** Esegue kick o ban del membro con log */
    async takeAction(member, reason) {
        try {
            const guildId = member.guild.id;
            const cfg = this.configCache.get(guildId);
            const act = cfg.action === 'ban' ? 'ban' : 'kick';
            if (act === 'ban') {
                await member.ban({ reason: `AntiRaid: ${reason}` });
            } else {
                await member.kick(`AntiRaid: ${reason}`);
            }
            // Log in mod log channel
            const channel = await this.getModLogChannel(member.guild);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('🚨 Anti-Raid Action')
                    .setColor('DarkRed')
                    .setDescription(`${member.user.tag} (<@${member.id}>) è stato ${act}ed (${reason}).`)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            console.error('AntiRaid takeAction error:', err);
        }
    }

    /** Attiva lockdown per la guild */
    async triggerLockdown(guild, joinCount) {
        const guildId = guild.id;
        let cfg = this.configCache.get(guildId);
        if (!cfg) {
            cfg = await this.loadConfig(guildId);
        }
        // Imposta lockdown attivo
        cfg.lockdown = { active: true, since: Date.now() };
        this.configCache.set(guildId, cfg);

        // Pulisci record di join (opzionale: futuri join contati separatamente)
        this.joinRecords.set(guildId, []);

        // Schedule fine lockdown
        const durationMs = cfg.lockdownDuration * 1000;
        if (this.lockdownTimers.has(guildId)) {
            clearTimeout(this.lockdownTimers.get(guildId));
        }
        const timer = setTimeout(() => {
            this.resetLockdown(guildId).catch(err => console.error('AntiRaid resetLockdown error:', err));
        }, durationMs);
        this.lockdownTimers.set(guildId, timer);

        // Notifica in channel di log moderazione
        const channel = await this.getModLogChannel(guild);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🚨 Anti-Raid Lockdown Attivato')
                .setColor('Red')
                .setDescription(`Rilevati ${joinCount} join in ${cfg.timeWindow} secondi. Lockdown per ${cfg.lockdownDuration} secondi attivo.`)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    }

    /** Disattiva lockdown per la guild */
    async resetLockdown(guildId) {
        const cfg = this.configCache.get(guildId);
        if (!cfg || !cfg.lockdown || !cfg.lockdown.active) return;
        cfg.lockdown.active = false;
        cfg.lockdown.since = null;
        this.configCache.set(guildId, cfg);

        // Pulisci record join
        this.joinRecords.set(guildId, []);
        // Cancella timer
        if (this.lockdownTimers.has(guildId)) {
            clearTimeout(this.lockdownTimers.get(guildId));
            this.lockdownTimers.delete(guildId);
        }
        // Notifica
        const guild = this.client.guilds.cache.get(guildId);
        if (guild) {
            const channel = await this.getModLogChannel(guild);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Anti-Raid Lockdown Terminato')
                    .setColor('Green')
                    .setDescription(`Lockdown concluso.`)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        }
    }

    /** Recupera il canale di log moderazione basato su configManager */
    async getModLogChannel(guild) {
        try {
            const channelId = await configManager.getSetting(guild.id, 'modLogChannel');
            if (!channelId) return null;
            let channel = guild.channels.cache.get(channelId)
                || await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return null;
            const botMember = guild.members.me || await guild.members.fetchMe();
            const perms = channel.permissionsFor(botMember);
            if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                console.warn(`[AntiRaid] Permessi mancanti in channel ${channelId} per guild ${guild.id}`);
                return null;
            }
            return channel;
        } catch (err) {
            console.error('AntiRaid getModLogChannel error:', err);
            return null;
        }
    }

    /**
     * Metodi per comando di amministrazione:
     * - enable/disable anti-raid
     * - set threshold/timeWindow/lockdownDuration/action/exempts
     * Questi metodi modificano config e aggiornano cache.
     */
    async enable(guildId) {
        const cfg = await this.loadConfig(guildId);
        cfg.enabled = true;
        await configManager.setSetting(guildId, 'antiRaid', cfg);
        this.configCache.set(guildId, cfg);
    }
    async disable(guildId) {
        const cfg = await this.loadConfig(guildId);
        cfg.enabled = false;
        cfg.lockdown = { active: false, since: null };
        await configManager.setSetting(guildId, 'antiRaid', cfg);
        this.configCache.set(guildId, cfg);
        if (this.lockdownTimers.has(guildId)) {
            clearTimeout(this.lockdownTimers.get(guildId));
            this.lockdownTimers.delete(guildId);
        }
        this.joinRecords.set(guildId, []);
    }
    async setJoinThreshold(guildId, n) {
        const cfg = await this.loadConfig(guildId);
        cfg.joinThreshold = n;
        await configManager.setSetting(guildId, 'antiRaid', cfg);
        this.configCache.set(guildId, cfg);
    }
    async setTimeWindow(guildId, seconds) {
        const cfg = await this.loadConfig(guildId);
        cfg.timeWindow = seconds;
        await configManager.setSetting(guildId, 'antiRaid', cfg);
        this.configCache.set(guildId, cfg);
    }
    async setLockdownDuration(guildId, seconds) {
        const cfg = await this.loadConfig(guildId);
        cfg.lockdownDuration = seconds;
        await configManager.setSetting(guildId, 'antiRaid', cfg);
        this.configCache.set(guildId, cfg);
    }
    async setAction(guildId, action) {
        const cfg = await this.loadConfig(guildId);
        if (action !== 'kick' && action !== 'ban') throw new Error('action deve essere "kick" o "ban"');
        cfg.action = action;
        await configManager.setSetting(guildId, 'antiRaid', cfg);
        this.configCache.set(guildId, cfg);
    }
    async addExemptRole(guildId, roleId) {
        const cfg = await this.loadConfig(guildId);
        if (!Array.isArray(cfg.exemptRoles)) cfg.exemptRoles = [];
        if (!cfg.exemptRoles.includes(roleId)) {
            cfg.exemptRoles.push(roleId);
            await configManager.setSetting(guildId, 'antiRaid', cfg);
            this.configCache.set(guildId, cfg);
        }
    }
    async removeExemptRole(guildId, roleId) {
        const cfg = await this.loadConfig(guildId);
        if (Array.isArray(cfg.exemptRoles) && cfg.exemptRoles.includes(roleId)) {
            cfg.exemptRoles = cfg.exemptRoles.filter(r => r !== roleId);
            await configManager.setSetting(guildId, 'antiRaid', cfg);
            this.configCache.set(guildId, cfg);
        }
    }
    async addExemptUser(guildId, userId) {
        const cfg = await this.loadConfig(guildId);
        if (!Array.isArray(cfg.exemptUsers)) cfg.exemptUsers = [];
        if (!cfg.exemptUsers.includes(userId)) {
            cfg.exemptUsers.push(userId);
            await configManager.setSetting(guildId, 'antiRaid', cfg);
            this.configCache.set(guildId, cfg);
        }
    }
    async removeExemptUser(guildId, userId) {
        const cfg = await this.loadConfig(guildId);
        if (Array.isArray(cfg.exemptUsers) && cfg.exemptUsers.includes(userId)) {
            cfg.exemptUsers = cfg.exemptUsers.filter(u => u !== userId);
            await configManager.setSetting(guildId, 'antiRaid', cfg);
            this.configCache.set(guildId, cfg);
        }
    }

    /** Per debug: restituisce config corrente in cache */
    getCachedConfig(guildId) {
        return this.configCache.get(guildId) || null;
    }
}

module.exports = AntiRaidManager;