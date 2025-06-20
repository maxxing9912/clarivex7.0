// events/interactionCreate.js

const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

// Suppress deprecation warnings if not already suppressed
noblox.setOptions({ show_deprecation_warnings: false });

module.exports = {
    name: Events.InteractionCreate,
    /**
     * Handles Button interactions whose customId starts with "confirm_join_"
     * for both initial setup and group transfer flows.
     * @param {import('discord.js').ButtonInteraction} interaction 
     */
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('confirm_join_')) return;

        // Defer reply as ephemeral so only the clicker sees it
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (err) {
            console.warn('[ConfirmJoin] Could not defer reply:', err);
        }

        // Extract guildId from customId = "confirm_join_<guildId>"
        const parts = interaction.customId.split('_');
        const guildId = parts.slice(2).join('_');
        console.log(`[ConfirmJoin] Button clicked: customId="${interaction.customId}", extracted guildId="${guildId}", interaction.guildId="${interaction.guildId}"`);

        // --- 1) Check pending setup ---
        let pendingSetup;
        try {
            pendingSetup = await setupManager.getPendingSetup(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] Error in getPendingSetup:', err);
            return interaction.editReply({
                content: '❌ Internal error: failed to retrieve pending setup. Please try again later.'
            });
        }
        console.log('[ConfirmJoin] pendingSetup:', pendingSetup);

        if (pendingSetup) {
            // Adapt these property names to what you actually saved in setupManager.setPendingSetup:
            const { groupId, premiumKey, requestingChannelId /* or invokingChannelId */ } = pendingSetup;

            // Check if already configured:
            let existingCfg;
            try {
                existingCfg = await setupManager.getConfig(guildId);
            } catch (err) {
                console.error('[ConfirmJoin] Error in getConfig (setup flow):', err);
                return interaction.editReply({
                    content: '❌ Internal error: failed to verify existing configuration.'
                });
            }
            if (existingCfg && existingCfg.groupId) {
                return interaction.editReply({
                    content: '🚫 This server is already configured with a Roblox group.'
                });
            }

            try {
                // Ensure ROBLOX_COOKIE is set
                if (!process.env.ROBLOX_COOKIE) {
                    console.error('[ConfirmJoin] ROBLOX_COOKIE is not set');
                    return interaction.editReply({
                        content: '❌ Configuration error: ROBLOX_COOKIE is missing on the bot.'
                    });
                }
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                // Get bot's Roblox user
                const botUser = await noblox.getAuthenticatedUser();
                console.log('[ConfirmJoin] getAuthenticatedUser returned:', botUser);
                const botUserId = botUser.id ?? botUser.UserID;
                if (!botUserId) {
                    console.error('[ConfirmJoin] Could not determine botUserId from getAuthenticatedUser():', botUser);
                    throw new Error('Could not determine bot user ID');
                }

                // Validate stored groupId
                const numericGroupId = Number(groupId);
                if (isNaN(numericGroupId)) {
                    console.warn('[ConfirmJoin] Stored groupId is invalid:', groupId);
                    return interaction.editReply({
                        content: '❌ The stored Group ID is invalid.'
                    });
                }

                // Check bot rank in group
                let botRank;
                try {
                    botRank = await noblox.getRankInGroup(numericGroupId, botUserId);
                } catch (err) {
                    console.warn('[ConfirmJoin] getRankInGroup failed:', err);
                    botRank = 0;
                }
                console.log(`[ConfirmJoin] Bot rank in group ${numericGroupId}:`, botRank);

                if (!botRank || botRank === 0) {
                    return interaction.editReply({
                        content: '❌ The bot is not yet a member of the Roblox group. Please add the bot to the group and click again.'
                    });
                }

                // Bot is in the group: save final config
                try {
                    // Optionally clear pending explicitly; setConfig may clear it internally
                    await setupManager.clearPendingSetup(guildId);
                } catch (err) {
                    console.warn('[ConfirmJoin] clearPendingSetup failed (continuing):', err);
                }
                const configData = {
                    groupId: String(groupId),
                    premiumKey: premiumKey ?? null,
                    roleBindings: [],
                    // other initial config fields if needed
                };
                try {
                    await setupManager.setConfig(guildId, configData);
                } catch (err) {
                    console.error('[ConfirmJoin] setConfig failed:', err);
                    return interaction.editReply({
                        content: '❌ Internal error: failed to save the final configuration.'
                    });
                }

                // Send success embed to the user who clicked
                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Bot Configured Successfully')
                    .setDescription([
                        `**Group ID:** \`${groupId}\``,
                        'The bot was found in the group and configuration is now complete.'
                    ].join('\n'))
                    .setColor(0x57f287)
                    .setTimestamp();
                await interaction.editReply({ embeds: [successEmbed] });

                // Notify the original channel where /setup was invoked
                if (requestingChannelId) {
                    try {
                        const originalChannel = await interaction.client.channels.fetch(requestingChannelId);
                        if (originalChannel && originalChannel.isTextBased()) {
                            await originalChannel.send({
                                content: `✅ The bot has been successfully added to Roblox Group **${groupId}** and is now configured!`
                            });
                        } else {
                            console.warn('[ConfirmJoin] Original channel not found or not text-based:', requestingChannelId);
                        }
                    } catch (err) {
                        console.error('[ConfirmJoin] Failed to notify original channel:', err);
                    }
                } else {
                    console.warn('[ConfirmJoin] requestingChannelId not defined in pendingSetup');
                }

                return;
            } catch (err) {
                console.error('[ConfirmJoin] Error during setup confirmation flow:', err);
                return interaction.editReply({
                    content: '❌ Something went wrong while verifying the bot’s membership in the Roblox group. Please try again later.'
                });
            }
        }

        // --- 2) Check pending transfer ---
        let pendingTransfer;
        try {
            pendingTransfer = await setupManager.getPendingTransfer(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] Error in getPendingTransfer:', err);
            pendingTransfer = null;
        }
        console.log('[ConfirmJoin] pendingTransfer:', pendingTransfer);

        if (pendingTransfer) {
            // Adapt property names to how you saved them
            const { oldGroupId, newGroupId, requestingChannelId /* or invokingChannelId */ } = pendingTransfer;

            // Verify existing config
            let existingCfg;
            try {
                existingCfg = await setupManager.getConfig(guildId);
            } catch (err) {
                console.error('[ConfirmJoin] Error in getConfig (transfer flow):', err);
                return interaction.editReply({
                    content: '❌ Internal error: failed to retrieve existing configuration.'
                });
            }
            if (!existingCfg || !existingCfg.groupId) {
                return interaction.editReply({
                    content: '❌ There is no existing configuration on this server to transfer.'
                });
            }
            if (existingCfg.groupId === String(newGroupId)) {
                return interaction.editReply({
                    content: '❌ Cannot transfer to the same group that is already configured.'
                });
            }

            try {
                if (!process.env.ROBLOX_COOKIE) {
                    console.error('[ConfirmJoin-Transfer] ROBLOX_COOKIE is not set');
                    return interaction.editReply({
                        content: '❌ Configuration error: ROBLOX_COOKIE is missing on the bot.'
                    });
                }
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                const botUser = await noblox.getAuthenticatedUser();
                console.log('[ConfirmJoin-Transfer] getAuthenticatedUser returned:', botUser);
                const botUserId = botUser.id ?? botUser.UserID;
                if (!botUserId) {
                    console.error('[ConfirmJoin-Transfer] Could not determine botUserId:', botUser);
                    throw new Error('Could not determine bot user ID');
                }

                const numericNewGroupId = Number(newGroupId);
                if (isNaN(numericNewGroupId)) {
                    return interaction.editReply({
                        content: '❌ The new Group ID is invalid.'
                    });
                }

                let botRank;
                try {
                    botRank = await noblox.getRankInGroup(numericNewGroupId, botUserId);
                } catch (err) {
                    console.warn('[ConfirmJoin-Transfer] getRankInGroup failed:', err);
                    botRank = 0;
                }
                console.log(`[ConfirmJoin-Transfer] Bot rank in new group ${numericNewGroupId}:`, botRank);

                if (!botRank || botRank === 0) {
                    return interaction.editReply({
                        content: '❌ The bot is not yet a member of the new Roblox group. Please add it to that group and click again.'
                    });
                }

                // Bot is in the new group: save updated config
                try {
                    await setupManager.clearPendingTransfer(guildId);
                } catch (err) {
                    console.warn('[ConfirmJoin-Transfer] clearPendingTransfer failed (continuing):', err);
                }
                const updatedCfg = {
                    ...existingCfg,
                    groupId: String(newGroupId)
                };
                try {
                    await setupManager.setConfig(guildId, updatedCfg);
                } catch (err) {
                    console.error('[ConfirmJoin-Transfer] setConfig failed:', err);
                    return interaction.editReply({
                        content: '❌ Internal error: failed to save the updated configuration.'
                    });
                }

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Setup Transferred')
                    .setDescription([
                        `• **Old Group ID:** \`${oldGroupId}\``,
                        `• **New Group ID:** \`${newGroupId}\``,
                        'The bot was found in the new group and transfer is now complete.'
                    ].join('\n'))
                    .setColor(0x57f287)
                    .setTimestamp();
                await interaction.editReply({ embeds: [successEmbed] });

                // Notify original channel where /transfer-group was invoked
                if (requestingChannelId) {
                    try {
                        const originalChannel = await interaction.client.channels.fetch(requestingChannelId);
                        if (originalChannel && originalChannel.isTextBased()) {
                            await originalChannel.send({
                                content: `✅ The bot has been successfully moved from Roblox Group **${oldGroupId}** to **${newGroupId}**!`
                            });
                        } else {
                            console.warn('[ConfirmJoin-Transfer] Original channel not found or not text-based:', requestingChannelId);
                        }
                    } catch (err) {
                        console.error('[ConfirmJoin-Transfer] Failed to notify original channel:', err);
                    }
                } else {
                    console.warn('[ConfirmJoin-Transfer] requestingChannelId not defined in pendingTransfer');
                }

                return;
            } catch (err) {
                console.error('[ConfirmJoin-Transfer] Error during transfer confirmation flow:', err);
                return interaction.editReply({
                    content: '❌ Something went wrong while verifying the bot’s membership in the new Roblox group. Please try again later.'
                });
            }
        }

        // --- 3) No pending setup or transfer found ---
        return interaction.editReply({
            content: '❌ No pending setup or transfer found for this server.'
        });
    }
};
