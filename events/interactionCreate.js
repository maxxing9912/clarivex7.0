// events/interactionCreate.js

const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

// Suppress deprecation warnings if not already done
noblox.setOptions({ show_deprecation_warnings: false });

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('confirm_join_')) return;

        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (err) {
            console.warn('[ConfirmJoin] Could not defer reply:', err);
        }

        // Extract guildId from customId: confirm_join_<guildId>
        const parts = interaction.customId.split('_');
        let guildId = parts.slice(2).join('_'); // in case underscores, but guild IDs are numeric so safe
        console.log(`[ConfirmJoin] Button clicked: customId="${interaction.customId}", extracted guildId="${guildId}", interaction.guildId="${interaction.guildId}"`);

        // Try pendingSetup under extracted guildId
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

        // If not found under extracted guildId, but extracted differs from actual, try fallback
        if (!pendingSetup && guildId !== interaction.guildId) {
            console.warn(`[ConfirmJoin] No pendingSetup for extracted guildId="${guildId}". Trying fallback guildId="${interaction.guildId}".`);
            try {
                const fallback = await setupManager.getPendingSetup(interaction.guildId);
                if (fallback) {
                    console.log('[ConfirmJoin] Found pendingSetup under interaction.guildId as fallback.');
                    pendingSetup = fallback;
                    guildId = interaction.guildId;
                }
            } catch (err) {
                console.error('[ConfirmJoin] Error in fallback getPendingSetup:', err);
            }
        }

        if (pendingSetup) {
            // Destructure exactly what we saved in setupManager.setPendingSetup
            const { groupId, premiumKey, requestingChannelId } = pendingSetup;

            // Check if already configured
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

            // Verify Roblox membership
            try {
                if (!process.env.ROBLOX_COOKIE) {
                    console.error('[ConfirmJoin] ROBLOX_COOKIE not set');
                    return interaction.editReply({
                        content: '❌ Configuration error: ROBLOX_COOKIE is missing.'
                    });
                }
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                const botUser = await noblox.getAuthenticatedUser();
                console.log('[ConfirmJoin] getAuthenticatedUser returned:', botUser);
                const botUserId = botUser.id ?? botUser.UserID;
                if (!botUserId) {
                    console.error('[ConfirmJoin] Could not determine botUserId:', botUser);
                    throw new Error('Could not determine bot user ID');
                }

                const numericGroupId = Number(groupId);
                if (isNaN(numericGroupId)) {
                    console.warn('[ConfirmJoin] Stored groupId invalid:', groupId);
                    return interaction.editReply({
                        content: '❌ The stored Group ID is invalid.'
                    });
                }

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
                        content: '❌ The bot is not yet a member of the Roblox group. Please add it to the group and click again.'
                    });
                }

                // Bot is in group: clear pending and save config
                try {
                    await setupManager.clearPendingSetup(guildId);
                } catch (err) {
                    console.warn('[ConfirmJoin] clearPendingSetup failed:', err);
                }
                const configData = {
                    groupId: String(groupId),
                    premiumKey: premiumKey ?? null,
                    roleBindings: []
                };
                try {
                    await setupManager.setConfig(guildId, configData);
                } catch (err) {
                    console.error('[ConfirmJoin] setConfig failed:', err);
                    return interaction.editReply({
                        content: '❌ Internal error: failed to save configuration.'
                    });
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

                // Notify original invoking channel
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
                    content: '❌ Something went wrong while verifying membership. Please try again later.'
                });
            }
        }

        // If no pendingSetup, check pendingTransfer (optional)...
        let pendingTransfer;
        try {
            pendingTransfer = await setupManager.getPendingTransfer(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] Error in getPendingTransfer:', err);
            pendingTransfer = null;
        }
        console.log('[ConfirmJoin] pendingTransfer:', pendingTransfer);

        if (pendingTransfer) {
            // Similar flow for transfer: verify new group membership, then clearPendingTransfer + setConfig
            const { oldGroupId, newGroupId, requestingChannelId } = pendingTransfer;
            // ... implement as needed (omitted here for brevity) ...
            // After finishing transfer, return interaction.editReply(...) and notify original channel.
            // ...
            return;
        }

        // No pending found
        return interaction.editReply({
            content: '❌ No pending setup or transfer found for this server.'
        });
    }
};
