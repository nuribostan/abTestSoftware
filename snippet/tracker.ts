/**
 * AB Testing SDK - Enterprise Edition
 * File: ab-sdk-enterprise.ts
 *
 * Features:
 * - Cross-Subdomain Identity (Cookie + LocalStorage Sync)
 * - Session Management (New Session after 30m inactivity)
 * - Smart & Dynamic Anti-Flicker
 * - Advanced Targeting (Regex, Numeric logic)
 * - Fault-tolerant Storage (In-Memory fallback)
 * - SPA & History API Support
 * - Event Batching & Beacon Support
 */

// --------------------------- Types ---------------------------

type ExperimentType = "AA" | "AB" | "SPLIT_URL" | "MULTIVARIATE";
type GoalType =
  | "PAGE_VIEW"
  | "CLICK"
  | "FORM_SUBMIT"
  | "CUSTOM_EVENT"
  | "SCROLL"
  | "ELEMENT_VISIBILITY";
type OperatorType =
  | "IS"
  | "IS_NOT"
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "MATCHES_REGEX"
  | "GREATER_THAN"
  | "LESS_THAN";

type ChangeAction =
  | "setText"
  | "setHTML"
  | "setAttr"
  | "setStyle"
  | "addClass"
  | "removeClass"
  | "insertAdjacentHTML"
  | "replaceNode"
  | "runScript"
  | "moveNode";

interface ProjectConfig {
  projectId: string;
  experiments: ExperimentConfig[];
  goals: GoalConfig[];
  version?: number;
}

interface ExperimentConfig {
  id: string;
  status: "RUNNING" | "PAUSED";
  trafficAllocation: number; // 0-100
  urlPattern: string; // Regex
  audiences?: AudienceConfig[];
  variants: VariantConfig[];
}

interface VariantConfig {
  id: string;
  isControl?: boolean;
  trafficWeight: number;
  changes: ChangeInstruction[];
}

interface ChangeInstruction {
  selector: string;
  action: ChangeAction;
  value?: string;
  attributeName?: string;
  allowInnerHTML?: boolean;
  waitForSelector?: number; // ms
}

interface GoalConfig {
  id: string;
  type: GoalType;
  selector?: string;
  urlPattern?: string;
  eventName?: string;
}

interface AudienceConfig {
  type: string; // 'DEVICE', 'BROWSER', 'COOKIE', 'QUERY_PARAM', 'JS_VAR'
  key?: string; // e.g. cookie name or query param name
  operator: OperatorType;
  value?: string | number;
}

interface StoredAssignments {
  [experimentId: string]: {
    variantId: string;
    assignedAt: string;
  };
}

// --------------------------- Storage Engine (Fault Tolerant) ---------------------------

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = value;
  }
  removeItem(key: string) {
    delete this.store[key];
  }
}

class SafeStorage {
  private storage: Storage;
  private fallback: MemoryStorage;
  private isSupported: boolean;

  constructor(type: "localStorage" | "sessionStorage") {
    this.fallback = new MemoryStorage();
    try {
      this.storage = window[type];
      const x = "__ab_test__";
      this.storage.setItem(x, x);
      this.storage.removeItem(x);
      this.isSupported = true;
    } catch (e) {
      this.isSupported = false;
      // @ts-ignore
      this.storage = this.fallback;
    }
  }

  getItem(key: string) {
    try {
      return this.storage.getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }
  setItem(key: string, val: string) {
    try {
      this.storage.setItem(key, val);
    } catch {
      this.fallback.setItem(key, val);
    }
  }
  removeItem(key: string) {
    try {
      this.storage.removeItem(key);
    } catch {
      this.fallback.removeItem(key);
    }
  }
}

const LS = new SafeStorage("localStorage");
const SS = new SafeStorage("sessionStorage");

// --------------------------- Cookie Utils (Cross-Subdomain) ---------------------------

const CookieUtils = {
  set: (name: string, value: string, days: number) => {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = "; expires=" + date.toUTCString();
    }
    // Auto-detect top level domain (e.g. .site.com for blog.site.com)
    const host = window.location.hostname;
    const parts = host.split(".").reverse();
    let domain = host; // default

    // Simple heuristic: Try setting cookie on domain parts until successful
    if (parts.length >= 2) {
      // Try .domain.com
      const twoLevel = `.${parts[1]}.${parts[0]}`;
      document.cookie = `${name}=${value}${expires}; domain=${twoLevel}; path=/; SameSite=Lax`;
      if (document.cookie.indexOf(name + "=" + value) > -1) return;
    }
    // Fallback to current domain
    document.cookie = `${name}=${value}${expires}; path=/; SameSite=Lax`;
  },
  get: (name: string) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) == " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  },
};

// --------------------------- Utils ---------------------------

const STORAGE_KEYS = {
  VISITOR_ID: "ab_ent_vid",
  SESSION_ID: "ab_ent_sid",
  ASSIGNMENTS: "ab_ent_assignments",
  CONFIG_CACHE: "ab_ent_config",
  LAST_ACTIVITY: "ab_ent_last_active",
};

function generateUUID() {
  // @ts-ignore
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16)
  );
}

function safeJSONParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// --------------------------- SDK Core ---------------------------

interface InitOptions {
  projectId: string;
  ingestUrl: string;
  configUrl: string;
  debug?: boolean;
}

export class ABTrackerEnterprise {
  private projectId: string;
  private ingestUrl: string;
  private configUrl: string;
  private visitorId: string;
  private sessionId: string;
  private assignments: StoredAssignments;
  private config?: ProjectConfig;
  private eventQueue: any[] = [];
  private debug: boolean;
  private activeExperiments: Set<string> = new Set();

  constructor(opts: InitOptions) {
    this.projectId = opts.projectId;
    this.ingestUrl = opts.ingestUrl;
    this.configUrl = opts.configUrl;
    this.debug = !!opts.debug;

    // 1. Immediate Anti-Flicker (Blind)
    this.applyGlobalAntiFlicker();

    // 2. Identity & Session Resolution
    this.visitorId = this.resolveVisitorId();
    this.sessionId = this.resolveSessionId();
    this.assignments = safeJSONParse(LS.getItem(STORAGE_KEYS.ASSIGNMENTS), {});

    // 3. Init
    this.init().catch((err) => this.log("Init Error", err));

    // 4. Event Listeners
    this.setupSystemEvents();
  }

  // --- Identity & Session ---

  private resolveVisitorId(): string {
    // Priority: Cookie (Cross-subdomain) -> LocalStorage -> New
    let vid = CookieUtils.get(STORAGE_KEYS.VISITOR_ID);
    if (!vid) {
      vid = LS.getItem(STORAGE_KEYS.VISITOR_ID);
    }
    if (!vid) {
      vid = generateUUID();
    }
    // Sync both
    // @ts-ignore
    CookieUtils.set(STORAGE_KEYS.VISITOR_ID, vid, 365); // 1 year
    // @ts-ignore
    LS.setItem(STORAGE_KEYS.VISITOR_ID, vid);
    // @ts-ignore
    return vid;
  }

  private resolveSessionId(): string {
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 mins
    const now = Date.now();
    const lastActive = parseInt(LS.getItem(STORAGE_KEYS.LAST_ACTIVITY) || "0");
    let sid = SS.getItem(STORAGE_KEYS.SESSION_ID);

    // If no session or timeout expired, create new
    if (!sid || now - lastActive > SESSION_TIMEOUT_MS) {
      sid = generateUUID();
      // @ts-ignore
      SS.setItem(STORAGE_KEYS.SESSION_ID, sid);
      this.enqueueEvent("SESSION_START", { referrer: document.referrer });
    }

    LS.setItem(STORAGE_KEYS.LAST_ACTIVITY, now.toString());
    // @ts-ignore
    return sid;
  }

  private updateActivity() {
    LS.setItem(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
  }

  // --- Anti-Flicker ---

  private styleTagId = "ab-antiflicker-style";

  private applyGlobalAntiFlicker() {
    // Hide body immediately to be safe
    const css = `body { opacity: 0 !important; pointer-events: none !important; }`;
    const style = document.createElement("style");
    style.id = this.styleTagId;
    style.innerHTML = css;
    document.head.appendChild(style);

    // Failsafe: Show after 3s if JS crashes or network fails
    setTimeout(() => this.removeAntiFlicker(), 3000);
  }

  private updateAntiFlickerToSmart(experiments: ExperimentConfig[]) {
    // Optimize: Instead of hiding body, hide only affected selectors
    let selectors: string[] = [];

    experiments.forEach((exp) => {
      if (exp.status === "RUNNING") {
        exp.variants.forEach((v) => {
          v.changes.forEach((c) => selectors.push(c.selector));
        });
      }
    });

    if (selectors.length === 0) {
      this.removeAntiFlicker();
      return;
    }

    // Replace body hide with specific element hide
    const uniqueSelectors = [...new Set(selectors)].join(", ");
    const style = document.getElementById(this.styleTagId);
    if (style) {
      style.innerHTML = `${uniqueSelectors} { visibility: hidden !important; opacity: 0 !important; }`;
    }
  }

  private removeAntiFlicker() {
    const style = document.getElementById(this.styleTagId);
    if (style) style.remove();
  }

  // --- Initialization ---

  private async init() {
    // Check Cache first
    const cached = safeJSONParse<{ ts: number; data: ProjectConfig } | null>(
      LS.getItem(STORAGE_KEYS.CONFIG_CACHE),
      null
    );
    const CACHE_TTL = 60 * 1000; // 1 minute cache

    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      this.config = cached.data;
      this.log("Using Cached Config");
    } else {
      // Fetch fresh
      try {
        const res = await fetch(this.configUrl);
        if (!res.ok) throw new Error("Fetch failed");
        this.config = await res.json();
        LS.setItem(
          STORAGE_KEYS.CONFIG_CACHE,
          JSON.stringify({ ts: Date.now(), data: this.config })
        );
      } catch (e) {
        if (cached) this.config = cached.data; // Fallback to stale cache
        else throw e;
      }
    }

    if (!this.config) {
      this.removeAntiFlicker();
      return;
    }

    // Transition to smart flickering (reveal non-affected parts)
    this.updateAntiFlickerToSmart(this.config.experiments);

    this.processExperiments();
    this.setupGoals();

    // Finally reveal everything after changes applied
    // Use requestAnimationFrame to ensure DOM painted
    requestAnimationFrame(() => {
      setTimeout(() => this.removeAntiFlicker(), 50);
    });
  }

  // --- Experiment Logic ---

  private processExperiments() {
    if (!this.config) return;
    const url = window.location.href;
    const path = window.location.pathname;

    this.config.experiments.forEach((exp) => {
      if (exp.status !== "RUNNING") return;

      // URL Check
      const regex = new RegExp(exp.urlPattern);
      if (!regex.test(url) && !regex.test(path)) return;

      // Audience Check
      if (exp.audiences && !this.checkAudiences(exp.audiences)) return;

      // Traffic & Assignment
      let variantId = this.assignments[exp.id]?.variantId;

      if (!variantId) {
        // Check Traffic Allocation (is user eligible?)
        if (!this.isUserInSample(exp.id, exp.trafficAllocation)) return;

        // Bucket User
        variantId = this.bucket(exp.id, exp.variants);

        // Persist
        this.assignments[exp.id] = {
          variantId,
          assignedAt: new Date().toISOString(),
        };
        LS.setItem(STORAGE_KEYS.ASSIGNMENTS, JSON.stringify(this.assignments));
      }

      // Apply Changes
      const variant = exp.variants.find((v) => v.id === variantId);
      if (variant && !variant.isControl) {
        this.applyChanges(variant.changes);
      }

      // Log View
      if (!this.activeExperiments.has(exp.id)) {
        this.activeExperiments.add(exp.id);
        this.enqueueEvent("EXPERIMENT_VIEW", {
          experimentId: exp.id,
          variantId: variantId,
        });
      }
    });
  }

  private checkAudiences(audiences: AudienceConfig[]): boolean {
    return audiences.every((aud) => {
      let userValue: any;

      switch (aud.type) {
        case "DEVICE":
          userValue = /Mobi|Android/i.test(navigator.userAgent)
            ? "mobile"
            : "desktop";
          break;
        case "BROWSER":
          userValue = navigator.userAgent;
          break;
        case "QUERY_PARAM":
          userValue = new URLSearchParams(window.location.search).get(
            aud.key || ""
          );
          break;
        case "COOKIE":
          userValue = CookieUtils.get(aud.key || "");
          break;
        case "JS_VAR":
          // @ts-ignore
          userValue = window[aud.key || ""];
          break;
        default:
          return true;
      }

      if (userValue === null || userValue === undefined) return false;

      // Operators
      switch (aud.operator) {
        case "IS":
          return String(userValue) === String(aud.value);
        case "IS_NOT":
          return String(userValue) !== String(aud.value);
        case "CONTAINS":
          return String(userValue).indexOf(String(aud.value)) > -1;
        case "NOT_CONTAINS":
          return String(userValue).indexOf(String(aud.value)) === -1;
        case "MATCHES_REGEX":
          return new RegExp(String(aud.value)).test(String(userValue));
        case "GREATER_THAN":
          return Number(userValue) > Number(aud.value);
        case "LESS_THAN":
          return Number(userValue) < Number(aud.value);
        default:
          return true;
      }
    });
  }

  // Deterministic Bucketing
  private bucket(salt: string, variants: VariantConfig[]): string {
    const hash = this.hashInfo(this.visitorId + salt);
    let weightSum = 0;
    for (const v of variants) {
      weightSum += v.trafficWeight;
      if (hash % 100 < weightSum) return v.id;
    }
    return variants[0].id;
  }

  private isUserInSample(expId: string, allocation: number): boolean {
    const hash = this.hashInfo(this.visitorId + expId + "alloc");
    return hash % 100 < allocation;
  }

  private hashInfo(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // --- DOM Manipulation ---

  private applyChanges(changes: ChangeInstruction[]) {
    changes.forEach((change) => {
      this.waitForElement(change.selector, change.waitForSelector || 0).then(
        (elements) => {
          elements.forEach((el: any) => {
            try {
              switch (change.action) {
                case "setText":
                  el.textContent = change.value;
                  break;
                case "setHTML":
                  if (change.allowInnerHTML) el.innerHTML = change.value;
                  break;
                case "setStyle":
                  el.style.cssText += change.value;
                  break;
                case "addClass":
                  el.classList.add(change.value);
                  break;
                case "removeClass":
                  el.classList.remove(change.value);
                  break;
                case "setAttr":
                  if (change.attributeName)
                    el.setAttribute(change.attributeName, change.value);
                  break;
                case "runScript":
                  const s = document.createElement("script");
                  s.text = change.value || "";
                  document.head.appendChild(s);
                  break;
              }
            } catch (e) {
              this.log("DOM Error", e);
            }
          });
        }
      );
    });
  }

  private waitForElement(
    selector: string,
    timeout: number
  ): Promise<Element[]> {
    return new Promise((resolve) => {
      const els = document.querySelectorAll(selector);
      if (els.length) return resolve(Array.from(els));

      if (timeout <= 0) return resolve([]); // Don't wait if 0

      const observer = new MutationObserver(() => {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length) {
          observer.disconnect();
          resolve(Array.from(nodes));
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve([]);
      }, timeout || 2000);
    });
  }

  // --- Event & Goal Tracking ---

  private setupGoals() {
    if (!this.config) return;

    // 1. Click & Submit (Delegation)
    document.addEventListener(
      "click",
      (e) => this.checkInteraction(e, "CLICK"),
      true
    );
    document.addEventListener(
      "submit",
      (e) => this.checkInteraction(e, "FORM_SUBMIT"),
      true
    );

    // 2. Pageview Goals
    this.checkPageviewGoals();
  }

  private checkInteraction(e: Event, type: GoalType) {
    if (!this.config) return;
    this.updateActivity(); // Reset session timeout

    const target = e.target as HTMLElement;
    this.config.goals.forEach((g) => {
      if (g.type === type && g.selector && target.matches(g.selector)) {
        this.enqueueEvent("GOAL_CONVERSION", { goalId: g.id });
      }
    });
  }

  private checkPageviewGoals() {
    if (!this.config) return;
    const url = window.location.href;
    this.config.goals.forEach((g) => {
      if (
        g.type === "PAGE_VIEW" &&
        g.urlPattern &&
        new RegExp(g.urlPattern).test(url)
      ) {
        this.enqueueEvent("GOAL_CONVERSION", { goalId: g.id });
      }
    });
  }

  private setupSystemEvents() {
    // SPA Support
    const handleUrlChange = () => {
      this.log("URL Changed", window.location.href);
      this.processExperiments();
      this.checkPageviewGoals();
    };

    window.addEventListener("popstate", handleUrlChange);

    // Monkey Patch History for PushState
    const originalPush = history.pushState;
    history.pushState = function (...args) {
      const res = originalPush.apply(this, args);
      handleUrlChange();
      return res;
    };

    // Flush on unload
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushEvents();
    });
  }

  private enqueueEvent(type: string, data: any) {
    this.eventQueue.push({
      projectId: this.projectId,
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      eventType: type,
      url: window.location.href,
      ...data,
    });

    if (this.eventQueue.length >= 5) this.flushEvents();
  }

  private flushEvents() {
    if (this.eventQueue.length === 0) return;

    const payload = JSON.stringify(this.eventQueue);
    this.eventQueue = []; // Clear immediately (optimistic)

    // Her zaman fetch kullan (sendBeacon Chrome'da sorun çıkarıyor)
    fetch(this.ingestUrl, {
      method: "POST",
      body: payload,
      keepalive: true, // Sayfa kapanırken bile gönderimi tamamlar
      headers: { "Content-Type": "application/json" },
    }).catch((e) => this.log("Flush Error", e));
  }

  private log(msg: string, data?: any) {
    if (this.debug) console.log(`[AB-ENT] ${msg}`, data || "");
  }
}

// Global Init Helper
(window as any).initAB = (config: InitOptions) => {
  return new ABTrackerEnterprise(config);
};
