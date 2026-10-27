<div align="center">
  <img src="./public/assets/glacier-cup-logo.png" alt="FFA | Glacier Cup Manager™ Logo" width="140" />
  <h1>FFA | Glacier Cup Manager™</h1>
  <p><strong>Automated Esports Tournament Tagcheck, Slot Allocation, Group Partitioning & Private Room Credentials Discord Bot (`FFA-Manager`)</strong></p>
</div>

---

## Overview

**FFA | Glacier Cup Manager™** (`FFA-Manager`) is a full-stack Discord tournament management system and real-time administration console built for competitive Battlegrounds and Free-For-All esports events. It automates channel provisioning, squad tagcheck verification, multi-group slot allocation, waitlist promotion, and private lobby ID/Password distribution.

---

## Key Features

- **Automated Server Provisioning (`/setup` & `/create tournament`)**: Creates the tournament category, `#📋┃rules-format`, `#📝┃registration`, `#📊┃slot-list`, `#🔑┃id-pass`, and the `@Verified Team` + `@Confirmed Slot` roles in one command.
- **Custom Rules Prompt & Modal**: Prompts tournament administrators to input or paste custom tournament rules upon setup and publishes them directly to `#📋┃rules-format`.
- **High-Concurrency Tagcheck Engine**: Serialized atomic slot allocation queue and cache-first user resolution prevent duplicate slots or rate-limit bottlenecks even when dozens of teams register simultaneously.
- **EasyTag & Multi-Team Protection**: Converts raw numeric Discord User IDs into mentions automatically, blocks cross-team duplicate player registrations, and rejects blacklisted players.
- **Waitlist Auto-Promotion**: Deleting a confirmed slot (`/delete slot`) automatically promotes the #1 waitlisted squad and updates `#📊┃slot-list` in real time.
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

## Registration Format

Players register in `#📝┃registration` using the following format:

```text
Team Name: Team Glacier
Player 1: @Player1
Player 2: @Player2
Player 3: @Player3
Player 4: @Player4
```

---

## Setup & Installation

### 1. Prerequisites
- **Node.js** 18+
- A Discord Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications) with **Server Members Intent** and **Message Content Intent** enabled under the **Bot** tab.

### 2. Environment Configuration
Copy `.env.example` to `.env` and configure your token:

```env
PORT=3000
DISCORD_TOKEN="YOUR_DISCORD_BOT_TOKEN"
```

### 3. Install & Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to access the **FFA | Glacier Cup Manager™** web dashboard, connect or monitor your live Discord bot, manage slots, and dispatch room credentials.
