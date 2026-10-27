import React, { useState } from 'react';
import { RoomCredentials, TournamentConfig, TeamRegistration } from '../types/tournament';
import { KeyRound, Send, CheckCircle2, X } from 'lucide-react';

interface RoomIdpModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TournamentConfig;
  confirmedTeams: TeamRegistration[];
  onDispatch: (creds: RoomCredentials) => void;
  lastDispatch: RoomCredentials | null;
}

export const RoomIdpModal: React.FC<RoomIdpModalProps> = ({
  isOpen,
  onClose,
  confirmedTeams,
  onDispatch,
  lastDispatch
}) => {
  const [roomId, setRoomId] = useState<string>(lastDispatch?.roomId || '8492019');
  const [roomPass, setRoomPass] = useState<string>(lastDispatch?.roomPass || 'scrims99');
  const [mapName, setMapName] = useState<string>(lastDispatch?.mapName || 'Main Lobby');
  const [matchTime, setMatchTime] = useState<string>(lastDispatch?.matchTime || '08:00 PM IST');
  const [serverType, setServerType] = useState<string>(lastDispatch?.serverType || 'Custom Room #1');
  const [dispatched, setDispatched] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onDispatch({
      roomId: roomId.trim(),
      roomPass: roomPass.trim(),
      mapName: mapName.trim(),
      matchTime: matchTime.trim(),
      serverType: serverType.trim(),
      sentAt: new Date().toISOString()
    });
    setDispatched(true);
    setTimeout(() => {
      setDispatched(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl">
      <div className="relative w-full max-w-lg rounded-[28px] bg-[#080A0F]/95 border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.85)] p-7 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 text-[#38BDF8] flex items-center justify-center">
              <KeyRound className="w-4.5 h-4.5 text-[#38BDF8]" />
            </div>
            <div>
              <div className="eyebrow-label mb-0.5">
                Lobby Credentials
              </div>
              <h3 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
                Dispatch Match Room ID &amp; Password
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-2 rounded-xl hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-white/55 leading-relaxed">
          Executes the <code className="text-[#38BDF8] font-mono bg-white/[0.04] border border-white/10 px-2 py-0.5 rounded-md">/idpass</code> command, publishing lobby credentials to <span className="text-white font-mono">#id-pass</span> and notifying confirmed slot holders.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Room ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                placeholder="e.g. 7839201"
                className="w-full h-11 px-3.5 rounded-xl esports-input font-mono text-sm placeholder-white/35"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Password
              </label>
              <input
                type="text"
                value={roomPass}
                onChange={e => setRoomPass(e.target.value)}
                placeholder="e.g. tourney99"
                className="w-full h-11 px-3.5 rounded-xl esports-input font-mono text-sm placeholder-white/35"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Map
              </label>
              <input
                type="text"
                value={mapName}
                onChange={e => setMapName(e.target.value)}
                placeholder="e.g. Map 1, Custom Lobby..."
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-2">
                Match Start Time
              </label>
              <input
                type="text"
                value={matchTime}
                onChange={e => setMatchTime(e.target.value)}
                placeholder="08:00 PM IST"
                className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/70 mb-2">
              Custom Lobby Label
            </label>
            <input
              type="text"
              value={serverType}
              onChange={e => setServerType(e.target.value)}
              placeholder="Custom Room #1 - Tier 1 Scrims"
              className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
            />
          </div>

          <div className="px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-xs text-white/60 flex items-center justify-between">
            <span>Recipients: Confirmed Teams</span>
            <span className="font-mono tabular-nums font-bold text-[#38BDF8]">
              {confirmedTeams.length} Captains
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.07]">
            <button
              type="button"
              onClick={onClose}
              className="btn-glacier-secondary h-10 px-5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={dispatched}
              className="btn-glacier-primary h-10 px-5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {dispatched ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Dispatched!</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Publish to #id-pass</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

