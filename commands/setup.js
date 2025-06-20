// commands/setup.js

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');
const setupManager = require('../utils/setupManager');
const xpDb = require('../xpManager');
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
        const channelId = interaction.channel.id;
        const groupId = interaction.options.getString('groupid');
        const premiumKey = interaction.options.getString('premiumkey') || null;

        console.log(`[setup] Invoked by guild ${guildId}, user ${userId}, requested group ${groupId}`);

        // 0) Check if already configured definitively in questo server
        let existingCfg;
        try {
            existingCfg = await setupManager.getConfig(guildId);
        } catch (err) {
            console.error('[setup] Error in getConfig:', err);
            return interaction.editReply('❌ Internal error while checking existing configuration.');
        }
        if (existingCfg && existingCfg.groupId) {
            if (String(existingCfg.groupId) === String(groupId)) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('✅ Server Already Configured')
                            .setDescription(
                                `This server is already configured with Roblox Group ID \`${existingCfg.groupId}\`.\n` +
                                `Use \`/update\` to sync roles or perform other actions.`
                            )
                            .setColor('Green')
                            .setTimestamp()
                    ]
                });
            } else {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Server Already Configured')
                            .setDescription(
                                `This server is already configured with Roblox Group ID \`${existingCfg.groupId}\`.\n` +
                                `If you want to change group, use \`/transfer-group\`.`
                            )
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            }
        }

        // 1) Controlla se questo Roblox group è già configurato in un altro server
        try {
            const otherGuild = await setupManager.findGuildByGroupId(groupId);
            if (otherGuild && otherGuild !== guildId) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Group Already Configured Elsewhere')
                            .setDescription('This Roblox group is already configured in another server.')
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            }
        } catch (err) {
            console.error('[setup] Error in findGuildByGroupId:', err);
            return interaction.editReply('❌ Internal error while checking group configuration.');
        }

        // 2) Controlla se c'è già una pending setup in questo server
        let existingPending;
        try {
            existingPending = await setupManager.getPendingSetup(guildId);
        } catch (err) {
            console.error('[setup] Error in getPendingSetup:', err);
            return interaction.editReply('❌ Internal error while checking pending setup.');
        }
        if (existingPending) {
            if (String(existingPending.groupId) === String(groupId)) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Pending Setup Already Exists')
                            .setDescription('You already have a pending setup request for this same group. Please wait for confirmation or cancel it.')
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            } else {
                return interaction.editReply({
                    content: '❌ You already have a pending setup for another group. Use `/transfer-group` or wait for the current pending to be confirmed/cleared.'
                });
            }
        }

        // 3) Verifica ownership Roblox e salva pending setup
        let groupInfo;
        try {
            groupInfo = await noblox.getGroup(parseInt(groupId, 10));
        } catch (err) {
            console.error('[setup] noblox.getGroup error:', err);
            return interaction.editReply('❌ Unable to fetch group info. Check the Group ID.');
        }
        const ownerId = groupInfo.owner?.userId;
        if (!ownerId) {
            return interaction.editReply('❌ Cannot determine the group owner.');
        }
        const linked = await xpDb.getLinked(userId);
        if (!linked) {
            return interaction.editReply('❌ You must first link your Roblox account with `/verify`.');
        }
        let linkedId;
        try {
            linkedId = await noblox.getIdFromUsername(linked);
        } catch (err) {
            console.error('[setup] noblox.getIdFromUsername error:', err);
            return interaction.editReply('❌ Unable to verify your Roblox username. Retry linking.');
        }
        if (String(linkedId) !== String(ownerId)) {
            return interaction.editReply('❌ You are not the owner of this Roblox group.');
        }
        // Salva la richiesta pendente in Postgres
        try {
            await setupManager.setPendingSetup(guildId, {
                groupId,
                premiumKey,
                ownerDiscordId: userId,
                invokingChannelId: channelId
            });
            console.log(`[setup] Saved pendingSetup for guild ${guildId}: group ${groupId}`);
        } catch (err) {
            console.error('[setup] Error in setPendingSetup:', err);
            return interaction.editReply('❌ Internal error: could not save pending setup.');
        }

        // Risposta all'utente
        const embedUser = new EmbedBuilder()
            .setTitle('⚙️ Setup Pending')
            .setDescription([
                `**Group ID:** ${groupId}`,
                premiumKey ? `**Premium Key:** \`${premiumKey}\`` : '_No premium key provided_',
                '',
                'Your setup request has been submitted. You will be notified when confirmed.'
            ].join('\n'))
            .setColor(0xffa500)
            .setTimestamp();
        await interaction.editReply({ embeds: [embedUser] });

        // Invia messaggio nel canale pending con bottone
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_join_${guildId}`)
            .setLabel('✅ Confirm Bot in Group')
            .setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder().addComponents(confirmButton);
        const embedPending = new EmbedBuilder()
            .setTitle('🚧 Bot Join Request')
            .addFields(
                { name: 'Server', value: `<#${channelId}>`, inline: true },
                { name: 'User', value: `<@${userId}>`, inline: true },
                { name: 'Group', value: `[${groupId}](https://www.roblox.com/groups/${groupId})`, inline: false },
                { name: '\u200B', value: '⚠️ Add the bot to the group, then click “Confirm Bot in Group”.' }
            )
            .setColor(0xFFA500)
            .setTimestamp();
        const PENDING_CHANNEL_ID = process.env.PENDING_CHANNEL_ID;
        if (!PENDING_CHANNEL_ID) {
            console.error('[setup] PENDING_CHANNEL_ID not set in env.');
        } else {
            try {
                const pendingChannel = await interaction.client.channels.fetch(PENDING_CHANNEL_ID);
                if (pendingChannel?.isTextBased()) {
                    await pendingChannel.send({ embeds: [embedPending], components: [row] });
                    console.log(`[setup] Sent pending embed for guild ${guildId}`);
                } else {
                    console.error(`❌ PENDING_CHANNEL_ID (${PENDING_CHANNEL_ID}) is not a valid text channel.`);
                }
            } catch (sendErr) {
                console.error('[setup] Error sending to pending channel:', sendErr);
            }
        }
    }
};
