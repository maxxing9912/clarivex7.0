// commands/unverify.js
const { SlashCommandBuilder } = require('discord.js');
const xpDb = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unverify')
        .setDescription('Unverify your Roblox account'),
    async execute(interaction) {
        const discordId = interaction.user.id;

        // Verifica se l'utente è già verificato
        const linkedUsername = await xpDb.getLinked(discordId);
        if (!linkedUsername) {
            return interaction.reply({
                content: '❌ You are not currently verified.',
                ephemeral: true
            });
        }

        // Rimuovi l'associazione dal database
        await xpDb.removeLink(discordId);

        return interaction.reply({
            content: `✅ The verification of the account "${linkedUsername}" it was cancelled. You can repeat the process with /verify.`,
            ephemeral: true
        });
    }
};