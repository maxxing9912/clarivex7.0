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
            opt.setName('groupid')
               .setDescription('Your Roblox Group ID (you must be the group owner)')
               .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('premiumkey')
               .setDescription('(Optional) Premium serial key')
               .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guildId;
        console.log(`[setup] invoked for guild ${guildId}`);

        // 1) Blocca se già configurato
        const existing = await setupManager.getConfig(guildId);
        console.log('[setup] existing config:', existing);
        if (existing.groupId) {
            return interaction.editReply(`✅ Server already configured with Group ID \`${existing.groupId}\`. Use /update.`);
        }

        // 2) Blocca se pending esistente
        const pend = await setupManager.getPendingSetup(guildId);
        if (pend) {
            return interaction.editReply(`🚧 Pending already exists for Group ID \`${pend.groupId}\`.`);
        }

        // 3) Verifica ownership su Roblox
        const groupId = interaction.options.getString('groupid');
        let groupInfo;
        try {
            groupInfo = await noblox.getGroup(Number(groupId));
        } catch {
            return interaction.editReply('❌ Invalid Roblox Group ID.');
        }
        const ownerId = groupInfo.owner?.userId;
        const linked = await xpDb.getLinked(interaction.user.id);
        if (!linked || String(await noblox.getIdFromUsername(linked)) !== String(ownerId)) {
            return interaction.editReply('❌ You are not the owner of this Roblox group.');
        }

        // 4) Salva pending
        await setupManager.setPendingSetup(guildId, {
            groupId,
            premiumKey: interaction.options.getString('premiumkey') || null,
            invokingChannelId: interaction.channelId,
            ownerDiscordId: interaction.user.id
        });
        console.log('[setup] pending saved');

        await interaction.editReply('⚙️ Setup pending created.');

        // 5) Invia bottone di conferma
        const button = new ButtonBuilder()
            .setCustomId(`confirm_join_${guildId}`)
            .setLabel('✅ Confirm Bot in Group')
            .setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder().addComponents(button);

        const pendingCh = await interaction.client.channels.fetch(process.env.PENDING_CHANNEL_ID);
        if (pendingCh?.isTextBased()) {
            await pendingCh.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚧 Bot Join Request')
                        .addFields(
                            { name: 'Server', value: `<#${interaction.channelId}>`, inline: true },
                            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Group', value: `[${groupId}](https://www.roblox.com/groups/${groupId})` }
                        )
                        .setDescription('Add the bot to the group, then click the button below.')
                        .setColor(0xFFA500)
                ],
                components: [row]
            });
            console.log('[setup] sent pending message');
        } else {
            console.error('[setup] PENDING_CHANNEL_ID is invalid');
        }
    }
};
