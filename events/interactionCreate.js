// events/interactionCreate.js

const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

// Sopprimi warning deprecazione se vuoi
noblox.setOptions({ show_deprecation_warnings: false });

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('confirm_join_')) return;

        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (err) {
            console.warn('[ConfirmJoin] deferReply failed:', err);
        }

        let guildId = interaction.customId.split('_').slice(2).join('_');
        console.log(`[ConfirmJoin] Button clicked: customId="${interaction.customId}", extracted guildId="${guildId}", interaction.guildId="${interaction.guildId}"`);

        // 1) tenta pendingSetup su guildId estratto
        let pending = null;
        try {
            pending = await setupManager.getPendingSetup(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] getPendingSetup error:', err);
            return interaction.editReply({ content: '❌ Internal error retrieving pending setup.' });
        }

        // 2) fallback se estratto != interaction.guildId
        if (!pending && guildId !== interaction.guildId) {
            console.warn(`[ConfirmJoin] No pendingSetup for extracted guildId="${guildId}", trying fallback "${interaction.guildId}"`);
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

        if (!pending) {
            // verifichiamo se c'è già config definitiva: se sì, comunichiamo “già configurato”
            const cfg = await setupManager.getConfig(interaction.guildId);
            if (cfg && cfg.groupId) {
                return interaction.editReply({ content: '✅ This server is already configured with a Roblox group.' });
            }
            return interaction.editReply({ content: '❌ No pending setup found for this server.' });
        }

        // pending esiste
        const { groupId, premiumKey, invokingChannelId, ownerDiscordId } = pending;
        // 3) Verifica se config già esistente
        const existingCfg = await setupManager.getConfig(guildId);
        if (existingCfg && existingCfg.groupId) {
            // pulisci pending e rispondi
            await setupManager.clearPendingSetup(guildId);
            return interaction.editReply({ content: '✅ This server was already configured; pending removed.' });
        }

        // 4) Verifica membership Roblox: 
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
                throw new Error('Could not determine bot user ID');
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

            // 5) Bot è nel gruppo: salva config definitivo
            await setupManager.clearPendingSetup(guildId);
            const configData = {
                groupId: String(groupId),
                premiumKey: premiumKey ?? null,
                roleBindings: [],           // personalizza più tardi con altri comandi
                verificationRoleId: null,
                unverifiedRoleId: null,
                bypassRoleId: null
            };
            await setupManager.setConfig(guildId, configData);

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Bot Configured Successfully')
                .setDescription([
                    `**Group ID:** \`${groupId}\``,
                    'The bot was found in the group and setup is complete.'
                ].join('\n'))
                .setColor(0x57f287)
                .setTimestamp();
            await interaction.editReply({ embeds: [successEmbed] });

            // Notifica al canale che ha invocato setup
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
            console.error('[ConfirmJoin] error during confirmation flow:', err);
            return interaction.editReply('❌ Something went wrong while verifying membership. Please try again later.');
        }
    }
};
