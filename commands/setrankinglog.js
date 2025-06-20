// commands/setrankinglog.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../configManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setrankinglog')
        .setDescription('Set the channel for promotion logs')
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

        // Retrieve (and auto-save on first call) the custom owner or fall back to the Discord guild owner
        const ownerId = await permManager.getOwner(guildId, trueOwnerId);
        if (authorId !== ownerId) {
            return interaction.reply({
                content: '❌ Only the server owner can use this command.',
                ephemeral: true
            });
        }

        const chanId = interaction.options.getChannel('channel').id;
        await config.set(guildId, 'rankingLogChannelId', chanId);

        const embed = new EmbedBuilder()
            .setTitle('✅ Promotion Log Channel Set')
            .setDescription(`Now logging promotions in <#${chanId}>`)
            .setColor(0x00FF00)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};