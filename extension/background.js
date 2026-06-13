let currentObjectiveKeywords = [];
let currentObjectiveCoreKeywords = [];
let activeSessionActive = false;
let isBreathingSequenceActive = false;
let engine = null;
const WEBSITE_URL = "https://brainsync.sub-sync.ca";

// FOCUS_BANDS - keep in sync with popup.js and content.js
const FOCUS_BANDS = [
  {
    min: 85, max: 100,
    label: "Deep Focus",
    sublabel: "You're in the zone.",
    color: "#52d9a0",
    glowColor: "rgba(82, 217, 160, 0.3)",
    ringColor: "#52d9a0",
    dotClass: "focus-deep"
  },
  {
    min: 65, max: 84,
    label: "On Track",
    sublabel: "Staying focused.",
    color: "#FFD700",
    glowColor: "rgba(255, 215, 0, 0.3)",
    ringColor: "#FFD700",
    dotClass: "focus-good"
  },
  {
    min: 45, max: 64,
    label: "Drifting",
    sublabel: "Pull back to your task.",
    color: "#ffb347",
    glowColor: "rgba(255, 179, 71, 0.3)",
    ringColor: "#ffb347",
    dotClass: "focus-drift"
  },
  {
    min: 20, max: 44,
    label: "Losing Focus",
    sublabel: "Refocus now.",
    color: "#ff7043",
    glowColor: "rgba(255, 112, 67, 0.35)",
    ringColor: "#ff7043",
    dotClass: "focus-low"
  },
  {
    min: 0, max: 19,
    label: "Distracted",
    sublabel: "Breathe and return.",
    color: "#ff4d4d",
    glowColor: "rgba(255, 77, 77, 0.4)",
    ringColor: "#ff4d4d",
    dotClass: "focus-critical"
  }
];

function getFocusBand(score) {
  return FOCUS_BANDS.find(b => score >= b.min && score <= b.max) || FOCUS_BANDS[4];
}

const BAD_DOMAINS = [
  "youtube.com", "facebook.com", "instagram.com", "reddit.com", "netflix.com",
  "tiktok.com", "twitter.com", "x.com", "pinterest.com", "twitch.tv",
  "spotify.com", "roblox.com", "linkedin.com", "discord.com", "snapchat.com",
  "tumblr.com", "9gag.com", "imgur.com", "buzzfeed.com", "dailymail.co.uk",
  "tmz.com", "bleacherreport.com", "espn.com"
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "if", "in", "is",
  "it", "of", "on", "or", "the", "to", "was", "will", "with", "from", "your",
  "have", "complete", "finish", "start", "doing", "some", "work", "session",
  "learn", "read", "study", "research", "find", "make", "take", "look", "what",
  "where", "when", "why", "who", "like", "just", "into", "over", "only",
  "also", "using", "through", "between", "because", "should", "could", "would",
  "their", "there", "these", "those", "which", "while", "after", "before",
  "during", "without", "within", "under", "above", "below", "around", "against",
  "across", "along", "behind", "beside", "until", "since", "about", "although",
  "except", "inside", "outside", "toward", "towards", "throughout", "upon",
  "whether", "www", "com", "org", "net", "html", "https", "http", "page"
]);

const TITLE_SUFFIXES = [
  " - Google Search", " | Wikipedia", " - Wikipedia", " - YouTube",
  " | YouTube", " - Google Docs", " - Google Drive", " | LinkedIn",
  " | Reddit", " - Stack Overflow"
];

function stemLite(word) {
  let token = String(word || "").toLowerCase();
  if (token.length > 6 && token.endsWith("ing")) token = token.slice(0, -3);
  else if (token.length > 5 && token.endsWith("ed")) token = token.slice(0, -2);
  else if (token.length > 5 && token.endsWith("ly")) token = token.slice(0, -2);
  else if (token.length > 5 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us")) token = token.slice(0, -1);
  return token;
}

function extractKeywords(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/\W+/)
    .map(stemLite)
    .filter(w => w.length > 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

async function fetchSemanticKeywords(objective) {
  const words = extractKeywords(objective);
  try {
    const res = await fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(objective)}&max=12`);
    if (res.ok) {
      const data = await res.json();
      const related = data
        .filter(item => Number(item.score || 0) > 0)
        .slice(0, 8)
        .flatMap(item => extractKeywords(item.word));
      return [...new Set([...words, ...related])];
    }
  } catch (e) {
    // Semantic enrichment is optional; extension scoring must work offline.
  }
  return words;
}

function stripTitleSuffix(title) {
  let clean = String(title || "");
  for (const suffix of TITLE_SUFFIXES) {
    if (clean.endsWith(suffix)) clean = clean.slice(0, -suffix.length);
  }
  return clean;
}

function isWordMatch(a, b) {
  const left = stemLite(a);
  const right = stemLite(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length > 4 && right.length > 4 && (left.includes(right) || right.includes(left))) return true;
  return false;
}

function meaningfulUrlParts(url) {
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname
      .replace(/^www\./, "")
      .split(/[.\-_]+/)
      .map(stemLite)
      .filter(part => part.length > 2 && !STOP_WORDS.has(part));
    const pathParts = decodeURIComponent(parsed.pathname || "")
      .split(/[\/\-_+%.\s]+/)
      .map(stemLite)
      .filter(part => part.length > 3 && !STOP_WORDS.has(part) && !/^\d+$/.test(part));
    return { hostname: parsed.hostname, hostParts, pathParts };
  } catch (e) {
    return { hostname: "", hostParts: [], pathParts: [] };
  }
}

function scoreWordParts(parts, keywords) {
  const matched = new Set();
  for (const part of parts) {
    for (const keyword of keywords) {
      if (isWordMatch(part, keyword)) matched.add(keyword);
    }
  }
  return matched;
}

function scoreUrl(url, keywords) {
  if (!keywords.length) return 0;
  const { hostParts, pathParts } = meaningfulUrlParts(url);
  const hostMatches = scoreWordParts(hostParts, keywords);
  const pathMatches = scoreWordParts(pathParts, keywords);
  const allMatches = new Set([...hostMatches, ...pathMatches]);
  let score = 0;
  score += Math.min(0.35, hostMatches.size * 0.18);
  score += Math.min(0.55, pathMatches.size * 0.28);
  if (pathMatches.size > 0) score += 0.15;
  if (allMatches.size >= 2) score += 0.15;
  return Math.min(1, score);
}

function scoreTitle(title, keywords) {
  if (!keywords.length) return 0;
  const titleKeywords = extractKeywords(stripTitleSuffix(title));
  const matches = scoreWordParts(titleKeywords, keywords);
  if (matches.size >= 3) return 1;
  return Math.min(1, matches.size / Math.min(3, keywords.length));
}

function isHighDopamineUrl(url) {
  try {
    const { hostname } = new URL(url);
    return BAD_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch (e) {
    return false;
  }
}

class FocusEngine {
  constructor(session) {
    this.session = session;
    // FIX: use session.startTime which is now always set by popup.js
    this.sessionStartTime = session.startTime || Date.now();
    this.active = true;

    this.actualFocus = 100;
    this.displayedFocus = 100;
    this.maxPossibleFocus = 100;
    this.actualRisk = 0;
    this.displayedRisk = 0;

    this.focusStreakTime = 0;
    this.peekCount = 0;
    this.recentBadEvents = 0;
    this.nearDistractions = 0;
    this.recoveryAttempts = 0;
    this.longestStreak = 0;
    this.maxRiskReached = 0;
    this.mostDistractingTimeElapsed = 0;
    this.focusSamples = [];
    // FIX: track sample count continuously, take first sample immediately after a short delay
    this.lastSampleTime = Date.now();
    this.sampleInterval = 20000; // sample every 20s instead of 30s to get more data points

    this.reward30 = false;
    this.reward60 = false;
    this.reward120 = false;
    this.wasHighRisk = false;
    this.resetApplied = false;
    this.currentTabType = "pending";

    this.lastTickTime = Date.now();
    this.lastTabSwitchTime = Date.now();

    // FIX: Write initial focus=100 to storage immediately so popup reflects engine state
    this.syncStorage();

    this.intervalId = setInterval(() => this.tick(), 2000);

    // FIX: Take an initial sample after 10s so even short sessions have data
    setTimeout(() => {
      if (this.active && this.focusSamples.length === 0) {
        this.focusSamples.push(Math.round(this.actualFocus));
        this.lastSampleTime = Date.now();
      }
    }, 10000);
  }

  stop() {
    this.active = false;
    clearInterval(this.intervalId);
  }

  lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
  }

  syncStorage() {
    chrome.storage.local.set({
      brainsyncFocusLevel: Math.max(0, Math.min(100, this.displayedFocus)),
      brainsyncDistractionRisk: this.displayedRisk,
      brainsyncCurrentTabType: this.currentTabType
    });
  }

  applyReward(points) {
    this.actualFocus = Math.min(this.maxPossibleFocus, this.actualFocus + points);
  }

  applyPenalty(points) {
    const momentum = Math.min(2.0, 1 + this.recentBadEvents * 0.2);
    const timeFactor = this.lerp(0.9, 1.3, Math.min(1, (Date.now() - this.sessionStartTime) / (60 * 60 * 1000)));
    const finalDrop = points * momentum * timeFactor;
    this.actualFocus = Math.max(0, this.actualFocus - finalDrop);

    if (finalDrop >= 8) {
      this.displayedFocus = this.actualFocus;
      this.syncStorage();
    }
  }

  addRisk(amount) {
    const finalAmt = amount * Math.min(2.0, 1 + this.recentBadEvents * 0.2);
    this.actualRisk = Math.min(100, this.actualRisk + finalAmt);

    if (this.actualRisk > this.maxRiskReached) {
      this.maxRiskReached = this.actualRisk;
      this.mostDistractingTimeElapsed = Date.now() - this.sessionStartTime;
    }

    if (this.actualRisk > 70 && !this.wasHighRisk) {
      this.nearDistractions++;
      this.wasHighRisk = true;
    }

    this.recentBadEvents++;
    setTimeout(() => {
      if (this.recentBadEvents > 0) this.recentBadEvents--;
    }, 60000);
  }

  decayRisk(deltaTime) {
    if (this.wasHighRisk && this.actualRisk < 40) {
      this.recoveryAttempts++;
      this.wasHighRisk = false;
    }

    let decayRate = this.currentTabType === "relevant" ? 1.2 : 0.6;
    if (this.focusStreakTime > 120000) decayRate *= 1.5;
    this.actualRisk = Math.max(0, this.actualRisk - (decayRate * (deltaTime / 1000)));

    if (this.focusStreakTime > 180000) {
      if (!this.resetApplied) {
        this.actualRisk *= 0.5;
        this.resetApplied = true;
      }
    } else {
      this.resetApplied = false;
    }
    this.displayedRisk = this.lerp(this.displayedRisk, this.actualRisk, 0.2);
  }

  tick() {
    if (!this.active) return;
    const now = Date.now();
    const deltaTime = now - this.lastTickTime;
    const dt = deltaTime / 1000;
    this.lastTickTime = now;

    if (this.currentTabType === "relevant") {
      this.focusStreakTime += deltaTime;
      this.longestStreak = Math.max(this.longestStreak, this.focusStreakTime);
      this.applyReward(0.4 * dt);
      if (this.focusStreakTime > 30000 && !this.reward30) { this.applyReward(2); this.reward30 = true; }
      if (this.focusStreakTime > 120000 && !this.reward60) { this.applyReward(5); this.reward60 = true; }
      if (this.focusStreakTime > 300000 && !this.reward120) { this.applyReward(10); this.reward120 = true; }
    } else if (this.currentTabType === "irrelevant") {
      this.applyPenalty(0.25 * dt);
      this.addRisk(0.3 * dt);
      this.focusStreakTime = 0;
    } else if (this.currentTabType === "high_distraction") {
      this.applyPenalty(1.0 * dt);
      this.addRisk(1.5 * dt);
      this.focusStreakTime = 0;
    } else {
      // "pending" - slight penalty for unknown state
      this.applyPenalty(0.05 * dt);
      this.focusStreakTime = 0;
    }

    const sessionElapsed = Date.now() - this.sessionStartTime;
    const sessionTotal = this.session.endTime - this.sessionStartTime;
    const progress = sessionTotal > 0 ? sessionElapsed / sessionTotal : 0;
    if (progress > 0.8 && this.currentTabType !== "relevant") {
      this.applyPenalty(0.2 * dt);
    }

    this.decayRisk(deltaTime);

    this.displayedFocus = this.lerp(this.displayedFocus, this.actualFocus, 0.15);
    this.displayedFocus = Math.max(0, Math.min(100, this.displayedFocus));

    if (this.actualFocus < 20 && this.session && !this.session.hasBreathed) {
      triggerBreathingExercise(this.session);
    }

    // FIX: Sample more frequently (every 20s) so short sessions have real data
    if (now - this.lastSampleTime >= this.sampleInterval) {
      this.focusSamples.push(Math.round(this.actualFocus));
      this.lastSampleTime = now;
    }

    this.syncStorage();
  }

  onTabSwitch(tab, isCompleteUpdate = false) {
    if (!this.active) return;
    const now = Date.now();
    const timeOnTab = now - this.lastTabSwitchTime;
    const wasQuickSwitch = timeOnTab < 5000 && !isCompleteUpdate;

    if (!isCompleteUpdate) {
      this.lastTabSwitchTime = now;
      this.focusStreakTime = 0;
      this.reward30 = false;
      this.reward60 = false;
      this.reward120 = false;
      this.currentTabType = "pending";
      this.syncStorage();
    }

    if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      this.applyClassification({ wasQuickSwitch, isHighDopamine: false, urlScore: 0, titleScore: 0, bodyScore: 0 });
      return;
    }

    const keywords = currentObjectiveCoreKeywords.length ? currentObjectiveCoreKeywords : currentObjectiveKeywords;
    const isHighDopamine = isHighDopamineUrl(tab.url);
    const urlScore = scoreUrl(tab.url, keywords);
    const titleScore = scoreTitle(tab.title || "", keywords);

    if (!currentObjectiveKeywords.length) {
      this.applyClassification({ wasQuickSwitch, isHighDopamine, urlScore, titleScore, bodyScore: 0 });
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      action: "scan_keywords",
      keywords: currentObjectiveKeywords
    }, (response) => {
      const bodyScore = chrome.runtime.lastError ? 0 : Math.max(0, Math.min(1, Number(response?.confidence || 0)));
      this.applyClassification({ wasQuickSwitch, isHighDopamine, urlScore, titleScore, bodyScore });
    });
  }

  applyClassification({ wasQuickSwitch, isHighDopamine, urlScore, titleScore, bodyScore }) {
    const totalScore = (urlScore * 0.4) + (titleScore * 0.35) + (bodyScore * 0.25);
    let type = "irrelevant";
    let conf = Math.max(0.2, Math.min(1, totalScore));

    if (isHighDopamine) {
      type = "high_distraction";
      conf = 1;
    } else if (totalScore >= 0.35) {
      type = "relevant";
      conf = Math.max(0.5, totalScore);
    } else {
      type = "irrelevant";
      conf = Math.max(0.2, totalScore);
    }

    if (wasQuickSwitch) {
      this.peekCount++;
      this.applyPenalty(0.5);
      this.addRisk(2);
    }

    switch (type) {
      case "relevant":
        break;
      case "irrelevant":
        this.applyPenalty(1.0 * conf);
        this.addRisk(3 * conf);
        break;
      case "high_distraction":
        this.applyPenalty(8.0 * conf);
        this.addRisk(12 * conf);
        this.maxPossibleFocus = Math.max(70, this.maxPossibleFocus - 4);
        break;
    }

    this.currentTabType = type;
    chrome.storage.local.set({ brainsyncCurrentTabType: type });
    this.syncStorage();
  }

  getEfficiency() {
    // FIX: Always push a final sample right now before computing efficiency
    // This ensures even very short sessions or sessions where service worker
    // had few ticks still produce a real score based on actualFocus.
    const finalActual = Math.round(this.actualFocus);
    this.focusSamples.push(finalActual);

    let finalScore;
    if (this.focusSamples.length >= 1) {
      const sum = this.focusSamples.reduce((a, b) => a + b, 0);
      finalScore = Math.round(sum / this.focusSamples.length);
    } else {
      finalScore = finalActual;
    }

    // Cap at maxPossibleFocus
    finalScore = Math.min(this.maxPossibleFocus, finalScore);

    // Small bonus for completing without needing breathing exercise
    if (!this.session.hasBreathed) {
      finalScore = Math.min(100, finalScore + 3);
    }

    // Clamp to valid range
    finalScore = Math.max(0, Math.min(100, finalScore));

    const band = getFocusBand(finalScore);

    return {
      focusEfficiency: finalScore,
      focusBandLabel: band.label,
      nearDistractions: this.nearDistractions,
      recoveryAttempts: this.recoveryAttempts,
      longestStreak: Math.round(this.longestStreak / 1000),
      totalTabSwitches: this.peekCount,
      mostDistractingTimeElapsedMs: this.mostDistractingTimeElapsed,
      maxPossibleFocus: Math.round(this.maxPossibleFocus),
      sampleCount: this.focusSamples.length
    };
  }
}

chrome.tabs.onActivated.addListener(activeInfo => {
  if (!activeSessionActive || !engine) return;
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    engine.onTabSwitch(tab, false);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!activeSessionActive || !engine) return;
  if (changeInfo.status === "complete") {
    engine.onTabSwitch(tab, true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.brainsyncActiveSession) {
    const s = changes.brainsyncActiveSession.newValue;
    if (s && s.isActive) {
      if (!activeSessionActive) {
        activeSessionActive = true;
        const objective = s.objective || s.intent || "";
        currentObjectiveCoreKeywords = extractKeywords(objective);
        currentObjectiveKeywords = currentObjectiveCoreKeywords;
        fetchSemanticKeywords(objective).then(kw => {
          currentObjectiveKeywords = kw;
        });

        if (engine) engine.stop();
        engine = new FocusEngine(s);

        // FIX: Immediately classify the active tab so we don't start in "pending" limbo
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0]) engine.onTabSwitch(tabs[0], true);
        });

        chrome.alarms.create("sessionEnd", { when: s.endTime });
      } else {
        if (!s.isPaused) {
          chrome.alarms.create("sessionEnd", { when: s.endTime });
          if (engine) engine.session = s;
        } else {
          chrome.alarms.clear("sessionEnd");
          if (engine) engine.session = s;
        }
      }
    } else {
      activeSessionActive = false;
      chrome.alarms.clear("sessionEnd");
      if (engine) {
        engine.stop();
        engine = null;
      }
      isBreathingSequenceActive = false;
      chrome.storage.local.set({
        brainsyncBreathing: { isActive: false },
        brainsyncCurrentTabType: "neutral"
      });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("chrome-extension://")) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        }).catch(() => { });
        chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content.css"]
        }).catch(() => { });
      }
    }
  });
});

async function playAudioOffscreen(settings) {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play focus session completion alarm'
    });
  }

  chrome.runtime.sendMessage({
    action: "play_offscreen_audio",
    soundType: settings.alarmSound || "chime",
    volume: settings.alarmVolume || 0.45
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sessionEnd") {
    const data = await chrome.storage.local.get(["brainsyncActiveSession", "brainsyncSettings", "brainsyncSessions", "brainsyncUser"]);
    if (!data.brainsyncActiveSession || !data.brainsyncActiveSession.isActive) return;

    const sessions = data.brainsyncSessions || [];
    const completedSession = {
      ...data.brainsyncActiveSession,
      completedAt: new Date().toISOString()
    };

    // FIX: Capture analytics BEFORE stopping the engine
    if (engine) {
      completedSession.analytics = engine.getEfficiency();
    } else {
      // Engine was lost (service worker restart) - use a fallback
      completedSession.analytics = {
        focusEfficiency: 0,
        focusBandLabel: "Unknown",
        nearDistractions: 0,
        recoveryAttempts: 0,
        longestStreak: 0,
        totalTabSwitches: 0,
        mostDistractingTimeElapsedMs: 0,
        maxPossibleFocus: 100,
        sampleCount: 0
      };
    }

    delete completedSession.isActive;
    sessions.push(completedSession);

    activeSessionActive = false;
    if (engine) {
      engine.stop();
      engine = null;
    }
    await chrome.storage.local.set({
      brainsyncSessions: sessions,
      brainsyncActiveSession: null,
      brainsyncCurrentTabType: "neutral"
    });

    if (data.brainsyncUser) {
      try {
        await fetch(`${WEBSITE_URL}/api/insights`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: data.brainsyncUser, session: completedSession })
        });
      } catch (e) {
        console.error("Failed to sync completed session to server", e);
      }
    }

    chrome.notifications.create({
      type: "basic",
      iconUrl: "logo.png",
      title: "BrainSync Timer Done",
      message: "Your focus session has finished! Complete your flow."
    });

    chrome.runtime.sendMessage({ action: "play_alarm" }).catch(() => { });
    playAudioOffscreen(data.brainsyncSettings || {});

    chrome.tabs.query({}, (tabs) => {
      let foundTab = false;
      for (const tab of tabs) {
        if (tab.url && (tab.url.startsWith(WEBSITE_URL) || tab.url.includes("127.0.0.1:3000"))) {
          chrome.tabs.update(tab.id, { url: `${WEBSITE_URL}/#insights`, active: true });
          foundTab = true;
          break;
        }
      }
      if (!foundTab) {
        chrome.tabs.create({ url: `${WEBSITE_URL}/#insights` });
      }
    });
  }
});

async function playDirectOffscreenSound(action, soundType) {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length === 0) {
    if (action === "stop_music") return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play focus session sounds'
    });
  }

  chrome.runtime.sendMessage({
    action: action,
    soundType: soundType,
    volume: 0.5
  }).catch(() => { });
}

async function triggerBreathingExercise(session) {
  const remainingMs = session.endTime - Date.now();
  if (remainingMs <= 0) return;

  chrome.alarms.clear("sessionEnd");

  session.isPaused = true;
  session.remainingMs = remainingMs;
  session.hasBreathed = true;

  if (engine) engine.session = session;

  await chrome.storage.local.set({
    brainsyncActiveSession: session,
    brainsyncBreathing: { isActive: true, state: "message_prompt" }
  });

  playDirectOffscreenSound("play_offscreen_audio", "buzz");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "start_breathing_sequence") {
    runBreathingSequence();
  }
});

async function runBreathingSequence() {
  if (isBreathingSequenceActive) return;
  isBreathingSequenceActive = true;

  await chrome.storage.local.set({ brainsyncBreathing: { isActive: true, state: "breathe_in" } });
  playDirectOffscreenSound("play_offscreen_audio", "calming_music");
  playDirectOffscreenSound("play_offscreen_audio", "breathe_in");

  let cycle = 0;
  const interval = setInterval(async () => {
    cycle++;
    if (cycle >= 4) {
      clearInterval(interval);
      playDirectOffscreenSound("stop_music");
      playDirectOffscreenSound("play_offscreen_audio", "resume_sound");

      const freshData = await chrome.storage.local.get(["brainsyncActiveSession"]);
      if (freshData.brainsyncActiveSession && freshData.brainsyncActiveSession.isActive) {
        const activeData = freshData.brainsyncActiveSession;
        activeData.isPaused = false;
        activeData.endTime = Date.now() + activeData.remainingMs;
        delete activeData.remainingMs;

        if (engine) engine.session = activeData;

        await chrome.storage.local.set({
          brainsyncActiveSession: activeData,
          brainsyncBreathing: { isActive: false }
        });
      } else {
        await chrome.storage.local.set({ brainsyncBreathing: { isActive: false } });
      }
      isBreathingSequenceActive = false;
    } else {
      if (cycle % 2 === 1) {
        await chrome.storage.local.set({ brainsyncBreathing: { isActive: true, state: "breathe_out" } });
        playDirectOffscreenSound("play_offscreen_audio", "breathe_out");
      } else {
        await chrome.storage.local.set({ brainsyncBreathing: { isActive: true, state: "breathe_in" } });
        playDirectOffscreenSound("play_offscreen_audio", "breathe_in");
      }
    }
  }, 6250);
}