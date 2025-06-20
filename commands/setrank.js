// commands/setrank.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const permManager = require('../utils/permManager');
const { RANKS } = permManager;  // { MEMBER: 0, OFFICER: 1, HICOM: 2, OWNER: 3 }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setrank')
        .setDescription('Set the internal rank of a user (Member/Officer/HICOM)')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('User to assign a rank to')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('rank')
                .setDescription('Which rank to assign')
                .setRequired(true)
                .addChoices(
                    { name: 'Member', value: String(RANKS.MEMBER) },
                    { name: 'Officer', value: String(RANKS.OFFICER) },
                    { name: 'HICOM', value: String(RANKS.HICOM) }
                )
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

        const targetUser = interaction.options.getUser('user');
        const rankValue = parseInt(interaction.options.getString('rank'), 10);

        // Save the rank for this guild & user
        await permManager.setRank(guildId, targetUser.id, rankValue);

        // Find the rank name from its numeric value
        const rankName = Object.entries(RANKS)
            .find(([, v]) => v === rankValue)?.[0] ?? 'Unknown';

        const embed = new EmbedBuilder()
            .setTitle('✅ Rank Updated')
            .setDescription(`The rank of <@${targetUser.id}> has been set to **${rankName}**.`)
            .setColor('Green')
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};