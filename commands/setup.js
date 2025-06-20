// commands/setup.js

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');
const setupManager = require('../utils/setupManager');
const xpManager = require('../xpManager');
const noblox = require('noblox.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Create a pending setup request for your Roblox group')
        .addStringOption(opt =>
            opt
                .setName('groupid')
                .setDescription('Your Roblox Group ID (you must be the group owner)')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('premiumkey')
                .setDescription('(Optional) Premium serial key')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const invokingChannelId = interaction.channel.id;
        const groupId = interaction.options.getString('groupid');
        const premiumKey = interaction.options.getString('premiumkey') ?? null;

        console.log(`[Setup] Invoked by user ${userId} in guild ${guildId}, groupId=${groupId}`);

        // 1) Already configured elsewhere?
        let otherGuild;
        try {
            otherGuild = await setupManager.findGuildByGroupId(groupId);
        } catch (err) {
            console.error('[Setup] Error in findGuildByGroupId:', err);
        }
        if (otherGuild && otherGuild !== guildId) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 Group Already Configured')
                        .setDescription('This Roblox group is already configured in another server.')
                        .setColor(0xED4245)
                        .setTimestamp()
                ]
            });
        }

        // 2) Pending elsewhere?
        let pendingElsewhere;
        try {
            pendingElsewhere = await setupManager.findPendingGuildByGroupId(groupId);
        } catch (err) {
            console.error('[Setup] Error in findPendingGuildByGroupId:', err);
        }
        if (pendingElsewhere && pendingElsewhere !== guildId) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 Pending Setup Exists Elsewhere')
                        .setDescription('There is already a pending setup request for this group in another server.')
                        .setColor(0xED4245)
                        .setTimestamp()
                ]
            });
        }

        // 3) This server already configured?
        let existingConfig;
        try {
            existingConfig = await setupManager.getConfig(guildId);
        } catch (err) {
            console.error('[Setup] Error in getConfig:', err);
        }
        if (existingConfig?.groupId) {
            if (existingConfig.groupId === groupId) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Already Configured')
                            .setDescription('This server is already configured with that same Roblox group.')
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            } else {
                return interaction.editReply({
                    content: '❌ You already have a different group configured. Use `/transfer-group` to change it.'
                });
            }
        }

        // 4) Pending in this server?
        let existingPending;
        try {
            existingPending = await setupManager.getPendingSetup(guildId);
        } catch (err) {
            console.error('[Setup] Error in getPendingSetup:', err);
        }
        if (existingPending) {
            if (existingPending.groupId === groupId) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Pending Setup Already Exists')
                            .setDescription('You already have a pending setup request for this group in this server.')
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            } else {
                return interaction.editReply({
                    content: '❌ You already have a pending setup. Use `/transfer-group` or wait for confirmation.'
                });
            }
        }

        // 5) Fetch Roblox group & verify ownership
        let groupInfo;
        try {
            groupInfo = await noblox.getGroup(parseInt(groupId, 10));
        } catch (err) {
            console.error('[Setup] Unable to fetch group info:', err);
            return interaction.editReply('❌ Unable to fetch group info. Please check the Group ID.');
        }
        const ownerId = groupInfo.owner?.userId;
        if (!ownerId) {
            return interaction.editReply('❌ Unable to determine the group owner.');
        }

        // 6) Verify user linked Roblox account
        let linkedUsername;
        try {
            linkedUsername = await xpManager.getRobloxId(userId);
        } catch (err) {
            console.error('[Setup] Error in getRobloxId:', err);
        }
        if (!linkedUsername) {
            return interaction.editReply('❌ You must first link your Roblox account with `/verify`.');
        }
        let linkedUserId;
        try {
            linkedUserId = await noblox.getIdFromUsername(linkedUsername);
        } catch (err) {
            console.error('[Setup] Unable to verify linked Roblox username:', err);
            return interaction.editReply('❌ Unable to verify your Roblox username. Please relink and try again.');
        }
        if (String(linkedUserId) !== String(ownerId)) {
            return interaction.editReply('❌ You are not the owner of this Roblox group.');
        }

        // 7) Save pending setup under this Discord guild ID
        try {
            const pendingData = {
                groupId,
                premiumKey,
                ownerDiscordId: userId,
                requestingChannelId: invokingChannelId
            };
            await setupManager.setPendingSetup(guildId, pendingData);
            console.log(`[Setup] Saved pendingSetup for guild ${guildId}:`, pendingData);
        } catch (err) {
            console.error('[Setup] Error in setPendingSetup:', err);
            return interaction.editReply('❌ Internal error: could not save pending setup.');
        }

        // 8) Inform the user the setup is pending
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⚙️ Setup Pending')
                    .setDescription(
                        `**Group ID:** ${groupId}\n` +
                        (premiumKey ? `**Premium Key:** \`${premiumKey}\`` : '_No premium key provided_') +
                        '\n\nYour request is pending. You will be notified upon confirmation.'
                    )
                    .setColor(0xFFA500)
                    .setTimestamp()
            ]
        });

        // 9) Send the pending-request embed + button to the pending channel
        const confirmButton = new ButtonBuilder()
            // <-- Use Discord guild ID here to build customId
            .setCustomId(`confirm_join_${guildId}`)
            .setLabel('✅ Confirm Bot Is In Group')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(confirmButton);

        const pendingEmbed = new EmbedBuilder()
            .setTitle('🚧 Bot Join Request')
            .addFields(
                { name: 'Server', value: `<#${invokingChannelId}>`, inline: true },
                { name: 'User', value: `<@${userId}>`, inline: true },
                { name: 'Roblox Group', value: `[${groupId}](https://www.roblox.com/groups/${groupId})`, inline: false },
                { name: '\u200B', value: '⚠️ Add the bot to the Roblox group, then click **Confirm Bot Is In Group**.' }
            )
            .setColor(0xFFA500)
            .setTimestamp();

        const PENDING_CHANNEL_ID = process.env.PENDING_CHANNEL_ID;
        console.log(`[Setup] Attempting to notify pending channel: PENDING_CHANNEL_ID=${PENDING_CHANNEL_ID}`);
        if (!PENDING_CHANNEL_ID) {
            console.error('[Setup] PENDING_CHANNEL_ID not set in .env, skipping pending notification');
        } else {
            try {
                const pendingChannel = await interaction.client.channels.fetch(PENDING_CHANNEL_ID);
                console.log('[Setup] Fetched pendingChannel:', pendingChannel);
                if (pendingChannel && pendingChannel.isTextBased()) {
                    await pendingChannel.send({ embeds: [pendingEmbed], components: [row] });
                    console.log('[Setup] Sent pending embed with button to pending channel');
                } else {
                    console.error(`[Setup] pendingChannel is null or not text-based: id=${PENDING_CHANNEL_ID}`);
                }
            } catch (err) {
                console.error('[Setup] Error sending to pending channel:', err);
            }
        }
    }
};
