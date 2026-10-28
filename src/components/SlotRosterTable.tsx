import React, { useMemo, useState } from 'react';
import { TeamRegistration, TournamentConfig } from '../types/tournament';
import { sortTeamsConsistently, getGroupLetter } from '../utils/tagParser';
import {
  Users,
  Layers,
  ChevronDown,
  Crown,
  Globe,
  Phone,
  Clock,
  Shield,
  Volume2,
  Trash2,
  X
} from 'lucide-react';

interface SlotRosterTableProps {
  teams: TeamRegistration[];
  config: TournamentConfig;
  onKickTeam: (teamId: string) => void;
  onClearAll: () => void;
  onRefreshTeams?: () => void;
  onUpdateConfig?: (newConfig: Partial<TournamentConfig>) => void;
  onConnectTeamVoice?: (team: TeamRegistration) => void;
  onOpenIdpModal?: () => void;
}

export const SlotRosterTable: React.FC<SlotRosterTableProps> = ({
  teams,
  config,
  onKickTeam
}) => {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [confirmCancelTeamId, setConfirmCancelTeamId] = useState<string | null>(null);
  const [cancelingTeamId, setCancelingTeamId] = useState<string | null>(null);

  const confirmedTeams = useMemo(
    () => sortTeamsConsistently(teams).filter(t => !t.isWaitlist),
    [teams]
  );

  // Calculate group for each slot systematically using the bot's group logic
  const getTeamGroupName = (team: TeamRegistration): string => {
    if (team.group && team.group.trim()) {
      return team.group.trim();
    }
    const totalSlots = Math.max(1, config.totalSlots || confirmedTeams.length || 1);
    const teamsPerGroup =
      config.teamsPerGroup && config.teamsPerGroup > 0
        ? Math.min(totalSlots, Math.max(1, config.teamsPerGroup))
        : Math.ceil(totalSlots / Math.max(1, config.groupsCount || 1));
    const groupsCount = Math.max(1, Math.ceil(totalSlots / teamsPerGroup));
    if (groupsCount > 1) {
      const groupIdx = Math.max(
        0,
        Math.min(groupsCount - 1, Math.floor((team.slotNumber - 1) / teamsPerGroup))
      );
      return `Group ${getGroupLetter(groupIdx)}`;
    }
    return 'Group A';
  };

  // Group registered teams systematically by their respective Group (Group A, Group B, ...)
  const groupedTeams = useMemo(() => {
    const map = new Map<string, TeamRegistration[]>();
    for (const team of confirmedTeams) {
      const groupName = getTeamGroupName(team);
      const list = map.get(groupName) || [];
      list.push(team);
      map.set(groupName, list);
    }
    return Array.from(map.entries()).map(([groupName, groupRoster]) => ({
      groupName,
      teams: groupRoster.sort((a, b) => a.slotNumber - b.slotNumber)
    }));
  }, [confirmedTeams, config.totalSlots, config.teamsPerGroup, config.groupsCount]);

  const handleToggleTeam = (teamId: string) => {
    setExpandedTeamId(prev => {
      const next = prev === teamId ? null : teamId;
      if (next !== teamId) {
        setConfirmCancelTeamId(null);
      }
      return next;
    });
  };

  const handleCancelSlot = async (teamId: string) => {
    setCancelingTeamId(teamId);
    try {
      await Promise.resolve(onKickTeam(teamId));
      setConfirmCancelTeamId(null);
      setExpandedTeamId(null);
    } finally {
      setCancelingTeamId(null);
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      {/* Clean Header */}
      <div className="p-5 sm:p-6 rounded-2xl esports-card flex items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="eyebrow-label">Registered Teams</span>
          <h2 className="font-display text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Team Slots
          </h2>
        </div>

        <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono tabular-nums font-semibold bg-[#38BDF8]/10 text-[#7DD3FC] border border-[#38BDF8]/25">
          <Users className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>{confirmedTeams.length} Registered</span>
        </span>
      </div>

      {/* Systematic Group & Slot List */}
      {confirmedTeams.length === 0 ? (
        <div className="py-16 px-6 rounded-2xl esports-card text-center">
          <div className="w-11 h-11 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center mx-auto mb-3 text-[#38BDF8]">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="font-display text-base font-bold text-white">
            No Registered Teams Yet
          </h3>
          <p className="text-xs text-white/50 mt-1">
            Registered teams will appear here systematically with their slot number and group.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedTeams.map(({ groupName, teams: groupRoster }) => (
            <section
              key={groupName}
              className="rounded-2xl esports-card overflow-hidden"
            >
              {/* Group Banner */}
              <div className="px-5 py-3.5 bg-white/[0.02] border-b border-white/[0.07] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Layers className="w-4 h-4 text-[#38BDF8]" />
                  <h3 className="font-display text-sm sm:text-base font-bold text-white tracking-tight">
                    {groupName}
                  </h3>
                </div>
                <span className="text-xs font-mono tabular-nums text-white/55">
                  {groupRoster.length} {groupRoster.length === 1 ? 'Team' : 'Teams'}
                </span>
              </div>

              {/* Systematic Slot Rows */}
              <div className="divide-y divide-white/[0.06]">
                {groupRoster.map(team => {
                  const paddedSlot =
                    team.slotNumber < 10 ? `0${team.slotNumber}` : String(team.slotNumber);
                  const isExpanded = expandedTeamId === team.id;
                  const isConfirmingCancel = confirmCancelTeamId === team.id;
                  const isCanceling = cancelingTeamId === team.id;

                  return (
                    <div key={team.id} className="transition-colors">
                      {/* Clickable Team Row */}
                      <button
                        type="button"
                        onClick={() => handleToggleTeam(team.id)}
                        className={`w-full px-5 py-3.5 flex items-center justify-between gap-4 text-left transition-colors cursor-pointer ${
                          isExpanded
                            ? 'bg-[#38BDF8]/[0.05]'
                            : 'hover:bg-white/[0.025]'
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <span className="inline-flex items-center justify-center px-3 py-1 rounded-lg text-xs font-mono tabular-nums font-bold bg-[#38BDF8]/12 text-[#7DD3FC] border border-[#38BDF8]/30 shrink-0">
                            Slot #{paddedSlot}
                          </span>
                          <span className="font-display font-bold text-sm sm:text-base text-white truncate">
                            {team.teamName}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="inline-flex items-center px-3 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs font-mono font-medium text-white/80">
                            {groupName}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-white/45 transition-transform duration-200 ${
                              isExpanded ? 'rotate-180 text-[#38BDF8]' : ''
                            }`}
                          />
                        </div>
                      </button>

                      {/* Expanded Team Details & Cancel Slot Panel */}
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-3 bg-black/40 border-t border-white/[0.06] space-y-4">
                          {/* Metadata Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {/* Captain */}
                            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-white/45">
                                <Crown className="w-3.5 h-3.5 text-[#38BDF8]" />
                                <span>Team Leader</span>
                              </div>
                              <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                {team.captain?.displayName || team.captain?.username || 'Unknown'}
                              </p>
                              <p className="text-[11px] font-mono text-white/45 truncate">
                                @{team.captain?.username || 'captain'}
                              </p>
                            </div>

                            {/* Region */}
                            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-white/45">
                                <Globe className="w-3.5 h-3.5 text-[#38BDF8]" />
                                <span>Region</span>
                              </div>
                              <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                {team.region || 'India'}
                              </p>
                              <p className="text-[11px] font-mono text-white/45 truncate">
                                {groupName} • Slot #{paddedSlot}
                              </p>
                            </div>

                            {/* WhatsApp Number */}
                            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-white/45">
                                <Phone className="w-3.5 h-3.5 text-[#38BDF8]" />
                                <span>WhatsApp</span>
                              </div>
                              <p className="text-xs sm:text-sm font-mono font-semibold text-white truncate">
                                {team.whatsappNumber1 || 'Not provided'}
                              </p>
                              <p className="text-[11px] font-mono text-white/45 truncate">
                                Contact Number
                              </p>
                            </div>

                            {/* Registered At */}
                            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-white/45">
                                <Clock className="w-3.5 h-3.5 text-[#38BDF8]" />
                                <span>Registered At</span>
                              </div>
                              <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                {formatTimestamp(team.registeredAt)}
                              </p>
                              <p className="text-[11px] font-mono text-emerald-400/80 truncate">
                                Confirmed Slot
                              </p>
                            </div>
                          </div>

                          {/* Players Roster */}
                          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-mono uppercase tracking-wider text-white/50">
                                Registered Players ({team.players?.length || 0})
                              </span>
                              {(team.teamRoleName || team.teamVoiceChannelName) && (
                                <div className="flex items-center gap-3 text-[11px] font-mono text-white/45">
                                  {team.teamRoleName && (
                                    <span className="inline-flex items-center gap-1">
                                      <Shield className="w-3 h-3 text-[#38BDF8]" />
                                      {team.teamRoleName}
                                    </span>
                                  )}
                                  {team.teamVoiceChannelName && (
                                    <span className="inline-flex items-center gap-1">
                                      <Volume2 className="w-3 h-3 text-[#38BDF8]" />
                                      {team.teamVoiceChannelName}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {team.players && team.players.length > 0 ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {team.players.map((player, idx) => (
                                  <div
                                    key={`${player.id}-${idx}`}
                                    className="px-3 py-2 rounded-lg bg-black/40 border border-white/[0.06] flex items-center justify-between gap-2"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <span className="w-5 h-5 rounded-md bg-[#38BDF8]/10 border border-[#38BDF8]/25 text-[#7DD3FC] text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                                        P{idx + 1}
                                      </span>
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-white truncate">
                                          {player.displayName || player.username}
                                        </p>
                                        <p className="text-[11px] font-mono text-white/45 truncate">
                                          @{player.username}
                                        </p>
                                      </div>
                                    </div>
                                    <span className="text-[10px] font-mono text-white/35 shrink-0">
                                      {player.id}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-white/45">
                                No additional player tags recorded.
                              </p>
                            )}
                          </div>

                          {/* Actions Footer: Cancel Slot */}
                          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                            <span className="text-[11px] font-mono text-white/40">
                              Canceling this slot removes the team, frees Slot #{paddedSlot}, and updates Discord in real time.
                            </span>

                            {!isConfirmingCancel ? (
                              <button
                                type="button"
                                onClick={() => setConfirmCancelTeamId(team.id)}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Cancel Slot</span>
                              </button>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={isCanceling}
                                  onClick={() => handleCancelSlot(team.id)}
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{isCanceling ? 'Canceling...' : 'Confirm Cancel Slot'}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isCanceling}
                                  onClick={() => setConfirmCancelTeamId(null)}
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] text-white/75 border border-white/10 transition-colors cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>Keep</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

