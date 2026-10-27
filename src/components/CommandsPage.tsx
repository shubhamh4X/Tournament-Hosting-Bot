import React, { useState } from 'react';
import {
  Terminal,
  Sparkles,
  Copy,
  Check,
  Shield,
  Users,
  Trophy,
  KeyRound,
  Lock,
  Unlock,
  UserCheck,
  Search,
  Filter,
  Info,
  Layers,
  FileSpreadsheet
} from 'lucide-react';

interface CommandItem {
  name: string;
  syntax: string;
  prefixSyntax: string;
  category: 'setup' | 'match' | 'roster' | 'info';
  permission: 'Admin / Staff' | 'Public';
  params?: string;
  description: string;
  examples: string[];
}

const COMMANDS_DATA: CommandItem[] = [
  {
    name: 'Setup Tournament',
    syntax: '/setup',
    prefixSyntax: '!setup [slots] [tags] [groups] [title]',
    category: 'setup',
    permission: 'Admin / Staff',
    params: 'slots (int), tags (int), groups (int), title (string), rules (string)',
    description: 'Auto-creates the tournament category (🏆 ┃ GLACIER CUP), #rules-format, #registration, #slot-list, #id-pass, #registration-details, and @Verified Team + @Confirmed Slot + @FFA Bot Manager roles in one step.',
    examples: ['/setup slots:20 tags:4 groups:20 title:Glacier Cup', '!setup 20 4 20 Glacier Cup']
  },
  {
    name: 'Create Tournament',
    syntax: '/create tournament',
    prefixSyntax: '!create tournament [slots] [tags] [groups]',
    category: 'setup',
    permission: 'Admin / Staff',
    params: 'slots, tags, groups (teams/group), title, rules',
    description: 'Provisions a new tournament with custom slot counts and multi-group breakdowns (Group A, Group B, Group C, etc.).',
    examples: ['/create tournament slots:40 tags:4 groups:20 title:Championship']
  },
  {
    name: 'Registration Panel Embed',
    syntax: '/setup_registration_panel',
    prefixSyntax: '!setup_registration_panel',
    category: 'setup',
    permission: 'Admin / Staff',
    description: 'Publishes the official interactive tournament registration embed and "Register Your Team" button in #registration.',
    examples: ['/setup_registration_panel']
  },
  {
    name: 'Start / Resume Registration',
    syntax: '/start-registration',
    prefixSyntax: '!start-registration (or !unlock)',
    category: 'setup',
    permission: 'Admin / Staff',
    description: 'Unlocks #registration so players can tag squad members to claim slots, and marks tournament status as OPEN.',
    examples: ['/start-registration', '!unlock']
  },
  {
    name: 'Pause Registration',
    syntax: '/pause-registration',
    prefixSyntax: '!pause-registration [reason] (or !pause)',
    category: 'setup',
    permission: 'Admin / Staff',
    params: 'reason (optional)',
    description: 'Temporarily locks #registration with an informative notice while staff review rosters or adjust parameters.',
    examples: ['/pause-registration reason:Reviewing waitlist entries']
  },
  {
    name: 'Stop / End Registration',
    syntax: '/stop-registration',
    prefixSyntax: '!stop-registration [reason] (or !lock)',
    category: 'setup',
    permission: 'Admin / Staff',
    params: 'reason (optional)',
    description: 'Permanently ends registrations and locks #registration when all slots and waitlist queues are full.',
    examples: ['/stop-registration reason:All slots filled']
  },
  {
    name: 'Delete Slot',
    syntax: '/delete slot',
    prefixSyntax: '!delete slot <slot_number>',
    category: 'roster',
    permission: 'Admin / Staff',
    params: 'slot (int)',
    description: 'Disqualifies/removes a team from a slot, deletes their team role & private voice workspace, and auto-promotes waitlist #1 to confirmed.',
    examples: ['/delete slot slot:5', '!delete slot 5']
  },
  {
    name: 'Delete Tournament',
    syntax: '/delete tournament',
    prefixSyntax: '!delete tournament [confirm]',
    category: 'setup',
    permission: 'Admin / Staff',
    params: 'delete_channels (bool), confirm (bool)',
    description: 'Safely deletes tournament category, channels, team voice channels, team categories, team roles, and resets all registered rosters.',
    examples: ['/delete tournament delete_channels:true confirm:true', '!delete tournament confirm']
  },
  {
    name: 'Publish Room ID & Password',
    syntax: '/idpass',
    prefixSyntax: '!idpass <room_id> <password> [map] [match_time]',
    category: 'match',
    permission: 'Admin / Staff',
    params: 'room_id (string), password (string), map (optional), match_time (optional)',
    description: 'Broadcasts private custom match credentials to #🔑┃id-pass (restricted to @Verified Team) with @here notification.',
    examples: ['/idpass room_id:8942104 password:glacier99 map:Erangel match_time:8:00PM']
  },
  {
    name: 'Swap Slots',
    syntax: '/swap-slots',
    prefixSyntax: '!swap <slot1> <slot2>',
    category: 'roster',
    permission: 'Admin / Staff',
    params: 'slot1 (int), slot2 (int)',
    description: 'Swaps the allocated slot numbers and group assignments of two registered squads and immediately updates #slot-list.',
    examples: ['/swap-slots slot1:3 slot2:14', '!swap 3 14']
  },
  {
    name: 'Player Tagcheck',
    syntax: '/tagcheck',
    prefixSyntax: '!tagcheck <@user or user_id>',
    category: 'roster',
    permission: 'Admin / Staff',
    params: 'user (user mention or ID)',
    description: 'Verifies if a player is eligible, already registered on another squad roster, or on the blacklist.',
    examples: ['/tagcheck user:@Player1', '!tagcheck 123456789012345678']
  },
  {
    name: 'Team Dossier & Voice Info',
    syntax: '/team-info',
    prefixSyntax: '!team <slot_number or team_name>',
    category: 'roster',
    permission: 'Public',
    params: 'query (slot # or team name)',
    description: 'Displays complete squad information, slot allocation, assigned group, verified player tags, and voice channel connect link.',
    examples: ['/team-info query:Soul', '!team 1']
  },
  {
    name: 'Blacklist Management',
    syntax: '/blacklist',
    prefixSyntax: '!blacklist <add|remove|list> <@user> [reason]',
    category: 'roster',
    permission: 'Admin / Staff',
    params: 'subcommand: add, remove, list',
    description: 'Bans fairplay violators from registering or being tagged in any roster. Auto-rejects teams that tag blacklisted players.',
    examples: ['/blacklist add user:@Cheater reason:Fairplay violation', '/blacklist list']
  },
  {
    name: 'Official Standings',
    syntax: '/standings',
    prefixSyntax: '!standings [group]',
    category: 'info',
    permission: 'Public',
    params: 'group (optional, e.g. A, B)',
    description: 'Displays official tournament leaderboard, match wins, finish points, and official placement points scoring matrix.',
    examples: ['/standings', '!standings Group A']
  },
  {
    name: 'Publish Tournament Rules',
    syntax: '/rules',
    prefixSyntax: '!rules [rulebook text]',
    category: 'info',
    permission: 'Admin / Staff',
    params: 'rules (string, optional)',
    description: 'Opens the interactive rules editor modal or directly publishes custom tournament format rules to #📋┃rules-format.',
    examples: ['/rules', '!rules Points: 1st=10, 2nd=6, Kill=1']
  },
  {
    name: 'Official Announcement',
    syntax: '/announce',
    prefixSyntax: '!announce <message>',
    category: 'match',
    permission: 'Admin / Staff',
    params: 'message (string), ping_everyone (bool)',
    description: 'Broadcasts an official tournament announcement embed with @here ping to the active channel.',
    examples: ['/announce message:Round 1 starts in 10 minutes!']
  },
  {
    name: 'Export Rosters (CSV / Markdown)',
    syntax: '/export',
    prefixSyntax: '!export [csv|markdown]',
    category: 'info',
    permission: 'Admin / Staff',
    params: 'format: csv or markdown',
    description: 'Exports clean, copyable roster lists ready for casters, production overlays, and Google Sheets.',
    examples: ['/export format:csv', '!export markdown']
  },
  {
    name: 'Live Slot List',
    syntax: '/slots',
    prefixSyntax: '!slots',
    category: 'info',
    permission: 'Public',
    description: 'Shows live confirmed slot count, waitlist position, group divisions, and remaining available slots.',
    examples: ['/slots']
  }
];

export const CommandsPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'setup' | 'match' | 'roster' | 'info'>('all');
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSyncCommands = async () => {
    setIsSyncing(true);
    setSyncStatus('Syncing commands with Discord Gateway...');
    try {
      const res = await fetch('/api/bot/sync-commands', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSyncStatus(`Successfully registered ${data.count} slash commands in Discord!`);
      } else {
        setSyncStatus(`Sync notice: ${data.error || 'Failed to sync'}`);
      }
    } catch (err: any) {
      setSyncStatus(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  const filtered = COMMANDS_DATA.filter(cmd => {
    const matchesCategory = selectedCategory === 'all' || cmd.category === selectedCategory;
    const matchesSearch =
      cmd.name.toLowerCase().includes(search.toLowerCase()) ||
      cmd.syntax.toLowerCase().includes(search.toLowerCase()) ||
      cmd.prefixSyntax.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8 w-full animate-fadeIn">
      {/* Page Header */}
      <div className="p-6 sm:p-8 rounded-[24px] esports-card flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[#38BDF8]/10 blur-[90px]" />
        <div className="space-y-2 relative">
          <div className="eyebrow-label">
            Discord Slash &amp; Prefix Commands
          </div>
          <h2 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Discord Bot Command Suite
          </h2>
          <p className="text-xs sm:text-sm text-white/55 max-w-2xl leading-relaxed">
            All commands can be typed in any Discord server channel where FFA-Manager is authorized.
            Staff commands require the <code className="text-[#38BDF8] font-mono">@FFA Bot Manager</code> role.
          </p>
        </div>

        <button
          onClick={handleSyncCommands}
          disabled={isSyncing}
          className="btn-glacier-secondary h-11 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer self-start lg:self-center whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4 text-[#38BDF8]" />
          <span>{isSyncing ? 'Syncing...' : 'Sync Slash Commands to Discord'}</span>
        </button>
      </div>

      {syncStatus && (
        <div className="p-4 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/30 text-xs text-[#7DD3FC] flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" />
          <span>{syncStatus}</span>
        </div>
      )}

      {/* Filter and Search Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { key: 'all', label: 'All Commands' },
              { key: 'setup', label: '🏆 Setup & Lifecycle' },
              { key: 'match', label: '🔑 Match & IDP' },
              { key: 'roster', label: '🛡️ Roster & Tagcheck' },
              { key: 'info', label: '📊 Standings & Info' }
            ] as const
          ).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedCategory(tab.key)}
              className={`h-9 px-4 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === tab.key
                  ? 'bg-white/[0.1] text-white font-semibold border border-white/[0.15] shadow-xs'
                  : 'text-white/60 hover:text-white border border-transparent hover:bg-white/[0.04]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72 shrink-0">
          <Search className="w-3.5 h-3.5 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search commands or syntax..."
            className="w-full h-10 pl-9 pr-4 rounded-xl esports-input text-xs placeholder-white/35"
          />
        </div>
      </div>

      {/* Commands Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(cmd => (
          <div
            key={cmd.name}
            className="p-5 sm:p-6 rounded-2xl esports-card-sub flex flex-col justify-between gap-4 group hover:border-[#38BDF8]/30 transition-colors"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display font-bold text-white text-sm sm:text-base">
                    {cmd.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-semibold ${
                        cmd.permission === 'Admin / Staff'
                          ? 'bg-[#38BDF8]/10 text-[#7DD3FC] border-[#38BDF8]/20'
                          : 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'
                      }`}
                    >
                      {cmd.permission}
                    </span>
                    {cmd.params && (
                      <span className="text-[11px] font-mono text-white/40 truncate max-w-[160px]" title={cmd.params}>
                        {cmd.params}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-white/65 leading-relaxed">
                {cmd.description}
              </p>
            </div>

            <div className="pt-3 border-t border-white/[0.07] space-y-2">
              <div className="flex items-center justify-between gap-2 bg-black/40 p-2 rounded-xl border border-white/[0.06]">
                <code className="text-xs font-mono font-bold text-[#38BDF8] select-all">
                  {cmd.syntax}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(cmd.syntax, cmd.name)}
                  className="p-1 rounded-lg hover:bg-white/[0.08] text-white/50 hover:text-white transition-colors cursor-pointer"
                  title="Copy command syntax"
                >
                  {copiedIndex === cmd.name ? (
                    <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <div className="text-[11px] font-mono text-white/40 flex items-center justify-between">
                <span>Prefix: <code className="text-white/60 select-all">{cmd.prefixSyntax}</code></span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-white/45 text-sm">
          No commands matched your filter "{search}".
        </div>
      )}
    </div>
  );
};
