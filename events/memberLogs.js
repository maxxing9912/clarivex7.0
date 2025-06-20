// events/memberLogs.js
const { EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: './data.sqlite' });

module.exports = {
    // This module registers both guildMemberAdd and guildMemberRemove events
    name: 'memberLogs',
    once: false,
    async execute(client) {
        // ─── GUILD MEMBER JOIN ─────────────────────────────────────────────
        client.on('guildMemberAdd', async (member) => {
            const logChannelId = await db.get(`memberLogChannel_${member.guild.id}`);
            if (!logChannelId) return;

            const channel = member.guild.channels.cache.get(logChannelId);
            if (!channel || !channel.isTextBased()) return;

            const joinEmbed = new EmbedBuilder()
                .setTitle('🔔 Member Joined')
                .addFields(
                    { name: 'User', value: `${member.user.tag} (<@${member.id}>)` },
                    { name: 'ID', value: member.id },
                    { name: 'Joined At', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
                )
                .setColor('#43b581') // green for join
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            channel.send({ embeds: [joinEmbed] });
        });

        // ─── GUILD MEMBER LEAVE ────────────────────────────────────────────
        client.on('guildMemberRemove', async (member) => {
            const logChannelId = await db.get(`memberLogChannel_${member.guild.id}`);
            if (!logChannelId) return;

            const channel = member.guild.channels.cache.get(logChannelId);
            if (!channel || !channel.isTextBased()) return;

            const leaveEmbed = new EmbedBuilder()
                .setTitle('🔴 Member Left')
                .addFields(
                    { name: 'User', value: `${member.user.tag} (ID: ${member.id})` },
                    { name: 'Left At', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
                )
                .setColor('#f04747') // red for leave
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            channel.send({ embeds: [leaveEmbed] });
        });
    }
};