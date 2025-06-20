// events/guildMemberAdd.js
const { EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: './data.sqlite' });

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        // Read the same key saved by /setwelcome: "welcome_<guildId>"
        const config = await db.get(`welcome_${member.guild.id}`);
        if (!config?.enabled || !config.channelId || !config.message) return;

        const channel = member.guild.channels.cache.get(config.channelId);
        if (!channel || !channel.isTextBased()) return;

        const welcomeEmbed = new EmbedBuilder()
            // Author shows “Welcome to <ServerName>!” with the guild’s icon
            .setAuthor({
                name: `👥 Welcome to ${member.guild.name}!`,
                iconURL: member.guild.iconURL({ dynamic: true })
            })
            // Main title
            .setTitle('🌟 New Member Joined!')
            // Two fields: one for the actual message, one for “How to use {user}”
            .addFields(
                {
                    name: 'Message Preview',
                    value: config.message.replace('{user}', `<@${member.id}>`)
                },
                {
                    name: 'How to Use `{user}`',
                    value:
                        '🔹 To mention the new member, include `{user}` anywhere in your message.\n' +
                        '🔹 Example: `Hello {user}, welcome to our server!`'
                }
            )
            .setColor('#9B59B6') // purple
            // Thumbnail is the new member’s avatar
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            // Footer shows who triggered (in this case, the new member’s tag)
            .setFooter({
                text: `Requested by ${member.user.tag}`,
                iconURL: member.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        channel.send({ embeds: [welcomeEmbed] });
    }
};