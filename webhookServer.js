// webhookServer.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const xpDb = require('../xpManager'); // ✅ Correct path to root-level xpManager
const { Client, GatewayIntentBits } = require('discord.js');

// --------------
// 1) Initialize Discord Client
// --------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

// Login the bot
client.login(process.env.DISCORD_BOT_TOKEN);

// --------------
// 2) Set up Express server
// --------------
const app = express();
app.use(bodyParser.json()); // Parse JSON request bodies

// --------------
// 3) Webhook endpoint to activate Premium
//    Your main site server should POST here after Stripe purchase
// --------------
app.post('/bot-webhook/premium', async (req, res) => {
    try {
        const { discordId, premium } = req.body;

        if (!discordId || typeof premium !== 'boolean') {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        // Update user premium status in QuickDB
        await xpDb.setPremiumUser(discordId, premium);
        console.log(`[webhook] setPremiumUser(${discordId}, ${premium})`);

        // (Optional) Send a DM to the user confirming Premium
        if (premium) {
            try {
                const user = await client.users.fetch(discordId);
                if (user) {
                    await user.send(
                        ":tada: **You have successfully activated Premium!** " +
                        "Thank you for your purchase. You can now enjoy all Premium features."
                    );
                }
            } catch (dmErr) {
                console.warn(`[webhook] Could not send DM to ${discordId}`, dmErr);
            }
        }

        return res.sendStatus(200);
    } catch (err) {
        console.error('[webhook] Error handling premium webhook:', err);
        return res.sendStatus(500);
    }
});

// --------------
// 4) Start Express server along with the bot
// --------------
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
    console.log(`🚀 Bot-webhook server listening on port ${PORT}`);
});