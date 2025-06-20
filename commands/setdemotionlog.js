// commands/setdemotionlog.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../configManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setdemotionlog')
        .setDescription('Set the channel for demotion logs')
        .addChannelOption(o =>
            o
                .setName('channel')
                .setDescription('Select the #channel')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const authorId = interaction.user.id;
        const trueOwnerId = interaction.guild.ownerId;

        // Recupera (e, se prima esecuzione, salva) l'ownerId da QuickDB
        const ownerId = await permManager.getOwner(guildId, trueOwnerId);

        if (authorId !== ownerId) {
            return interaction.reply({
                content: '❌ Only the server Owner can set the demotion log channel.',
                ephemeral: true
            });
        }

        const chanId = interaction.options.getChannel('channel').id;
        await config.set(guildId, 'demotionLogChannelId', chanId);

        const embed = new EmbedBuilder()
            .setTitle('✅ Demotion Log Channel Set')
            .setDescription(`Now logging demotions in <#${chanId}>`)
            .setColor(0x00FF00)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};