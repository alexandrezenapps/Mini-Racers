/**
 * Fast Racers - Local Storage Session Leaderboard Manager
 * Tracks the top 5 fastest lap times achieved during the current session.
 */

const STORAGE_KEY = 'fast_racers_session_leaderboard_v1';
const SESSION_ID_KEY = 'fast_racers_session_id';

function formatLapTime(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '--:--.--';
  const totalCentis = Math.max(0, Math.floor(seconds * 100));
  const mins = Math.floor(totalCentis / 6000);
  const secs = Math.floor((totalCentis % 6000) / 100);
  const centis = totalCentis % 100;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch (_e) {
    return 'session_' + Date.now().toString(36);
  }
}

class LeaderboardManager {
  constructor() {
    this.sessionId = getOrCreateSessionId();
    this.listeners = new Set();
    this.state = this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          // If stored session matches current session, return it
          if (parsed.sessionId === this.sessionId && Array.isArray(parsed.laps)) {
            return parsed;
          }
          // If from an older session, keep a reference or reset for current session
          if (Array.isArray(parsed.laps)) {
            // Check if there are laps for this session inside a multi-session structure
            if (parsed.sessions && parsed.sessions[this.sessionId]) {
              return parsed.sessions[this.sessionId];
            }
          }
        }
      }
    } catch (e) {
      console.warn('LeaderboardManager: Failed to read from localStorage', e);
    }

    // Default fresh session state
    const fresh = {
      sessionId: this.sessionId,
      sessionStartedAt: Date.now(),
      laps: [],
      totalLapsCompleted: 0,
    };
    this.saveToStorage(fresh);
    return fresh;
  }

  saveToStorage(dataToSave) {
    const toSave = dataToSave || this.state;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn('LeaderboardManager: Failed to save to localStorage', e);
    }
  }

  /**
   * Returns top 5 fastest lap times for the current session sorted ascending.
   */
  getTop5Laps() {
    if (!this.state || !Array.isArray(this.state.laps)) return [];
    const sorted = [...this.state.laps].sort((a, b) => a.lapTime - b.lapTime);
    return sorted.slice(0, 5);
  }

  /**
   * Returns all laps recorded in the current session.
   */
  getAllSessionLaps() {
    if (!this.state || !Array.isArray(this.state.laps)) return [];
    return [...this.state.laps];
  }

  /**
   * Returns session stats: best lap, avg lap, total laps, and top 5.
   */
  getSessionStats() {
    const laps = this.getAllSessionLaps();
    const top5 = this.getTop5Laps();
    const totalLaps = this.state ? this.state.totalLapsCompleted || laps.length : 0;
    const bestLapTime = top5.length > 0 ? top5[0].lapTime : null;

    let avgLapTime = null;
    if (laps.length > 0) {
      const sum = laps.reduce((acc, l) => acc + l.lapTime, 0);
      avgLapTime = sum / laps.length;
    }

    return {
      sessionId: this.sessionId,
      totalLaps,
      bestLapTime,
      formattedBestLap: formatLapTime(bestLapTime),
      avgLapTime,
      formattedAvgLap: formatLapTime(avgLapTime),
      top5,
    };
  }

  /**
   * Records a completed lap time in seconds.
   * @param {number} lapTimeSeconds - Lap time duration in seconds
   * @param {number} lapNumber - Completed lap number (1, 2, 3...)
   * @param {boolean} isAutopilot - Whether auto-pilot was on
   * @returns {object} { isNewSessionBest, rank, lap, top5 }
   */
  recordLap(lapTimeSeconds, lapNumber = 1, isAutopilot = false) {
    if (typeof lapTimeSeconds !== 'number' || isNaN(lapTimeSeconds) || lapTimeSeconds <= 0) {
      return { isNewSessionBest: false, rank: -1, lap: null, top5: this.getTop5Laps() };
    }

    const previousTop5 = this.getTop5Laps();
    const previousBest = previousTop5.length > 0 ? previousTop5[0].lapTime : Infinity;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const newLapEntry = {
      id: 'lap_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      lapTime: parseFloat(lapTimeSeconds.toFixed(3)),
      formattedTime: formatLapTime(lapTimeSeconds),
      lapNumber: lapNumber || 1,
      isAutopilot: !!isAutopilot,
      timestamp: now.getTime(),
      timeStr,
    };

    if (!Array.isArray(this.state.laps)) {
      this.state.laps = [];
    }

    this.state.laps.push(newLapEntry);
    this.state.totalLapsCompleted = (this.state.totalLapsCompleted || 0) + 1;

    // Check rank within top 5
    const updatedTop5 = this.getTop5Laps();
    const rankIndex = updatedTop5.findIndex((l) => l.id === newLapEntry.id);
    const rank = rankIndex >= 0 ? rankIndex + 1 : -1;
    const isNewSessionBest = rank === 1 && lapTimeSeconds < previousBest;

    this.saveToStorage();
    this.notifyListeners({
      event: 'lapRecorded',
      lap: newLapEntry,
      rank,
      isNewSessionBest,
      top5: updatedTop5,
    });

    return {
      isNewSessionBest,
      rank,
      lap: newLapEntry,
      top5: updatedTop5,
    };
  }

  /**
   * Resets / clears all recorded laps for the current session in localStorage.
   */
  clearSessionLeaderboard() {
    this.state = {
      sessionId: this.sessionId,
      sessionStartedAt: Date.now(),
      laps: [],
      totalLapsCompleted: 0,
    };
    this.saveToStorage();
    this.notifyListeners({
      event: 'cleared',
      top5: [],
    });
  }

  subscribe(callback) {
    if (typeof callback === 'function') {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }
    return () => {};
  }

  notifyListeners(data) {
    this.listeners.forEach((cb) => {
      try {
        cb(data, this.getSessionStats());
      } catch (e) {
        console.error('LeaderboardManager listener error:', e);
      }
    });
  }
}

export const leaderboardManager = new LeaderboardManager();
export { formatLapTime };
