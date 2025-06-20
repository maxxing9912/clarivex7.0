// commands/delrank.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../configManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delrank')
        .setDescription('Remove an XP→rank mapping')
        .addIntegerOption(o =>
            o.setName('rankid')
                .setDescription('Roblox rank ID')
                .setRequired(true)
        ),

    async execute(interaction) {
        const gid = interaction.guild.id;
        const uid = interaction.user.id;

        // ✅ Only Owner+ can use this
        if (!permManager.has(uid, gid, 'Owner+')) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const rankId = interaction.options.getInteger('rankid');
        const ranks = await config.get(gid, 'ranks') || {};

        if (!ranks[rankId]) {
            return interaction.reply({
                content: `⚠️ Rank \`${rankId}\` not found.`,
                flags: MessageFlags.Ephemeral
            });
        }

        delete ranks[rankId];
        await config.set(gid, 'ranks', ranks);

        await interaction.reply({
            content: `✅ Rank \`${rankId}\` removed.`,
            flags: MessageFlags.Ephemeral
        });
    }
};