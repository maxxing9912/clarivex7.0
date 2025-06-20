// commands/list-bots.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const noblox = require('noblox.js');
const { botChannelId, officialBotIds } = require('../config.json');

module.exports = {
    // 1) Nascondiamo il comando di default (defaultPermission: false)
    data: new SlashCommandBuilder()
        .setName('list-bots')
        .setDescription('Show all official Roblox bots (only usable in a specific channel).')
        .setDefaultPermission(false),

    async execute(interaction) {
        // 2) Controllo immediato del canale di esecuzione
        if (interaction.channel.id !== botChannelId) {
            return interaction.reply({
                content: `❌ You can only use this command in <#${botChannelId}>.`,
                ephemeral: true
            });
        }

        // 3) Costruisco l’embed con i bot ufficiali
        const embed = new EmbedBuilder()
            .setTitle('🤖 Official Roblox Bots')
            .setColor(0x0099ff)
            .setTimestamp()
            .setDescription('Here are the official Roblox bots in our group:')
            .setFooter({ text: 'Data fetched from Roblox API' });

        for (const userId of officialBotIds) {
            try {
                // Ottengo username dal numeric userId
                const username = await noblox.getUsernameFromId(Number(userId));

                // Ottengo avatar circolare da 150×150
                const [thumbnail] = await noblox.getPlayerThumbnail({
                    userIds: [Number(userId)],
                    size: '150x150',
                    isCircular: true
                });
                const avatarUrl = thumbnail.imageUrl;

                // Aggiungo un campo all’embed
                embed.addFields({
                    name: username,
                    value: `[View Profile](https://www.roblox.com/users/${userId}/profile)`,
                    inline: true
                });

                // Imposto come thumbnail l’ultimo avatar recuperato
                embed.setThumbnail(avatarUrl);
            } catch (err) {
                console.error(`Failed to fetch data for bot ID ${userId}:`, err);
                embed.addFields({
                    name: `Unknown (${userId})`,
                    value: '❌ Could not fetch info',
                    inline: true
                });
            }
        }

        // 4) Mando l’embed
        return interaction.reply({ embeds: [embed] });
    }
};