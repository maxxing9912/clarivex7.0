// commands/warns.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const xpDb = require('../xpManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warns')
        .setDescription('Manage user warnings')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a warning to a user')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('reason')
                        .setDescription('Reason for warning')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a warning by index')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('index')
                        .setDescription('Warning index (starting from 1)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all warnings for a user')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const authorId = interaction.user.id;

        // Only Officer (rank 1) or higher can use this command
        const rank = permManager.getRank(authorId);
        if (rank < permManager.RANKS.OFFICER) {
            return interaction.reply({
                content: '❌ You need Officer or higher to use this command.',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser('user');
        const discordId = target.id;

        if (sub === 'add') {
            const reason = interaction.options.getString('reason');
            const warns = await xpDb.addWarning(discordId, reason);

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Warning Added`)
                .setDescription(`${target} has been warned.`)
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: 'Total Warnings', value: `${warns.length}` }
                )
                .setColor(0xFF4500)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (sub === 'remove') {
            const idx = interaction.options.getInteger('index') - 1;
            try {
                const removed = await xpDb.removeWarning(discordId, idx);
                const embed = new EmbedBuilder()
                    .setTitle(`✅ Warning Removed`)
                    .setDescription(`${target} warning #${idx + 1} removed.`)
                    .addFields(
                        { name: 'Removed Reason', value: removed }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (err) {
                return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
            }
        } else if (sub === 'list') {
            const warns = await xpDb.getWarnings(discordId);
            const description = warns.length
                ? warns.map((w, i) => `\`${i + 1}.\` ${w}`).join('\n')
                : 'No warnings.';

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Warnings for ${target.username}`)
                .setDescription(description)
                .setColor(0xFFD700)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
};