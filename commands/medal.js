// commands/medal.js
const { SlashCommandBuilder } = require('discord.js');
const xpDb = require('../xpManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('medal')
        .setDescription('Create or remove a medal for a user')
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Assign a medal to a user')
                .addUserOption(opt =>
                    opt
                        .setName('target')
                        .setDescription('User to grant the medal')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('medal')
                        .setDescription('Name of the medal to grant')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove a medal from a user')
                .addUserOption(opt =>
                    opt
                        .setName('target')
                        .setDescription('User to remove the medal from')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('medal')
                        .setDescription('Name of the medal to remove')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        // Only the internal Owner can manage medals
        const ownerId = permManager.getOwner(guildId);
        if (userId !== ownerId) {
            return interaction.reply({
                content: '❌ Only the server Owner can manage medals.',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser('target');
        const medalName = interaction.options.getString('medal');

        if (sub === 'create') {
            await xpDb.addMedal(target.id, medalName);
            return interaction.reply(`✅ Medal **${medalName}** granted to ${target}.`);
        } else if (sub === 'remove') {
            const removed = await xpDb.removeMedal(target.id, medalName);
            if (removed) {
                return interaction.reply(`✅ Medal **${medalName}** removed from ${target}.`);
            } else {
                return interaction.reply({
                    content: `⚠️ ${target} does not have the medal **${medalName}**.`,
                    ephemeral: true
                });
            }
        }
    }
};