// commands/setperms.js
const { SlashCommandBuilder } = require('discord.js');
const permManager = require('../utils/permManager');

// map label → livello numerico
const RANK_LABELS = { Member: 0, Officer: 1, HICOM: 2, Owner: 3 };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setperms')
        .setDescription('Set permission rank for a user')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('User to modify')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt
                .setName('rank')
                .setDescription('Rank to assign')
                .setRequired(true)
                .addChoices(
                    { name: 'Member', value: 'Member' },
                    { name: 'Officer', value: 'Officer' },
                    { name: 'HICOM', value: 'HICOM' },
                    { name: 'Owner', value: 'Owner' }
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const authorId = interaction.user.id;
        const trueOwnerId = interaction.guild.ownerId;

        // solo l’owner custom (o, al primo uso, il vero Discord owner)
        const ownerId = await permManager.getOwner(guildId, trueOwnerId);
        if (authorId !== ownerId) {
            return interaction.reply({
                content: '❌ Only the server owner can set permissions.',
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user');
        const rankLabel = interaction.options.getString('rank');
        const level = RANK_LABELS[rankLabel];

        await permManager.setRank(guildId, targetUser.id, level);
        return interaction.reply({
            content: `✅ **${targetUser.tag}** now has the rank **${rankLabel}**.`,
            ephemeral: true
        });
    }
};