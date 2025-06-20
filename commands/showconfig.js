// commands/showconfig.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../configManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showconfig')
        .setDescription('Show current server configuration'),
    async execute(interaction) {
        const gid = interaction.guild.id;
        const cfg = await config.getAll(gid);
        const embed = new EmbedBuilder().setTitle('Server Config').setColor(0x0099FF);
        for (const [k, v] of Object.entries(cfg)) {
            const val = typeof v === 'object' ? JSON.stringify(v) : v;
            embed.addFields({ name: k, value: `${val}`, inline: true });
        }
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};