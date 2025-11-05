const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config.json");

// Twitch API setup
require("dotenv").config();
const { ApiClient } = require("@twurple/api");
const { AppTokenAuthProvider } = require("@twurple/auth");

// Debug Twitch credentials
console.log("🔑 Checking Twitch credentials...");
console.log("✓ Client ID exists:", !!process.env.TWITCH_CLIENT_ID);
console.log("✓ Client Secret exists:", !!process.env.TWITCH_CLIENT_SECRET);

const authProvider = new AppTokenAuthProvider(
  process.env.TWITCH_CLIENT_ID,
  process.env.TWITCH_CLIENT_SECRET
);

const twitchClient = new ApiClient({ authProvider });

let isLive = false;

// Main Discord bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Checks if a stream is live every minute
client.once("clientReady", () => {
  console.log("✅ Logged in as " + client.user.tag);
  console.log("----------------------------------------");
  // Start Twitch stream checker
  setInterval(checkStream, 60 * 1000); // check every 60 seconds
  console.log("🔎 Twitch monitor started");
  console.log("----------------------------------------");
});

// Prints what commands are available using the !help command
client.on("messageCreate", async (message) => {
  const helpTrigger = "!help";
  if (message.content.startsWith(helpTrigger)) {
    console.log("📖 !help command detected.");
    await message.reply("I can help make announcements!: Use '!announce [message]'");
  }
});

// Creates an announcement using the !announce command
client.on("messageCreate", async (message) => {
  console.log(`📩 Message received: "${message.content}"`);

  if (message.author.bot) {
    console.log("⛔ Bot message — ignoring.");
    return;
  }

  if (!message.guild) {
    console.log("⛔ DM — ignoring.");
    return;
  }
  console.log("👥 Message is in a guild.");

  // Role check
  const roleId = config["announcer-role"];
  if (!roleId) {
    console.log("❗ Announcer role ID not set in config.json");
    return;
  }

  const member = message.member;
  if (!member) {
    console.log("❓ member object missing");
    return;
  }

  console.log(`👤 User roles: ${member.roles.cache.map(r => r.name).join(", ")}`);

  // Check if user has the announcer role
  if (!member.roles.cache.has(roleId)) {
    console.log("🚫 User does NOT have announcer role.");
    return;
  }
  console.log("✅ User HAS the announcer role.");

  const announceTrigger = "!announce";
  if (message.content.startsWith(announceTrigger)) {
    console.log("📢 !announce command detected.");

    const announcement = message.content.slice(announceTrigger.length).trim();
    if (!announcement.length) {
      await message.reply("Please include a message to announce.");
      console.log("⚠️ No announcement text provided.");
      return;
    }

    try {
      const announceChannel = message.guild.channels.cache.get(config.announcementChannel);

      if (!announceChannel) {
        console.log("❌ Announcement channel not found!");
        await message.reply("❌ I can't find the announcements channel. Check config.json.");
        return;
      }

      console.log("🗣️ Sending announcement to #announcements...");
      await announceChannel.send(announcement);

      console.log("✅ Announcement delivered.");
      await message.reply("✅ Announcement sent to #announcements.");
    } catch (err) {
      console.error("❌ Failed to send announcement:", err);
      await message.reply("❌ Failed to send announcement. Check bot logs.");
    }
  }
});

// Makes a random decision response using the !decide command
const responses = [
  "Yes! ✨",
  "No... 😔",
  "Maybe? 🤔",
  "Absolutely! 💯",
  "Not a chance! ❌",
  "Ask again later 🕐",
  "Definitely! 🌟",
  "I don't think so 🤷",
  "Without a doubt! ✅",
  "Ummmm 🤫"
];

client.on("messageCreate", async (message) => {
  if (message.author.bot) return; // Ignore bot messages
  
  const trigger = "!decide";
  if (message.content.startsWith(trigger)) {
    const question = message.content.slice(trigger.length).trim();
    
    // Get random response
    const randomIndex = Math.floor(Math.random() * responses.length);
    const response = responses[randomIndex];
    
    // If there was a question, include it in the response
    const reply = question 
      ? `> ${question}\n${response}`
      : response;
    
    await message.reply(reply);
  }
});


console.log("🚀 Starting bot...");

// Keeps tracks of the live status of streamers
const streamers = process.env.TWITCH_STREAMERS.split(",");
let liveStatus = {}; // keep track of who is live

// Checks if a streamer went live or offline
async function checkStream() {
  try {
    console.log("----------------------------------------");
    console.log("🔍 Checking streams...");
    console.log("📋 Streamers to check:", streamers.map(s => s.trim()));

    const announceChannelId = process.env.TWITCH_ANNOUNCE_CHANNEL_ID || config.announcementChannel;
    if (!announceChannelId) {
      console.error("No announce channel configured (TWITCH_ANNOUNCE_CHANNEL_ID or config.announcementChannel). Skipping.");
      return;
    }

    for (const raw of streamers) {
      const trimmedName = raw.trim();
      if (!trimmedName) continue;

      let user;
      try {
        user = await twitchClient.users.getUserByName(trimmedName);
      } catch (err) {
        console.error(`Twitch API error while fetching user ${trimmedName}:`, err);
        continue;
      }

      if (!user) {
        console.log(`❌ Twitch user not found: ${trimmedName}`);
        continue;
      }

      let stream;
      try {
        stream = await user.getStream();
      } catch (err) {
        console.error(`Error fetching stream for ${trimmedName}:`, err);
        continue;
      }

      if (stream && !liveStatus[trimmedName]) {
        // newly live
        liveStatus[trimmedName] = true;

        const content = `📢 **${user.displayName} is LIVE on Twitch!** \n🔗 https://twitch.tv/${trimmedName}\n**Title:** ${stream.title || "(no title)"}`;

        try {
          const channel = await client.channels.fetch(announceChannelId).catch(() => null);
          if (channel && typeof channel.send === "function") {
            await channel.send({ content });
            console.log(`✅ Announced ${user.displayName} is live`);
          } else {
            console.error("Announce channel not found or bot lacks send permission");
          }
        } catch (err) {
          console.error("Failed to send announcement:", err);
        }

      } else if (!stream && liveStatus[trimmedName]) {
        // went offline
        liveStatus[trimmedName] = false;
        console.log(`🟥 ${user.displayName} is now offline`);
      }
    }
  } catch (e) {
    console.error("Twitch check failed:", e);
  }
}

client.login(config.token)
  .then(() => console.log("🔐 Login request sent..."))
  .catch(err => console.error("❌ Login failed:", err));
