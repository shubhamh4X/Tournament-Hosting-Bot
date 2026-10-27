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
import { KeyRound, Radio } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'live-bot' | 'config' | 'roster'>('live-bot');
  const [isIdpModalOpen, setIsIdpModalOpen] = useState<boolean>(false);
  const [isBotOnline, setIsBotOnline] = useState<boolean>(false);
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

  const handleRegisterTeam = (team: TeamRegistration) => {
    setRegisteredTeams(prev => [...prev, team]);
    fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamName: team.teamName,
        captain: team.captain,
        players: team.players,
        messageId: team.messageId,
        channelId: team.channelId
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          refreshTeams();
        }
      })
      .catch(() => {});
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

  const handleDeleteSlot = (slotNumber: number) => {
    fetch('/api/bot/delete-slot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: slotNumber })
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

  const handleDeleteTournament = (deleteChannels: boolean = true) => {
    setRegisteredTeams([]);
    setRoomDispatch(null);
    setConfig(prev => ({
      ...prev,
      title: '',
      totalSlots: 0,
      categoryName: '',
      status: 'closed'
    }));

    fetch('/api/bot/delete-tournament', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteChannels })
    }).catch(() => {});
  };

  const handleRoomDispatch = (creds: RoomCredentials) => {
    setRoomDispatch(creds);
    fetch('/api/idp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds)
    }).catch(() => {});
  };

  const handleSwapSlots = (slot1: number, slot2: number) => {
    fetch('/api/teams/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot1, slot2 })
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

  const confirmedTeams = registeredTeams.filter(t => !t.isWaitlist);
  const dotColor =
    gatewayState === 'connected'
      ? 'bg-[#31D69A]'
      : gatewayState === 'partially_operational'
      ? 'bg-[#F0B75A]'
      : gatewayState === 'reconnecting'
      ? 'bg-[#6685FF] animate-pulse'
      : 'bg-[#707A89]';
  const radioColor =
    gatewayState === 'connected'
      ? 'text-[#31D69A]'
      : gatewayState === 'partially_operational'
      ? 'text-[#F0B75A]'
      : gatewayState === 'reconnecting'
      ? 'text-[#6685FF]'
      : 'text-[#707A89]';

  return (
    <div className="min-h-screen bg-[#0A0B0E] text-[#F3F5F9] flex flex-col font-sans selection:bg-[#6685FF]/30">
      <header className="bg-[#101217] border-b border-[#292F3A] sticky top-0 z-40 shrink-0">
        <div className="max-w-[1440px] w-full mx-auto h-14 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <img
              src="/assets/glacier-cup-logo.png"
              alt="FFA | Glacier Cup Manager™"
              className="w-8 h-8 rounded-md object-cover border border-[#292F3A] bg-[#14171D]"
              referrerPolicy="no-referrer"
            />
            <span className="font-display text-sm sm:text-[15px] font-semibold tracking-tight text-[#F3F5F9]">
              FFA | Glacier Cup Manager™
            </span>
          </div>

          <nav className="hidden md:flex items-center h-full gap-6 text-[13px] font-medium">
            <button
              onClick={() => setActiveTab('live-bot')}
              className={`h-full flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-hidden ${
                activeTab === 'live-bot'
                  ? 'border-[#6685FF] text-[#F3F5F9] font-semibold'
                  : 'border-transparent text-[#929BAA] hover:text-[#F3F5F9]'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${radioColor}`} />
              <span>Live Discord Bot</span>
              {isBotOnline && (
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              )}
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={`h-full flex items-center border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-hidden ${
                activeTab === 'config'
                  ? 'border-[#6685FF] text-[#F3F5F9] font-semibold'
                  : 'border-transparent text-[#929BAA] hover:text-[#F3F5F9]'
              }`}
            >
              Tournament Rules
            </button>

            <button
              onClick={() => setActiveTab('roster')}
              className={`h-full flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-hidden ${
                activeTab === 'roster'
                  ? 'border-[#6685FF] text-[#F3F5F9] font-semibold'
                  : 'border-transparent text-[#929BAA] hover:text-[#F3F5F9]'
              }`}
            >
              <span>Slot Roster</span>
              <span className="font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded bg-[#191D25] border border-[#292F3A] text-[#A7C7FF]">
                {confirmedTeams.length}/{config.totalSlots}
              </span>
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setIsIdpModalOpen(true)}
              className="h-9 px-3.5 text-xs font-semibold text-[#F3F5F9] bg-[#6685FF] hover:bg-[#5473EE] rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6685FF]"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Publish Room ID & Pass</span>
            </button>
          </div>
        </div>

        <div className="flex md:hidden items-center justify-between gap-1 bg-[#101217] border-t border-[#292F3A] px-3 py-1.5 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab('live-bot')}
            className={`px-2.5 py-1.5 rounded-md whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
              activeTab === 'live-bot'
                ? 'bg-[#191D25] text-[#F3F5F9] border border-[#292F3A] font-semibold'
                : 'text-[#929BAA] hover:text-[#F3F5F9]'
            }`}
          >
            <span>Live Bot</span>
            {isBotOnline && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-2.5 py-1.5 rounded-md whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'config'
                ? 'bg-[#191D25] text-[#F3F5F9] border border-[#292F3A] font-semibold'
                : 'text-[#929BAA] hover:text-[#F3F5F9]'
            }`}
          >
            Rules
          </button>
          <button
            onClick={() => setActiveTab('roster')}
            className={`px-2.5 py-1.5 rounded-md whitespace-nowrap shrink-0 font-mono tabular-nums transition-colors ${
              activeTab === 'roster'
                ? 'bg-[#191D25] text-[#F3F5F9] border border-[#292F3A] font-semibold'
                : 'text-[#929BAA] hover:text-[#F3F5F9]'
            }`}
          >
            Slots ({confirmedTeams.length}/{config.totalSlots})
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
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
      </main>

      <RoomIdpModal
        isOpen={isIdpModalOpen}
        onClose={() => setIsIdpModalOpen(false)}
        config={config}
        confirmedTeams={confirmedTeams}
        onDispatch={handleRoomDispatch}
        lastDispatch={roomDispatch}
      />

      <footer className="mt-auto border-t border-[#292F3A] bg-[#101217] py-4 px-6">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#707A89]">
          <span className="font-medium text-[#929BAA]">FFA | Glacier Cup Manager™</span>
          <span>Tag-Basis Discord Tournament Registration Bot & Scrims Manager</span>
        </div>
      </footer>
    </div>
  );
}
