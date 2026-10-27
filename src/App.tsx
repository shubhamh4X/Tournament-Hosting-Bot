import React, { useState, useEffect } from 'react';
import {
  TournamentConfig,
  TeamRegistration,
  RoomCredentials,
  GatewayOperationalState
} from './types/tournament';
import { TourneyConfigPanel } from './components/TourneyConfigPanel';
import { SlotRosterTable } from './components/SlotRosterTable';
import { RoomIdpModal } from './components/RoomIdpModal';
import { LiveBotRunner } from './components/LiveBotRunner';
import { KeyRound, Radio, ShieldCheck, Trophy, Users, SlidersHorizontal, UserPlus } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'live-bot' | 'config' | 'roster'>('live-bot');
  const [isIdpModalOpen, setIsIdpModalOpen] = useState<boolean>(false);
  const [isBotOnline, setIsBotOnline] = useState<boolean>(false);
  const [botClientId, setBotClientId] = useState<string>('1564392085094666353');
  const [gatewayState, setGatewayState] = useState<GatewayOperationalState>('disconnected');

  const [config, setConfig] = useState<TournamentConfig>({
    id: '',
    title: 'Glacier Cup',
    game: '',
    format: 'Squad',
    requiredTags: 4,
    maxTags: 4,
    totalSlots: 20,
    waitlistSlots: 5,
    groupsCount: 1,
    categoryName: '',
    verifiedRoleName: 'Verified Team',
    managerRoleName: 'FFA Bot Manager',
    easyTagEnabled: true,
    prohibitDuplicateTags: true,
    prohibitSelfDuplication: true,
    disallowBots: true,
    autoDeleteInvalid: true,
    autoDeleteSeconds: 5,
    autoCreateTeamVoice: true,
    status: 'open',
    regChannel: 'registration',
    slotListChannel: 'slot-list',
    idpChannel: 'id-pass',
    rulesMessage: 'Format:\nTeam Name: <Your Team>\nPlayer 1: @Tag1\nPlayer 2: @Tag2\nPlayer 3: @Tag3\nPlayer 4: @Tag4',
    roleName: 'Confirmed Slot'
  });

  const [registeredTeams, setRegisteredTeams] = useState<TeamRegistration[]>([]);
  const [roomDispatch, setRoomDispatch] = useState<RoomCredentials | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.totalSlots === 'number') {
          setConfig(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});

    fetch('/api/teams')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.confirmed)) {
          setRegisteredTeams([...data.confirmed, ...(data.waitlist || [])]);
        }
      })
      .catch(() => {});
  }, []);

  const refreshTeams = () => {
    fetch('/api/teams')
      .then(res => res.json())
      .then(data => {
        if (data && data.confirmed) {
          setRegisteredTeams([...data.confirmed, ...(data.waitlist || [])]);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    const syncState = () => {
      fetch('/api/bot/status')
        .then(r => r.json())
        .then(s => {
          setIsBotOnline(s?.isOnline || false);
          if (s?.botUser?.id) {
            setBotClientId(s.botUser.id);
          } else if (s?.clientId) {
            setBotClientId(s.clientId);
          }
          if (s?.gatewayState) {
            setGatewayState(s.gatewayState);
          } else {
            setGatewayState(s?.isOnline ? 'connected' : s?.isConnecting ? 'reconnecting' : 'disconnected');
          }
        })
        .catch(() => {});

      fetch('/api/config')
        .then(res => res.json())
        .then(data => {
          if (data && typeof data.totalSlots === 'number') {
            setConfig(prev => ({ ...prev, ...data }));
          }
        })
        .catch(() => {});

      fetch('/api/teams')
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.confirmed)) {
            setRegisteredTeams([...data.confirmed, ...(data.waitlist || [])]);
          }
        })
        .catch(() => {});
    };
    syncState();
    const interval = setInterval(syncState, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdateConfig = (newConfig: Partial<TournamentConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).catch(() => {});
  };

  const handleKickTeam = (teamId: string) => {
    fetch('/api/teams/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId })
    })
      .then(r => r.json())
      .then(data => {
        if (data?.teams) {
          setRegisteredTeams(data.teams);
        } else {
          refreshTeams();
        }
      })
      .catch(() => {});
  };

  const handleResetTeams = () => {
    setRegisteredTeams([]);
    setConfig(prev => ({ ...prev, status: 'open' }));
    fetch('/api/teams/reset', { method: 'POST' }).catch(() => {});
  };

  const handleRoomDispatch = (creds: RoomCredentials) => {
    setRoomDispatch(creds);
    fetch('/api/idp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds)
    }).catch(() => {});
  };

  const confirmedTeams = registeredTeams.filter(t => !t.isWaitlist);
  const waitlistTeams = registeredTeams.filter(t => t.isWaitlist);
  const dotColor =
    gatewayState === 'connected'
      ? 'bg-[#10B981]'
      : gatewayState === 'partially_operational'
      ? 'bg-[#F59E0B]'
      : gatewayState === 'reconnecting'
      ? 'bg-[#38BDF8] animate-pulse'
      : 'bg-[#64748B]';
  const radioColor =
    gatewayState === 'connected'
      ? 'text-[#10B981]'
      : gatewayState === 'partially_operational'
      ? 'text-[#F59E0B]'
      : gatewayState === 'reconnecting'
      ? 'text-[#38BDF8]'
      : 'text-[#64748B]';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans selection:bg-[#38BDF8]/30 overflow-x-hidden">
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-2xl border-b border-white/[0.05] shrink-0">
        <div className="w-full max-w-7xl mx-auto h-20 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setActiveTab('live-bot');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer group text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#38BDF8] rounded-xl"
          >
            <div className="relative">
              <div className="pointer-events-none absolute -inset-1 rounded-xl bg-gradient-to-tr from-[#38BDF8]/30 to-[#0EA5E9]/20 opacity-0 group-hover:opacity-100 blur-xs transition-opacity" />
              <img
                src="/assets/glacier-cup-logo.png"
                alt="FFA | Glacier Cup Manager™"
                className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover border border-white/15 bg-[#080B11] group-hover:border-[#38BDF8]/45 transition-colors"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="font-display text-sm sm:text-[17px] font-bold tracking-tight text-white group-hover:text-[#E0F2FE] transition-colors">
              FFA | Glacier Cup Manager™
            </span>
          </button>

          <nav className="hidden md:flex items-center px-2.5 h-11 rounded-full nav-glass-dock gap-1 text-[13.5px]">
            <button
              type="button"
              onClick={() => {
                setActiveTab('live-bot');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                activeTab === 'live-bot'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1]'
                  : 'text-white/60 hover:text-white font-medium border border-transparent'
              }`}
            >
              Home
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                activeTab === 'config'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1]'
                  : 'text-white/60 hover:text-white font-medium border border-transparent'
              }`}
            >
              Rules
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('live-bot');
                setTimeout(() => {
                  const el = document.getElementById('bot-commands-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 60);
              }}
              className="h-8 px-4 rounded-full text-white/60 hover:text-white font-medium transition-all whitespace-nowrap cursor-pointer border border-transparent focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              Commands
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('roster')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                activeTab === 'roster'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1]'
                  : 'text-white/60 hover:text-white font-medium border border-transparent'
              }`}
            >
              <span>Slots</span>
              <span className="text-[11px] font-mono tabular-nums text-[#7DD3FC]">
                ({confirmedTeams.length}/{config.totalSlots})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('live-bot')}
              className="h-8 px-4 rounded-full text-white/60 hover:text-white font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-2 border border-transparent focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              <span>Gateway</span>
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <a
              href={`https://discord.com/api/oauth2/authorize?client_id=${botClientId || '1564392085094666353'}&permissions=8&scope=bot%20applications.commands`}
              target="_blank"
              rel="noreferrer"
              className="h-10 px-4 sm:px-5 rounded-full bg-[#0C0F15] hover:bg-[#141923] border border-white/[0.11] hover:border-[#38BDF8]/35 text-[13px] font-semibold text-white whitespace-nowrap shrink-0 flex items-center gap-2 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#7DD3FC]" />
              <span>Invite</span>
            </a>

            <button
              type="button"
              onClick={() => setIsIdpModalOpen(true)}
              className="h-10 px-4 sm:px-5 rounded-full bg-[#0C0F15] hover:bg-[#141923] border border-white/[0.11] hover:border-[#38BDF8]/35 text-[13px] font-semibold text-white whitespace-nowrap shrink-0 flex items-center gap-2 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              <KeyRound className="w-3.5 h-3.5 text-[#7DD3FC]" />
              <span>Publish IDP</span>
            </button>
          </div>
        </div>

        <div className="flex md:hidden items-center justify-center gap-4 bg-[#0B0D12]/95 border-t border-white/[0.06] px-4 py-2.5 text-xs overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('live-bot')}
            className={`px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'live-bot' ? 'bg-white/[0.08] text-white font-bold' : 'text-white/60 font-medium'
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'config' ? 'bg-white/[0.08] text-white font-bold' : 'text-white/60 font-medium'
            }`}
          >
            Rules
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('live-bot');
              setTimeout(() => {
                const el = document.getElementById('bot-commands-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }, 60);
            }}
            className="px-3 py-1 rounded-full whitespace-nowrap shrink-0 text-white/60 hover:text-white font-medium transition-colors"
          >
            Commands
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            className={`px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'roster' ? 'bg-white/[0.08] text-white font-bold' : 'text-white/60 font-medium'
            }`}
          >
            Slots ({confirmedTeams.length}/{config.totalSlots})
          </button>
          <button
            type="button"
            onClick={() => setIsIdpModalOpen(true)}
            className="px-3 py-1 rounded-full whitespace-nowrap shrink-0 text-white/60 hover:text-white font-medium transition-colors"
          >
            IDP Dispatch
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-24">
        <section className="relative pt-12 pb-10 sm:pt-16 sm:pb-12 text-center">
          <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 w-[880px] max-w-full h-[360px] rounded-full bg-gradient-to-b from-[#38BDF8]/15 via-[#0EA5E9]/8 to-transparent blur-[120px] -z-10" />
          <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 w-[480px] max-w-full h-[180px] rounded-full bg-[#BAE6FD]/8 blur-[80px] -z-10" />

          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#0EA5E9]/[0.07] border border-[#38BDF8]/25 mb-6 shadow-[0_0_24px_rgba(56,189,248,0.1)]">
            <Trophy className="w-3.5 h-3.5 text-[#7DD3FC]" />
            <span className="eyebrow-label">
              Automated Discord Tournament &amp; Scrims Engine
            </span>
          </div>

          <h1 className="font-display text-4xl sm:text-6xl lg:text-[4.5rem] font-black tracking-[-0.035em] leading-[1.08] pb-1.5 max-w-4xl mx-auto text-balance hero-gradient-text">
            Glacier Cup Manager
          </h1>

          <p className="mt-5 text-[15px] sm:text-base lg:text-[17px] text-white/65 max-w-2xl mx-auto leading-[1.7] font-normal">
            Precision tag-basis squad verification, cross-team anti-duplicate protection, automated multi-group slot allocation, private team voice channels, and instant Room ID &amp; Password dispatch.
          </p>

          <div className="mt-12 py-7 border-y border-white/[0.07] w-full grid grid-cols-2 sm:grid-cols-4 gap-y-6 sm:gap-y-0 sm:divide-x sm:divide-white/[0.07] text-center">
            <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                Active Format
              </div>
              <div className="font-display text-2xl sm:text-3xl font-extrabold text-white mt-2 flex items-baseline justify-center gap-2 tracking-tight">
                <span>{config.format}</span>
                <span className="text-xs font-mono text-[#7DD3FC] font-medium">
                  ({config.requiredTags} Tags)
                </span>
              </div>
            </div>

            <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                Confirmed Slots
              </div>
              <div className="font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-[#7DD3FC] mt-2 tracking-tight">
                {confirmedTeams.length}
                <span className="text-white/30 font-normal text-xl sm:text-2xl"> / {config.totalSlots}</span>
              </div>
            </div>

            <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                Waitlist Queue
              </div>
              <div className="font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">
                {waitlistTeams.length}
                <span className="text-white/30 font-normal text-xl sm:text-2xl"> / {config.waitlistSlots}</span>
              </div>
            </div>

            <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                Registration Status
              </div>
              <div className="font-mono text-base sm:text-lg font-bold uppercase mt-2.5 flex items-center justify-center gap-2.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    config.status === 'open'
                      ? 'bg-[#10B981] shadow-[0_0_10px_#10B981]'
                      : config.status === 'paused'
                      ? 'bg-[#F59E0B]'
                      : 'bg-[#EF4444]'
                  }`}
                />
                <span
                  className={
                    config.status === 'open'
                      ? 'text-[#10B981]'
                      : config.status === 'paused'
                      ? 'text-[#F59E0B]'
                      : 'text-[#EF4444]'
                  }
                >
                  {config.status}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="mb-10 border-y border-white/[0.07] bg-gradient-to-r from-transparent via-white/[0.018] to-transparent py-4 overflow-hidden glacier-marquee-mask select-none">
          <div className="glacier-marquee-track">
            {[0, 1].map(loopIdx => (
              <div key={loopIdx} className="flex items-center gap-10 sm:gap-14 pr-10 sm:pr-14 whitespace-nowrap">
                <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                  Powering Competitive Esports &amp; Scrims
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.24em] bg-gradient-to-r from-white via-[#E0F2FE] to-[#38BDF8] bg-clip-text text-transparent">
                  Glacier Cup Manager
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                  Automated Tag-Basis Squad Verification
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.24em] bg-gradient-to-r from-white via-[#E0F2FE] to-[#38BDF8] bg-clip-text text-transparent">
                  FFA Esports Engine
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                  Instant Room ID &amp; Password Dispatch
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.24em] bg-gradient-to-r from-white via-[#E0F2FE] to-[#38BDF8] bg-clip-text text-transparent">
                  Glacier Cup Manager
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                  Multi-Group Slot &amp; Waitlist Automation
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                <span className="font-display text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.24em] bg-gradient-to-r from-white via-[#E0F2FE] to-[#38BDF8] bg-clip-text text-transparent">
                  FFA Esports Engine
                </span>
                <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2">
          {activeTab === 'live-bot' && (
            <LiveBotRunner
              config={config}
              onRefreshTeams={refreshTeams}
              onUpdateConfig={handleUpdateConfig}
            />
          )}

          {activeTab === 'config' && (
            <TourneyConfigPanel
              config={config}
              onSaveConfig={handleUpdateConfig}
              registeredTeams={registeredTeams}
              onResetTeams={handleResetTeams}
            />
          )}

          {activeTab === 'roster' && (
            <SlotRosterTable
              teams={registeredTeams}
              config={config}
              onKickTeam={handleKickTeam}
              onClearAll={handleResetTeams}
              onRefreshTeams={refreshTeams}
            />
          )}
        </div>
      </main>

      <RoomIdpModal
        isOpen={isIdpModalOpen}
        onClose={() => setIsIdpModalOpen(false)}
        config={config}
        confirmedTeams={confirmedTeams}
        onDispatch={handleRoomDispatch}
        lastDispatch={roomDispatch}
      />

      <footer className="mt-auto border-t border-white/[0.06] bg-black/80 backdrop-blur-md py-7 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-none flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/45">
          <div className="flex items-center gap-3">
            <img
              src="/assets/glacier-cup-logo.png"
              alt=""
              className="w-6 h-6 rounded-lg object-cover border border-white/10"
              referrerPolicy="no-referrer"
            />
            <span className="font-display font-bold text-white/85 tracking-tight">
              FFA | Glacier Cup Manager™
            </span>
          </div>
          <div className="flex items-center gap-2 text-white/50">
            <ShieldCheck className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>Tag-Basis Discord Tournament Registration Bot &amp; Scrims Manager</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

