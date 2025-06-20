// commands/transfer-group.js

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ChannelType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require('discord.js');
const setupManager = require('../utils/setupManager');
const permManager = require('../utils/permManager');
const xpDb = require('../xpManager');
const noblox = require('noblox.js');

const PENDING_CHANNEL_ID = '1379780298203730112';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transfer-group')
        .setDescription('Transfer the bot’s configuration from the current Roblox group to a new one.')
        .addStringOption(opt =>
            opt
                .setName('newgroupid')
                .setDescription('The Roblox Group ID you want to transfer the setup to (you must be the new group owner)')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply(); // resa pubblica per default

            const invokingUserId = interaction.user.id;
            const guildId = interaction.guild.id;
            const channelId = interaction.channel.id;
            const newGroupId = interaction.options.getString('newgroupid');

            // 1) Controlla se esiste una config definitiva con groupId valido
            const currentCfg = await setupManager.getConfig(guildId);
            if (!currentCfg || !currentCfg.groupId) {
                return interaction.editReply({
                    content: '❌ There is no current group configuration. Use `/setup` instead.'
                });
            }

            // 2) Se il nuovo ID coincide con quello esistente, blocca
            if (currentCfg.groupId === newGroupId) {
                return interaction.editReply({
                    content: '❌ You cannot transfer to the same group that is already configured.'
                });
            }

            // 3) Controlla permessi: solo proprietario corrente può trasferire
            const ownerDiscordId = await permManager.getOwner(guildId);
            if (!ownerDiscordId || ownerDiscordId !== invokingUserId) {
                return interaction.editReply({
                    content: '❌ Only the current group owner can transfer the group setup.'
                });
            }

            // 4) Controlla se esiste già un pendingTransfer
            const existingPendingTransfer = await setupManager.getPendingTransfer(guildId);
            if (existingPendingTransfer) {
                if (existingPendingTransfer.newGroupId === newGroupId) {
                    return interaction.editReply({
                        content: '🚫 A transfer request for that same new group ID is already pending.'
                    });
                }
                return interaction.editReply({
                    content: '❌ There is already a pending transfer request. Please wait until it is approved or cancel it before creating a new one.'
                });
            }

            // 5) Ottieni info del nuovo gruppo da Roblox
            let newGroupInfo;
            try {
                newGroupInfo = await noblox.getGroup(parseInt(newGroupId, 10));
            } catch (err) {
                console.error('❌ Failed to fetch new group info:', err);
                return interaction.editReply({
                    content: '❌ Failed to fetch new group info. Make sure the Group ID is correct.'
                });
            }

            const newGroupOwnerId = newGroupInfo.owner?.userId;
            if (!newGroupOwnerId) {
                return interaction.editReply({
                    content: '❌ Cannot determine the owner of the new group.'
                });
            }

            // 6) Verifica account Roblox collegato
            let linkedRobloxName;
            try {
                linkedRobloxName = await xpDb.getRobloxId(invokingUserId);
            } catch (err) {
                console.error('❌ Error fetching linked Roblox username:', err);
                return interaction.editReply({
                    content:
                        '❌ Internal error when checking your linked Roblox account. Please contact an administrator.'
                });
            }

            if (!linkedRobloxName) {
                return interaction.editReply({
                    content: '❌ You must link your Roblox account first using `/link`.'
                });
            }

            // 7) Converti username Roblox in ID
            let linkedRobloxId;
            try {
                linkedRobloxId = await noblox.getIdFromUsername(linkedRobloxName);
            } catch (err) {
                console.error('❌ Error converting Roblox username to ID:', err);
                return interaction.editReply({
                    content:
                        '❌ Could not verify your Roblox username. Please unlink and re-link with `/unlink` then `/link`.'
                });
            }

            if (linkedRobloxId !== newGroupOwnerId) {
                return interaction.editReply({
                    content: '❌ You are not the owner of the new group and therefore cannot transfer the configuration to it.'
                });
            }

            // 8) Salva la richiesta di transfer in pending
            const pendingTransferData = {
                oldGroupId: currentCfg.groupId,
                newGroupId,
                ownerDiscordId: invokingUserId,
                invokingChannelId: channelId
            };

            try {
                await setupManager.setPendingTransfer(guildId, pendingTransferData);
            } catch (err) {
                console.error('❌ Error saving pending transfer setup:', err);
                return interaction.editReply({
                    content: '❌ An error occurred while saving the pending transfer request. Try again later.'
                });
            }

            // 9) Messaggio di conferma all’utente
            const pendingEmbedUser = new EmbedBuilder()
                .setTitle('⚙️ Group Transfer Pending')
                .setDescription(
                    [
                        `**Old Group ID:** ${currentCfg.groupId}`,
                        `**New Group ID:** ${newGroupId}`,
                        '',
                        'The request has been sent to the pending-requests channel. '
                        + 'Once the bot is added to the new group, an admin there can click “Confirm Bot is in Group”.'
                    ].join('\n')
                )
                .setColor(0xffa500)
                .setTimestamp();

            await interaction.editReply({
                embeds: [pendingEmbedUser]
            });

            // 10) Invia “Bot Transfer Request” in PENDING_CHANNEL_ID
            const confirmButton = new ButtonBuilder()
                .setCustomId(`confirm_join_${guildId}`)
                .setLabel('✅ Confirm Bot is in Group')
                .setStyle(ButtonStyle.Success);

            const actionRow = new ActionRowBuilder().addComponents(confirmButton);

            const pendingEmbedChannel = new EmbedBuilder()
                .setTitle('🚧 Bot Transfer Request')
                .addFields(
                    {
                        name: 'User',
                        value: `<@${invokingUserId}> (${invokingUserId})`,
                        inline: false
                    },
                    {
                        name: 'Old Group ID',
                        value: `[${currentCfg.groupId}](https://www.roblox.com/groups/${currentCfg.groupId})`,
                        inline: false
                    },
                    {
                        name: 'New Group ID',
                        value: `[${newGroupId}](https://www.roblox.com/groups/${newGroupId})`,
                        inline: false
                    }
                )
                .addFields({
                    name: '\u200B',
                    value:
                        '⚠️ The bot is not yet in the new group. Please add it, then click the button below.',
                    inline: false
                })
                .setColor(0xFFA500)
                .setTimestamp();

            const pendingChannel = await interaction.client.channels.fetch(PENDING_CHANNEL_ID);
            if (pendingChannel && pendingChannel.type === ChannelType.GuildText) {
                await pendingChannel.send({
                    embeds: [pendingEmbedChannel],
                    components: [actionRow]
                });
            } else {
                console.error(`❌ PENDING_CHANNEL_ID (${PENDING_CHANNEL_ID}) is not a text channel.`);
            }
        } catch (err) {
            console.error('❌ Unhandled error in /transfer-group:', err);
            return interaction.editReply({
                content: '❌ Internal error while processing the command. Please try again later.'
            });
        }
    }
};