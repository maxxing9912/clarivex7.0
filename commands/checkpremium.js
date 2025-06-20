const { SlashCommandBuilder } = require('discord.js');
const xpManager = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('checkpremium')
        .setDescription('Controlla se un utente è Premium')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Utente da controllare').setRequired(true)
        ),

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const dbPremium = await xpManager.isPremiumUser(user.id);
        await interaction.reply(
            `🔍 ${user.username} è ${dbPremium ? '**Premium** 🌟' : '**Free** ❌'}`
        );
    },
};