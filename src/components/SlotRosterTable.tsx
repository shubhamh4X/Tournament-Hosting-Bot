import React, { useState } from 'react';
import { TeamRegistration, TournamentConfig } from '../types/tournament';
import { formatTeamsAsCsv, sortTeamsConsistently, getGroupLetter } from '../utils/tagParser';
import { TeamRegistrationModal } from './TeamRegistrationModal';
import {
  Download,
  Copy,
  Trash2,
  Search,
  Users,
  Volume2,
  UserPlus,
  Phone,
  Globe2
} from 'lucide-react';

interface SlotRosterTableProps {
  teams: TeamRegistration[];
  config: TournamentConfig;
  onKickTeam: (teamId: string) => void;
  onClearAll: () => void;
  onRefreshTeams?: () => void;
  onConnectTeamVoice?: (team: TeamRegistration) => void;
}

export const SlotRosterTable: React.FC<SlotRosterTableProps> = ({
  teams,
  config,
  onKickTeam,
  onRefreshTeams,
  onConnectTeamVoice
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedDiscord, setCopiedDiscord] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);

  const sortedTeams = sortTeamsConsistently(teams);
  const confirmed = sortedTeams.filter(t => !t.isWaitlist);
  const waitlist = sortedTeams.filter(t => t.isWaitlist);
  const groupsCount = config.groupsCount || 1;

  const filteredTeams = sortedTeams.filter(t => {
    const matchesSearch =
      t.teamName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.captain.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.region && t.region.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.whatsappNumber1 && t.whatsappNumber1.includes(searchQuery)) ||
      t.players.some(p => p.displayName.toLowerCase().includes(searchQuery.toLowerCase()));

    if (activeTab === 'confirmed') return matchesSearch && !t.isWaitlist;
    if (activeTab === 'waitlist') return matchesSearch && t.isWaitlist;
    if (activeTab.startsWith('group-')) {
      const targetGroup = activeTab.replace('group-', 'Group ');
      return matchesSearch && !t.isWaitlist && (t.group === targetGroup || (!t.group && targetGroup === 'Group A'));
    }
    return matchesSearch;
  });

  const handleExportCSV = () => {
    const csv = formatTeamsAsCsv(sortedTeams, true);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${(config.title || 'glacier_cup').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_slots.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyDiscordFormat = () => {
    const gamePrefix = config.game ? `**Game:** ${config.game} | ` : '';
    let discordText = `**🏆 ${config.title || 'Glacier Cup'} — Official Slot List**\n`;
    discordText += `${gamePrefix}**Format:** ${config.format} (Min ${config.requiredTags} Tags)\n`;
    discordText += `**Confirmed Teams (${confirmed.length}/${config.totalSlots}):**\n`;

    if (groupsCount > 1) {
      const slotsPerGroup =
        config.teamsPerGroup && config.teamsPerGroup > 0
          ? Math.min(config.totalSlots, Math.max(1, config.teamsPerGroup))
          : Math.ceil(config.totalSlots / groupsCount);
      for (let g = 0; g < groupsCount; g++) {
        const groupLetter = getGroupLetter(g);
        const startSlot = (g * slotsPerGroup) + 1;
        const endSlot = Math.min((g + 1) * slotsPerGroup, config.totalSlots);
        if (startSlot > config.totalSlots) break;

        discordText += `\n**━━━ 👥 Group ${groupLetter} (Slots ${startSlot}–${endSlot}) ━━━**\n`;
        for (let i = startSlot; i <= endSlot; i++) {
          const team = confirmed.find(t => t.slotNumber === i);
          if (team) {
            discordText += `\`[${i < 10 ? '0' + i : i}]\` **${team.teamName}** — <@${team.captain.id}>\n`;
          } else {
            discordText += `\`[${i < 10 ? '0' + i : i}]\` *— Reserved / Open Slot —*\n`;
          }
        }
      }
    } else {
      for (let i = 1; i <= config.totalSlots; i++) {
        const team = confirmed.find(t => t.slotNumber === i);
        if (team) {
          discordText += `\`[${i < 10 ? '0' + i : i}]\` **${team.teamName}** — <@${team.captain.id}>\n`;
        } else {
          discordText += `\`[${i < 10 ? '0' + i : i}]\` *— Open Slot —*\n`;
        }
      }
    }

    if (waitlist.length > 0) {
      discordText += `\n**⏳ Waiting List (${waitlist.length}/${config.waitlistSlots}):**\n`;
      waitlist.forEach(w => {
        discordText += `\`WL #${w.slotNumber}\` **${w.teamName}** (<@${w.captain.id}>)\n`;
      });
    }

    navigator.clipboard.writeText(discordText);
    setCopiedDiscord(true);
    setTimeout(() => setCopiedDiscord(false), 2000);
  };

  return (
    <div className="space-y-8 w-full">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 p-5 sm:p-6 rounded-[24px] esports-card">
        <div className="space-y-2">
          <div className="eyebrow-label">
            Real-Time Verified Squads
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Live Tournament Slot Roster
            </h2>
            <span className="text-xs font-mono tabular-nums px-3 py-1 rounded-full bg-white/[0.04] text-[#38BDF8] border border-white/10">
              {confirmed.length}/{config.totalSlots} Slots Occupied
            </span>
          </div>
          <p className="text-xs sm:text-sm text-white/55 max-w-2xl leading-relaxed">
            Real-time slots verified by FFA | Glacier Cup Manager™ Tagcheck. Kicking a confirmed team automatically promotes the top waitlist team.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={() => setIsRegisterModalOpen(true)}
            className="btn-glacier-primary h-11 px-5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            <span>Register Team</span>
          </button>

          <button
            onClick={handleCopyDiscordFormat}
            className="btn-glacier-secondary h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>{copiedDiscord ? 'Copied to Clipboard!' : 'Copy Discord Format'}</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="btn-glacier-secondary h-11 px-4 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white/[0.03] rounded-2xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('all')}
            className={`h-9 px-4 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-white/[0.09] text-white border border-white/15'
                : 'text-white/55 hover:text-white'
            }`}
          >
            All Teams (<span className="font-mono tabular-nums">{teams.length}</span>)
          </button>

          {groupsCount > 1 ? (
            Array.from({ length: groupsCount }, (_, i) => {
              const gLetter = getGroupLetter(i);
              const gName = `Group ${gLetter}`;
              const gCount = confirmed.filter(t => t.group === gName || (!t.group && i === 0)).length;
              return (
                <button
                  key={gName}
                  onClick={() => setActiveTab(`group-${gLetter}`)}
                  className={`h-9 px-4 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === `group-${gLetter}`
                      ? 'btn-glacier-primary text-white'
                      : 'text-white/55 hover:text-white'
                  }`}
                >
                  Group {gLetter} (<span className="font-mono tabular-nums">{gCount}</span>)
                </button>
              );
            })
          ) : (
            <button
              onClick={() => setActiveTab('confirmed')}
              className={`h-9 px-4 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'confirmed'
                  ? 'bg-white/[0.09] text-white border border-white/15'
                  : 'text-white/55 hover:text-white'
              }`}
            >
              Confirmed Slots (<span className="font-mono tabular-nums">{confirmed.length}</span>)
            </button>
          )}

          <button
            onClick={() => setActiveTab('waitlist')}
            className={`h-9 px-4 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'waitlist'
                ? 'bg-white/[0.09] text-white border border-white/15'
                : 'text-white/55 hover:text-white'
            }`}
          >
            Waiting List (<span className="font-mono tabular-nums">{waitlist.length}</span>)
          </button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-white/40 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search team, captain, or player..."
            className="w-full h-11 pl-10 pr-4 rounded-2xl esports-input text-xs placeholder-white/35"
          />
        </div>
      </div>

      <div className="rounded-[28px] esports-card overflow-hidden">
        {filteredTeams.length === 0 ? (
          <div className="py-20 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center mx-auto mb-4 text-[#38BDF8]">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-display text-lg font-bold text-white">
              No Teams Registered Yet
            </h3>
            <p className="text-xs sm:text-sm text-white/50 mt-2 max-w-md mx-auto leading-relaxed">
              {searchQuery
                ? 'No registered team matches your search query.'
                : 'No teams have registered yet. Teams can register in the Discord #registration channel or via the Register Team button above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.02] text-[11px] font-semibold text-white/45 border-b border-white/[0.07] uppercase tracking-wider">
                <tr>
                  <th className="py-4 px-5 w-24">Slot</th>
                  <th className="py-4 px-5 w-28">Group</th>
                  <th className="py-4 px-5 w-28">Region</th>
                  <th className="py-4 px-5">Team Name</th>
                  <th className="py-4 px-5">Captain</th>
                  <th className="py-4 px-5">Contact (WhatsApp)</th>
                  <th className="py-4 px-5">Verified Roster Tags</th>
                  <th className="py-4 px-5">Team Role &amp; Private VC</th>
                  <th className="py-4 px-5 w-28">Registered</th>
                  <th className="py-4 px-5 text-right w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filteredTeams.map(team => (
                  <tr
                    key={team.id}
                    className="hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="py-4 px-5 whitespace-nowrap">
                      {team.isWaitlist ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-mono tabular-nums font-bold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/25">
                          WL #{team.slotNumber}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-lg text-[11px] font-mono tabular-nums font-bold bg-[#38BDF8]/12 text-[#7DD3FC] border border-[#38BDF8]/30">
                          Slot #{team.slotNumber < 10 ? `0${team.slotNumber}` : team.slotNumber}
                        </span>
                      )}
                    </td>

                    <td className="py-4 px-5 whitespace-nowrap font-mono text-[11px]">
                      {team.isWaitlist ? (
                        <span className="text-white/30">—</span>
                      ) : (
                        <span className="text-white/80 font-medium">
                          {team.group || 'Group A'}
                        </span>
                      )}
                    </td>

                    <td className="py-4 px-5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.08] text-white/90">
                        {team.region === 'Pakistan' ? '🇵🇰 Pakistan' : team.region === 'Bangladesh' ? '🇧🇩 Bangladesh' : '🇮🇳 India'}
                      </span>
                    </td>

                    <td className="py-4 px-5 font-display font-bold text-sm text-white whitespace-nowrap">
                      {team.teamName}
                    </td>

                    <td className="py-4 px-5 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={team.captain.avatar}
                          alt=""
                          className="w-6 h-6 rounded-full bg-black border border-white/15 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <span className="text-xs font-medium text-white/90">
                          @{team.captain.displayName}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-5 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                        <span className="text-[#10B981] flex items-center gap-1.5 font-medium">
                          <Phone className="w-3 h-3 shrink-0" />
                          {team.whatsappNumber1 || '—'}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-5">
                      <div className="flex flex-wrap gap-1.5 max-w-md">
                        {team.players.map(player => (
                          <span
                            key={player.id}
                            className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-mono bg-white/[0.03] text-white/80 border border-white/[0.08]"
                            title={`ID: ${player.id}`}
                          >
                            @{player.displayName}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td className="py-4 px-5 whitespace-nowrap">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-col gap-0.5 text-[11px] font-mono">
                          <span className="text-[#38BDF8] font-semibold">
                            @{team.teamRoleName || team.teamName}
                          </span>
                          <span className="text-white/45">
                            📁 {team.teamCategoryName || team.teamName} · 🔊 {team.teamVoiceChannelName || team.teamName}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[#10B981] text-[11px] font-mono shrink-0">
                          <Volume2 className="w-3 h-3" />
                          <span>VC Ready</span>
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-5 text-xs text-white/45 whitespace-nowrap font-mono tabular-nums">
                      {new Date(team.registeredAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>

                    <td className="py-4 px-5 text-right whitespace-nowrap">
                      <button
                        onClick={() => onKickTeam(team.id)}
                        className="h-8 px-3 rounded-xl bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#F87171] border border-[#EF4444]/25 text-[11px] font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer"
                        title="Disqualify/Kick Team (Frees slot and promotes next in waitlist)"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Disqualify</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TeamRegistrationModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        config={config}
        existingTeams={teams}
        onSuccess={() => {
          if (onRefreshTeams) onRefreshTeams();
        }}
      />
    </div>
  );
};

