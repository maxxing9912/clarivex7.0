// events/interactionCreate.js

const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

noblox.setOptions({ show_deprecation_warnings: false });

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('confirm_join_')) return;

        await interaction.deferReply({ ephemeral: true });

        // 1) Estrai guildId dal customId: confirm_join_<guildId>
        let guildId = interaction.customId.split('_').slice(2).join('_');
        console.log(`[ConfirmJoin] Button clicked: customId="${interaction.customId}", extracted guildId="${guildId}", interaction.guildId="${interaction.guildId}"`);

        // 2) Prova a leggere pendingSetup per guildId estratto
        let pending;
        try {
            pending = await setupManager.getPendingSetup(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] getPendingSetup error:', err);
            return interaction.editReply('❌ Internal error retrieving pending setup.');
        }

        // 3) Se non trovato e guildId estratto differente, prova fallback con interaction.guildId
        if (!pending && guildId !== interaction.guildId) {
            console.log(`[ConfirmJoin] No pendingSetup for extracted guildId="${guildId}", trying fallback "${interaction.guildId}"`);
            try {
                const fb = await setupManager.getPendingSetup(interaction.guildId);
                if (fb) {
                    pending = fb;
                    guildId = interaction.guildId;
                    console.log('[ConfirmJoin] Found pendingSetup in fallback guildId');
                }
            } catch (err) {
                console.error('[ConfirmJoin] fallback getPendingSetup error:', err);
            }
        }

        // 4) Se non esiste pendingSetup, verifichiamo se esiste già config definitiva
        if (!pending) {
            let cfg;
            try {
                cfg = await setupManager.getConfig(interaction.guildId);
            } catch (err) {
                console.error('[ConfirmJoin] getConfig error:', err);
                return interaction.editReply('❌ Internal error checking existing configuration.');
            }
            if (cfg && cfg.groupId) {
                // Server già configurato
                return interaction.editReply({
                    content: `✅ This server is already configured with Roblox Group ID \`${cfg.groupId}\`. Use /update to sync roles.`
                });
            }
            // Nessun pending e nessuna config: il flusso non è stato inizializzato
            return interaction.editReply('❌ No pending setup found for this server.');
        }

        // 5) pendingSetup esiste: procedi con verifica membership e salvataggio config
        const { groupId, premiumKey, invokingChannelId, ownerDiscordId } = pending;
        // Controlla se nel frattempo è già stata salvata config (race condition)
        let existingCfg;
        try {
            existingCfg = await setupManager.getConfig(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] getConfig error before saving config:', err);
            return interaction.editReply('❌ Internal error checking existing configuration.');
        }
        if (existingCfg && existingCfg.groupId) {
            // Puliamo pending stale e notifichiamo
            try {
                await setupManager.clearPendingSetup(guildId);
            } catch (e) {
                console.warn('[ConfirmJoin] clearPendingSetup error:', e);
            }
            return interaction.editReply({
                content: `✅ This server was already configured with Roblox Group ID \`${existingCfg.groupId}\`. Pending cleared. Use /update to sync roles.`
            });
        }

        // 6) Verifica membership Roblox
        try {
            if (!process.env.ROBLOX_COOKIE) {
                console.error('[ConfirmJoin] ROBLOX_COOKIE not set');
                return interaction.editReply('❌ Configuration error: ROBLOX_COOKIE is missing.');
            }
            await noblox.setCookie(process.env.ROBLOX_COOKIE);

            const botUser = await noblox.getAuthenticatedUser();
            const botUserId = botUser.id ?? botUser.UserID;
            if (!botUserId) {
                console.error('[ConfirmJoin] Could not determine botUserId:', botUser);
                return interaction.editReply('❌ Could not determine Roblox bot user ID.');
            }

            const numericGroupId = Number(groupId);
            if (isNaN(numericGroupId)) {
                return interaction.editReply('❌ Stored Group ID is invalid.');
            }

            let botRank;
            try {
                botRank = await noblox.getRankInGroup(numericGroupId, botUserId);
            } catch (err) {
                console.warn('[ConfirmJoin] getRankInGroup error:', err);
                botRank = 0;
            }
            console.log(`[ConfirmJoin] Bot rank in group ${numericGroupId}:`, botRank);

            if (!botRank || botRank === 0) {
                return interaction.editReply('❌ The bot is not yet a member of the Roblox group. Please add it and click again.');
            }

            // 7) Bot è nel gruppo: salva config definitiva
            try {
                await setupManager.clearPendingSetup(guildId);
            } catch (e) {
                console.warn('[ConfirmJoin] clearPendingSetup error:', e);
            }
            const configData = {
                groupId: String(groupId),
                premiumKey: premiumKey ?? null,
                roleBindings: [],
                verificationRoleId: null,
                unverifiedRoleId: null,
                bypassRoleId: null
            };
            try {
                await setupManager.setConfig(guildId, configData);
            } catch (err) {
                console.error('[ConfirmJoin] setConfig error:', err);
                return interaction.editReply('❌ Internal error: failed to save configuration.');
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Bot Configured Successfully')
                .setDescription([
                    `**Group ID:** \`${groupId}\``,
                    'The bot was found in the group and setup is complete.'
                ].join('\n'))
                .setColor(0x57f287)
                .setTimestamp();
            await interaction.editReply({ embeds: [successEmbed] });

            // 8) Notifica al canale che ha invocato setup
            if (invokingChannelId) {
                try {
                    const orig = await interaction.client.channels.fetch(invokingChannelId);
                    if (orig && orig.isTextBased()) {
                        await orig.send({
                            content: `✅ The bot has been successfully added to Roblox Group **${groupId}** and is now configured!`
                        });
                    }
                } catch (err) {
                    console.error('[ConfirmJoin] error notifying original channel:', err);
                }
            }
        } catch (err) {
            console.error('[ConfirmJoin] error during membership check or config save:', err);
            return interaction.editReply('❌ Something went wrong while verifying group membership. Please try again later.');
        }
    }
};
