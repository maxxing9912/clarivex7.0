// commands/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const xpManager = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the XP leaderboard'),

    async execute(interaction) {
        // Risposta pubblica
        await interaction.deferReply({ ephemeral: false });

        // Prendi tutti gli XP e tutti i link
        const allXp = await xpManager.getAllXp();      // [{ userId, xp }, ...]
        const linked = await xpManager.getAllLinked();  // [{ discordId, robloxName }, ...]

        // Unisci: prendi solo utenti linkati
        const board = linked.map(u => {
            const e = allXp.find(x => x.userId === u.discordId) || { xp: 0 };
            return { discordId: u.discordId, name: u.robloxName, xp: e.xp };
        });

        // Ordina per XP decrescente
        board.sort((a, b) => b.xp - a.xp);

        // Posizione dell’esecutore
        const meIdx = board.findIndex(u => u.discordId === interaction.user.id);
        const myPos = meIdx >= 0 ? meIdx + 1 : board.length;
        const myEntry = board[meIdx] || { name: interaction.user.username, xp: 0 };

        // Crea la lista top 10
        const top10 = board.slice(0, 10)
            .map((u, i) => `**#${i + 1}** ${u.name}: ${u.xp}`)
            .join('\n');

        // Embed di risposta
        const embed = new EmbedBuilder()
            .setTitle(`Leaderboard – Page 1 | ${board.length} Users`)
            .setDescription(
                `**Your Position**: #${myPos} ${myEntry.name}: ${myEntry.xp}\n\n` +
                top10
            )
            .setColor(0xFFD700)
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }
};