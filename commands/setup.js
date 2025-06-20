// commands/setup.js

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');
const setupManager = require('../utils/setupManager');
const xpDb = require('../xpManager');
const noblox = require('noblox.js');

const PENDING_CHANNEL_ID = '1382426084028584047';

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
        // 1) Defer the reply (only visible all’utente che lo invoca)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const channelId = interaction.channel.id;
        const groupId = interaction.options.getString('groupid');
        const premiumKey = interaction.options.getString('premiumkey') || null;

        // 2) Verifica che il gruppo non sia già configurato altrove
        const otherGuild = await setupManager.findGuildByGroupId(groupId);
        if (otherGuild && otherGuild !== guildId) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 Group Already Configured')
                        .setDescription('Questo gruppo Roblox è già configurato in un altro server.')
                        .setColor(0xED4245)
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 3) Verifica se esiste un pending setup in un altro server
        const pendingElsewhere = await setupManager.findPendingGuildByGroupId(groupId);
        if (pendingElsewhere && pendingElsewhere !== guildId) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 Pending Setup Elsewhere')
                        .setDescription('Esiste già una richiesta in attesa per questo gruppo in un altro server.')
                        .setColor(0xED4245)
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 4) Verifica se questo server è già configurato
        const existingCfg = await setupManager.getConfig(guildId);
        if (existingCfg?.groupId) {
            if (existingCfg.groupId === groupId) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Already Configured')
                            .setDescription('Questo server è già configurato con lo stesso gruppo Roblox.')
                            .setColor(0xED4245)
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.editReply({
                    content: '❌ Hai già un gruppo configurato. Usa `/transfer-group` per cambiare gruppo.',
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        // 5) Verifica se esiste già un pending setup in questo server
        const existingPending = await setupManager.getPendingSetup(guildId);
        if (existingPending) {
            if (existingPending.groupId === groupId) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚫 Pending Setup Exists')
                            .setDescription('Hai già una richiesta in attesa per questo gruppo.')
                            .setColor(0xED4245)
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.editReply({
                    content: '❌ Hai già una richiesta in attesa. Usa `/transfer-group` o attendi la conferma.',
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        // 6) Ottieni info sul gruppo da Roblox e verifica ownership
        let groupInfo;
        try {
            groupInfo = await noblox.getGroup(parseInt(groupId, 10));
        } catch {
            await interaction.editReply({
                content: '❌ Impossibile recuperare info sul gruppo. Controlla l’ID.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        const ownerId = groupInfo.owner?.userId;
        if (!ownerId) {
            await interaction.editReply({
                content: '❌ Impossibile determinare il proprietario del gruppo.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 7) Verifica che l’utente abbia collegato il proprio account Roblox
        const linked = await xpDb.getRobloxId(userId);
        if (!linked) {
            await interaction.editReply({
                content: '❌ Devi prima collegare il tuo account Roblox con `/verify`.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        let linkedId;
        try {
            linkedId = await noblox.getIdFromUsername(linked);
        } catch {
            await interaction.editReply({
                content: '❌ Impossibile verificare il tuo username Roblox. Riprova il link.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (linkedId !== ownerId) {
            await interaction.editReply({
                content: '❌ Non sei il proprietario di questo gruppo Roblox.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 8) Salva il pending setup
        await setupManager.setPendingSetup(guildId, {
            groupId,
            premiumKey,
            ownerDiscordId: userId,
            invokingChannelId: channelId
        });

        // 9) Salva IMMEDIATAMENTE anche la config finale, in modo persistente
        await setupManager.setConfig(guildId, {
            groupId,
            roleBindings: [],        // personalizzabili a piacere
            verificationRoleId: null,
            unverifiedRoleId: null,
            bypassRoleId: null
        });

        // 10) Notifica l’utente che la richiesta è in pending (solo a lui)
        const embedUser = new EmbedBuilder()
            .setTitle('⚙️ Setup Pending')
            .setDescription([
                `**Group ID:** ${groupId}`,
                premiumKey ? `**Premium Key:** \`${premiumKey}\`` : '_No premium key provided_',
                '',
                'La tua richiesta è stata inoltrata. Verrai avvisato quando sarà confermata.'
            ].join('\n'))
            .setColor(0xffa500)
            .setTimestamp();

        await interaction.editReply({
            embeds: [embedUser],
            flags: MessageFlags.Ephemeral
        });

        // 11) Invia il messaggio di conferma NEL CANALE PENDING
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_join_${guildId}`)
            .setLabel('✅ Conferma Bot in Gruppo')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(confirmButton);

        const embedPending = new EmbedBuilder()
            .setTitle('🚧 Bot Join Request')
            .addFields(
                { name: 'Server', value: `<#${channelId}>`, inline: true },
                { name: 'Utente', value: `<@${userId}>`, inline: true },
                { name: 'Group', value: `[${groupId}](https://www.roblox.com/groups/${groupId})`, inline: false },
                {
                    name: '\u200B',
                    value: '⚠️ Aggiungi il bot al gruppo, poi clicca “Conferma Bot in Gruppo”.',
                }
            )
            .setColor(0xFFA500)
            .setTimestamp();

        const pendingChannel = await interaction.client.channels.fetch(PENDING_CHANNEL_ID);
        if (pendingChannel?.isTextBased()) {
            await pendingChannel.send({
                embeds: [embedPending],
                components: [row]
            });
        } else {
            console.error(`❌ PENDING_CHANNEL_ID (${PENDING_CHANNEL_ID}) non è un canale di testo valido.`);
        }
    }
};