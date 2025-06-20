// commands/addrank.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../configManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addrank')
        .setDescription('Add or update an XP→rank mapping')
        .addIntegerOption(o =>
            o.setName('rankid')
                .setDescription('Roblox rank ID')
                .setRequired(true))
        .addIntegerOption(o =>
            o.setName('xp')
                .setDescription('XP needed')
                .setRequired(true)),

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
        const xpReq = interaction.options.getInteger('xp');
        const ranks = await config.get(gid, 'ranks') || {};

        ranks[rankId] = xpReq;
        await config.set(gid, 'ranks', ranks);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('✅ Rank Added')
                .setDescription(`Rank **${rankId}** now requires **${xpReq} XP**.`)
                .setColor(0x00FF00)
            ],
            flags: MessageFlags.Ephemeral
        });
    }
};