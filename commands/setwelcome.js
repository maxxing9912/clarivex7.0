// commands/setwelcome.js
const {
    SlashCommandBuilder,
    ChannelType,
    EmbedBuilder
} = require('discord.js');
const { QuickDB } = require('quick.db');
const permManager = require('../utils/permManager');

const db = new QuickDB({ filePath: './data.sqlite' });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setwelcome')
        .setDescription('Configure your server’s welcome messages')
        .addSubcommand(sub =>
            sub
                .setName('enable')
                .setDescription('Enable welcome messages')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Text channel')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)
                )
                .addStringOption(opt =>
                    opt
                        .setName('message')
                        .setDescription('Use `{user}` placeholder')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('disable').setDescription('Disable welcome messages')
        )
        .addSubcommand(sub =>
            sub.setName('preview').setDescription('Show preview')
        ),

    async execute(interaction) {
        console.log('[setwelcome] execute called');

        const guildId = interaction.guildId;
        const authorId = interaction.user.id;
        const realOwnerId = interaction.guild.ownerId;
        const ownerId = await permManager.getOwner(guildId, realOwnerId);

        if (authorId !== ownerId) {
            console.log('[setwelcome] permission denied');
            return interaction.reply({
                content: '❌ Only the server owner can use this command.',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();
        console.log(`[setwelcome] subcommand = ${sub}`);

        if (sub === 'enable') {
            const channel = interaction.options.getChannel('channel');
            const msg = interaction.options.getString('message');

            await db.set(`welcome_${guildId}`, { enabled: true, channelId: channel.id, message: msg });

            const embed = new EmbedBuilder()
                .setTitle('✅ Welcome Enabled')
                .setDescription(`Posting in <#${channel.id}>:\n> ${msg}`)
                .setColor('#57F287')
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'disable') {
            await db.delete(`welcome_${guildId}`);
            const embed = new EmbedBuilder()
                .setTitle('❌ Welcome Disabled')
                .setColor('#ED4245')
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'preview') {
            const cfg = await db.get(`welcome_${guildId}`);
            if (!cfg?.enabled) {
                return interaction.reply({ content: '⚠️ Not enabled yet.', ephemeral: true });
            }
            const preview = cfg.message.replace('{user}', interaction.user.toString());
            const embed = new EmbedBuilder()
                .setTitle('🌟 Preview')
                .setDescription(preview)
                .setColor('#9B59B6')
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
};