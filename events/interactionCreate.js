// events/interactionCreate.js

const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('confirm_join_')) return;

        await interaction.deferReply(); // risposta pubblica

        const guildId = interaction.customId.split('_')[2];

        // ─── 1) Pending Setup ───
        const pendingSetup = await setupManager.getPendingSetup(guildId);
        if (pendingSetup) {
            const { groupId, premiumKey, invokingChannelId } = pendingSetup;

            // Se c’è già config definitiva → “Already Configured”
            const existingCfg = await setupManager.getConfig(guildId);
            if (existingCfg && existingCfg.groupId) {
                return interaction.editReply({
                    content: '🚫 This server is already configured with a group.'
                });
            }

            try {
                // 1.b) Imposto cookie Roblox
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                // 1.c) Ottengo info sull’account bot
                const botUser = await noblox.getAuthenticatedUser();
                const botUserId = botUser.id || botUser.UserID;
                if (!botUserId) {
                    throw new Error('Could not determine bot user ID from getAuthenticatedUser()');
                }

                // 1.d) Assicura che groupId sia numero
                const numericGroupId = Number(groupId);
                if (isNaN(numericGroupId)) {
                    return interaction.editReply({
                        content: '❌ The stored Group ID is invalid.'
                    });
                }

                // 1.e) Controllo rank del bot nel gruppo
                const botRank = await noblox.getRankInGroup(numericGroupId, botUserId);
                if (botRank === 0) {
                    return interaction.editReply({
                        content: '❌ The bot is still **not in the group**. Please add it and try again.'
                    });
                }

                // 1.f) Bot è nel gruppo: cancella pendingSetup e salva config definitiva
                await setupManager.clearPendingSetup(guildId);
                const configData = {
                    groupId,
                    premiumKey,
                    roleBindings: []
                };
                await setupManager.setConfig(guildId, configData);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Bot Configured Successfully')
                    .setDescription([
                        `**Group ID:** \`${groupId}\``,
                        'The bot has been found in the group and is now fully configured.'
                    ].join('\n'))
                    .setColor(0x57f287)
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                // 1.g) Notifica nel canale originario (/setup)
                try {
                    const originalChannel = await interaction.client.channels.fetch(invokingChannelId);
                    if (originalChannel && originalChannel.isTextBased()) {
                        await originalChannel.send({
                            content: `✅ The bot has been successfully added to Group **${groupId}** and is now configured!`
                        });
                    }
                } catch (err) {
                    console.error('❌ Failed to send notification to original channel:', err);
                }

                return;
            } catch (err) {
                console.error('❌ Error during confirm_join (setup) flow:', err);
                return interaction.editReply({
                    content:
                        '❌ Something went wrong while verifying the bot’s group membership. Please try again later.'
                });
            }
        }

        // ─── 2) Pending Transfer ───
        const pendingTransfer = await setupManager.getPendingTransfer(guildId);
        if (pendingTransfer) {
            const { oldGroupId, newGroupId, invokingChannelId } = pendingTransfer;

            // Verifica che esista config definitiva
            const existingCfg = await setupManager.getConfig(guildId);
            if (!existingCfg || !existingCfg.groupId) {
                return interaction.editReply({
                    content: '❌ There is no existing configuration on this server to transfer.'
                });
            }

            // Se il groupId attuale è già uguale a newGroupId → blocco
            if (existingCfg.groupId === newGroupId) {
                return interaction.editReply({
                    content: '❌ You cannot transfer to the same group that is already configured.'
                });
            }

            try {
                // 2.c) Imposto cookie Roblox
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                // 2.d) Ottengo info sul bot
                const botUser = await noblox.getAuthenticatedUser();
                const botUserId = botUser.id || botUser.UserID;
                if (!botUserId) {
                    throw new Error('Could not determine bot user ID from getAuthenticatedUser()');
                }

                // 2.e) Assicura che newGroupId sia numero
                const numericNewGroupId = Number(newGroupId);
                if (isNaN(numericNewGroupId)) {
                    return interaction.editReply({
                        content: '❌ The new Group ID is invalid.'
                    });
                }

                // 2.f) Controllo rank del bot nel nuovo gruppo
                const botRank = await noblox.getRankInGroup(numericNewGroupId, botUserId);
                if (botRank === 0) {
                    return interaction.editReply({
                        content: '❌ The bot is still **not in the new group**. Please add it and try again.'
                    });
                }

                // 2.g) Bot è nel nuovo gruppo: cancella pendingTransfer e aggiorna config
                await setupManager.clearPendingTransfer(guildId);
                const updatedCfg = {
                    ...existingCfg,
                    groupId: newGroupId
                };
                await setupManager.setConfig(guildId, updatedCfg);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Setup Transferred')
                    .setDescription([
                        `• **Old Group ID:** \`${oldGroupId}\``,
                        `• **New Group ID:** \`${newGroupId}\``,
                        'The bot has been found in the new group and the setup has been transferred successfully.'
                    ].join('\n'))
                    .setColor(0x57f287)
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                // 2.h) Notifica nel canale originario (/transfer-group)
                try {
                    const originalChannel = await interaction.client.channels.fetch(invokingChannelId);
                    if (originalChannel && originalChannel.isTextBased()) {
                        await originalChannel.send({
                            content: `✅ The bot has been successfully moved from Group **${oldGroupId}** to **${newGroupId}**!`
                        });
                    }
                } catch (err) {
                    console.error('❌ Failed to send notification to original channel:', err);
                }

                return;
            } catch (err) {
                console.error('❌ Error during confirm_join (transfer) flow:', err);
                return interaction.editReply({
                    content:
                        '❌ Something went wrong while verifying the bot’s group membership in the new group. Please try again later.'
                });
            }
        }

        // ─── 3) Se non c’è né pendingSetup né pendingTransfer ───
        return interaction.editReply({
            content: '❌ No pending setup or transfer found for this server.'
        });
    }
};