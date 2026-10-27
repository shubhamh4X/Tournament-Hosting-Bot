<div align="center">
  <img src="./public/assets/glacier-cup-logo.png" alt="FFA | Glacier Cup Manager™ Logo" width="140" />
  <h1>FFA | Glacier Cup Manager™</h1>
  <p><strong>Automated Esports Tournament Tagcheck, Slot Allocation, Group Partitioning & Private Room Credentials Discord Bot (`FFA-Manager`)</strong></p>
</div>

---

## Overview

**FFA | Glacier Cup Manager™** (`FFA-Manager`) is a full-stack Discord tournament management system and real-time administration console built for competitive Battlegrounds and Free-For-All esports events. It automates channel provisioning, squad tagcheck verification, region & WhatsApp registration collection, multi-group slot allocation, private team voice channel creation, waitlist promotion, and private lobby ID/Password distribution.

---

## Key Features

- **Automated Server Provisioning (`/setup` & `/create tournament`)**: Creates the tournament category, `#📋┃rules-format`, `#📝┃registration`, `#📊┃slot-list`, `#🔑┃id-pass`, `#🔒┃registration-details` (restricted to `@FFA Bot Manager`), and the `@Verified Team` + `@Confirmed Slot` + `@FFA Bot Manager` roles in one command.
- **Interactive Registration Modal**: Publishes an interactive registration embed in `#📝┃registration` with a **Register Your Team** button opening a modal for Team Name, Region (`India`, `Pakistan`, `Bangladesh` with automatic country code), WhatsApp Number, and exact-count Player Tag selection.
- **High-Concurrency Tagcheck Engine**: Serialized atomic slot allocation queue and cache-first user resolution prevent duplicate slots or rate-limit bottlenecks even when dozens of teams register simultaneously.
- **Waitlist Auto-Promotion**: Deleting a confirmed slot (`/delete slot`) automatically promotes the #1 waitlisted squad and updates `#📊┃slot-list` (grouped by Group A, Group B, etc.) in real time.
- **Private Room ID & Password Dispatch (`/idpass`)**: Broadcasts lobby credentials exclusively to `#🔑┃id-pass` (restricted to `@Verified Team`).

---

## Discord Commands Reference

Supports both **Discord Slash Commands (`/`)** and **Prefix Commands (`!`)**:

| Command | Parameters | Description |
| :--- | :--- | :--- |
| `/setup` | `[slots] [tags] [groups] [title] [rules]` | Provision tournament category, channels, roles, and custom rules prompt |
| `/create tournament` | `[slots] [tags] [groups] [title] [rules]` | Create a new tournament and configure group partitions |
| `/rules` | `[rules]` | Open interactive modal or publish custom tournament rules to `#📋┃rules-format` |
| `/idpass` | `<room_id> <password> [map] [match_time]` | Dispatch custom match Room ID & Password to `#🔑┃id-pass` |
| `/lock` | `[reason]` | Close registrations in `#📝┃registration` |
| `/unlock` | — | Re-open registrations in `#📝┃registration` |
| `/delete slot` | `<slot>` | Remove a team from a slot and auto-promote the next waitlisted team |
| `/delete tournament` | `[delete_channels]` | Delete active tournament channels and reset all rosters |
| `/swap-slots` | `<slot1> <slot2>` | Swap two registered teams' slot numbers and refresh `#📊┃slot-list` |
| `/tagcheck` | `<@user>` | Check if a player is eligible, already registered on a squad, or blacklisted |
| `/team-info` | `<query>` | View full roster dossier, captain, slot, and group by slot number or team name |
| `/blacklist add` | `<@user> [reason]` | Ban a player from registering or being tagged in any squad |
| `/blacklist remove` | `<@user>` | Remove a player from the tournament blacklist |
| `/blacklist list` | — | List all currently blacklisted players |
| `/standings` | `[group]` | Display tournament standings and scoring matrix |
| `/announce` | `<message> [ping_everyone]` | Publish an official tournament announcement embed |
| `/export` | `[format]` | Export confirmed roster in clean Markdown or CSV format |
| `/slots` | — | View live confirmed slots and waitlist status |
| `/help` | — | Display the full command suite |

---

## Required Environment Variables

Create a `.env` file in the root directory (copied from `.env.example`) or configure these variables in your hosting platform's Environment / Secrets settings:

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `DISCORD_TOKEN` | **Yes** (or `BOT_TOKEN`) | — | Your Discord Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `TWILIO_ACCOUNT_SID` | **Yes** (for WhatsApp OTP) | — | Twilio Account SID (`AC...`) from [Twilio Console](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | **Yes** (for WhatsApp OTP) | — | Twilio Auth Token from Twilio Console |
| `TWILIO_VERIFY_SERVICE_SID` | **Yes** (for WhatsApp OTP) | — | Twilio Verify Service SID (`VA...`) with WhatsApp delivery channel enabled |
| `PORT` | No | `3000` | HTTP server port for the web dashboard and health checks |
| `HOST` | No | `0.0.0.0` | Network interface to bind the HTTP server |
| `NODE_ENV` | No | `production` | Set to `production` in deployed environments to serve compiled static assets |
| `STATE_FILE_PATH` | No | `./.tournament-state.json` | Custom file path for persistent tournament state (e.g., `/data/.tournament-state.json` on mounted volumes) |

> **Important Discord Bot Portal Settings:**
> Under **Discord Developer Portal → Your Application → Bot → Privileged Gateway Intents**, enable:
> 1. **Server Members Intent**
> 2. **Message Content Intent**

---

## Real WhatsApp OTP Verification Setup (Twilio Verify)

To verify tournament captains before allocating a slot, FFA | Glacier Cup Manager™ integrates directly with the **official WhatsApp Business Platform via Twilio Verify v2**.

### 1. Twilio Console Configuration
1. Sign up or log into [Twilio Console](https://console.twilio.com).
2. Copy your **Account SID** and **Auth Token** into your `.env` file:
   ```env
   TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   TWILIO_AUTH_TOKEN="your_auth_token_here"
   ```
3. Navigate to **Explore Products → Verify → Services**.
4. Click **Create Service** and give it a name (e.g. `Glacier-Cup-Verify`).
5. Open the created service settings, go to **Channels**, and ensure the **WhatsApp** channel is toggled **ON**.
6. Copy your **Verify Service SID** (`VA...`) into your `.env` file:
   ```env
   TWILIO_VERIFY_SERVICE_SID="VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```

### 2. WhatsApp Sender / Testing
- **Development / Sandbox Testing:** In Twilio Console under **Messaging → Try it out → Send a WhatsApp message**, activate the Twilio WhatsApp Sandbox by sending the sandbox keyword (e.g., `join <keyword>`) from the test phone to Twilio's WhatsApp number.
- **Production Deployment:** For high-volume production events, connect an approved **WhatsApp Business Profile (WABA)** or a Twilio-hosted WhatsApp sender number. Twilio Verify automatically dispatches localized authentication templates compliant with WhatsApp Business policies.

### 3. Verification Workflow & Security Safeguards
- **E.164 Number Normalization:** Client and server normalize numbers for India (`+91`), Bangladesh (`+880`), and Pakistan (`+92`).
- **Throttling & Abuse Prevention:**
  - 60-second cooldown between consecutive OTP requests for the same phone number.
  - Maximum 5 OTP requests per phone number / hour.
  - Maximum 5 code verification attempts before invalidating the session.
- **Atomic Session Token Binding:**
  - When Twilio Verify confirms the OTP (`status: 'approved'`), the server generates a cryptographically random, short-lived (15 min) verification token bound strictly to that phone number.
  - During final team registration (`POST /api/register`), the server validates and atomically consumes the token.
  - If the user edits the phone number or region, previous verification is invalidated immediately.
- **API Endpoints:**
  - `GET /api/whatsapp-otp/status`: Health check for Twilio Verify credentials.
  - `POST /api/whatsapp-otp/send`: Initiates WhatsApp OTP delivery via Twilio Verify API.
  - `POST /api/whatsapp-otp/verify`: Validates OTP code and issues a secure registration verification token.


---

## Deployment Guide

### 1. Deploy from GitHub or Extracted ZIP (VPS / Linux / Windows / macOS)

**Prerequisites:** Node.js **22.6+** (for native `npm start` / `node server.ts`) or Node.js **20+** (using `npm run start:compiled` or `npm run start:tsx`).

```bash
# 1. Clone the repository or extract the ZIP archive and enter the folder
git clone <your-repo-url>
cd ffa-glacier-cup-manager

# 2. Configure environment variables
cp .env.example .env
# Edit .env and set DISCORD_TOKEN="your_bot_token_here"

# 3. Install dependencies
npm install

# 4. Build the frontend (dist/) and compiled server bundle (server.js)
npm run build

# 5. Start in production mode
# Option A (Node.js 22.6+):
NODE_ENV=production npm start

# Option B (Node.js 18/20/22+ using compiled bundle):
npm run start:compiled
```

### 2. Deploy on EnderCloud (Node.js / Discord Bot Hosting)

1. On your **EnderCloud Dashboard**, create or select your Node.js or Discord Bot server.
2. In the **Startup** tab:
   - Ensure the Node.js version is set to **Node.js 20 or Node.js 22**.
   - Set the startup command to: `npm run start:compiled` (or `npm start` if running Node 22+).
3. In the **Files** manager or Git integration:
   - Push this repo to GitHub and connect it to EnderCloud, or upload the project files.
   - Run in the EnderCloud console (or during build):
     ```bash
     npm install
     npm run build
     ```
4. In the **Environment Variables / .env** tab:
   - Add `DISCORD_TOKEN` = `<your_bot_token>`
   - Add `PORT` = `<allocated_endercloud_port>` (or leave default if accessing port allocation)
5. Start your server. The bot will automatically log into Discord and the web dashboard will be live at `http://<your-endercloud-ip>:<port>`.

### 3. Deploy on Railway or Render

1. Connect your GitHub repository to **Railway** or **Render** (Web Service).
2. Configure the service settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `NODE_ENV=production npm start` (or `npm run start:compiled`)
   - **Health Check Path:** `/api/health`
3. Add Environment Variables in the platform dashboard:
   - `DISCORD_TOKEN` = `<your_discord_bot_token>`
   - `NODE_ENV` = `production`
4. **Persistent State (Recommended):** Attach a persistent volume/disk (e.g., mounted at `/data`) and set `STATE_FILE_PATH=/data/.tournament-state.json` so tournament rosters survive container redeployments.

### 3. Deploy on Pterodactyl Panel (Discord Bot Egg)

1. Upload the extracted ZIP files (excluding `node_modules`) or configure the Git repository in your Pterodactyl server.
2. Set the `.env` file or Startup Variables:
   - `DISCORD_TOKEN` (or `BOT_TOKEN`) = `<your_discord_bot_token>`
   - `NODE_ENV` = `production`
3. Run `npm install && npm run build`, and set the startup command to:
   - `node server.js` (after running `npm run build`) or `node server.ts` (on Node 22+ image) or `npx tsx server.ts`.

### 4. Deploy with Docker

```bash
# Build the image
docker build -t ffa-glacier-cup-manager .

# Run the container with persistent state mounted
docker run -d \
  --name ffa-glacier-bot \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DISCORD_TOKEN="your_discord_bot_token" \
  -e STATE_FILE_PATH="/data/.tournament-state.json" \
  -v $(pwd)/data:/data \
  ffa-glacier-cup-manager
```
