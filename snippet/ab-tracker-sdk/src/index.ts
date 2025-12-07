/**
 * AB Testing SDK - Enterprise Edition (Zero Flicker + DataLayer + Attribution)
 */

// --------------------------- Types ---------------------------

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
  name?: string;
  status: "RUNNING" | "PAUSED";
  trafficAllocation: number;
  urlPattern: string;
  audiences?: AudienceConfig[];
  variants: VariantConfig[];
}

interface VariantConfig {
  id: string;
  name?: string;
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
  waitForSelector?: number;
}

interface GoalConfig {
  id: string;
  name?: string;
  type: GoalType;
  selector?: string;
  urlPattern?: string;
  eventName?: string;
  // Hangi experimentlere ait goal?  Boşsa tüm aktif experimentler için geçerli
  experimentIds?: string[];
}

interface AudienceConfig {
  type: string;
  key?: string;
  operator: OperatorType;
  value?: string | number;
}

interface StoredAssignments {
  [experimentId: string]: {
    variantId: string;
    variantName?: string;
    experimentName?: string;
    assignedAt: string;
  };
}

// Kullanıcının hangi testlere expose olduğunu takip eder
interface ExposureRecord {
  [experimentId: string]: {
    variantId: string;
    exposedAt: string;
    exposureCount: number;
  };
}

// --------------------------- Storage Engine ---------------------------

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

  constructor(type: "localStorage" | "sessionStorage") {
    this.fallback = new MemoryStorage();
    try {
      this.storage = window[type];
      const x = "__ab_test__";
      this.storage.setItem(x, x);
      this.storage.removeItem(x);
    } catch (e) {
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

// --------------------------- Cookie Utils ---------------------------

const CookieUtils = {
  set: (name: string, value: string, days: number) => {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = "; expires=" + date.toUTCString();
    }
    const host = window.location.hostname;
    const parts = host.split(". ").reverse();
    if (parts.length >= 2) {
      const twoLevel = `. ${parts[1]}.${parts[0]}`;
      document.cookie = `${name}=${value}${expires}; domain=${twoLevel}; path=/; SameSite=Lax`;
      if (document.cookie.indexOf(name + "=" + value) > -1) return;
    }
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

// --------------------------- DataLayer Helper ---------------------------

interface DataLayerEvent {
  event: string;
  ab_test?: {
    experiment_id: string;
    experiment_name?: string;
    variant_id: string;
    variant_name?: string;
    is_control?: boolean;
  };
  ab_goal?: {
    goal_id: string;
    goal_name?: string;
    goal_type: string;
  };
  ab_experiments?: Array<{
    experiment_id: string;
    experiment_name?: string;
    variant_id: string;
    variant_name?: string;
  }>;
  [key: string]: any;
}

const DataLayerHelper = {
  push: (data: DataLayerEvent) => {
    // @ts-ignore
    window.dataLayer = window.dataLayer || [];
    // @ts-ignore
    window.dataLayer.push(data);
  },

  // Experiment görüntüleme eventi
  pushExperimentView: (
    experimentId: string,
    experimentName: string | undefined,
    variantId: string,
    variantName: string | undefined,
    isControl: boolean
  ) => {
    DataLayerHelper.push({
      event: "ab_experiment_view",
      ab_test: {
        experiment_id: experimentId,
        experiment_name: experimentName,
        variant_id: variantId,
        variant_name: variantName,
        is_control: isControl,
      },
    });
  },

  // Goal conversion eventi
  pushGoalConversion: (
    goalId: string,
    goalName: string | undefined,
    goalType: string,
    experiments: Array<{
      experimentId: string;
      experimentName?: string;
      variantId: string;
      variantName?: string;
    }>,
    customData?: Record<string, any>
  ) => {
    DataLayerHelper.push({
      event: "ab_goal_conversion",
      ab_goal: {
        goal_id: goalId,
        goal_name: goalName,
        goal_type: goalType,
      },
      ab_experiments: experiments.map((e) => ({
        experiment_id: e.experimentId,
        experiment_name: e.experimentName,
        variant_id: e.variantId,
        variant_name: e.variantName,
      })),
      ...customData,
    });
  },

  // Custom event
  pushCustomEvent: (
    eventName: string,
    experiments: Array<{
      experimentId: string;
      experimentName?: string;
      variantId: string;
      variantName?: string;
    }>,
    customData?: Record<string, any>
  ) => {
    DataLayerHelper.push({
      event: eventName,
      ab_experiments: experiments.map((e) => ({
        experiment_id: e.experimentId,
        experiment_name: e.experimentName,
        variant_id: e.variantId,
        variant_name: e.variantName,
      })),
      ...customData,
    });
  },
};

// --------------------------- Utils ---------------------------

const STORAGE_KEYS = {
  VISITOR_ID: "ab_ent_vid",
  SESSION_ID: "ab_ent_sid",
  ASSIGNMENTS: "ab_ent_assignments",
  EXPOSURES: "ab_ent_exposures", // YENİ: Exposure kayıtları
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
  antiFlickerTimeout?: number;
  // Attribution penceresi (gün cinsinden) - varsayılan 30 gün
  attributionWindowDays?: number;
}

export class ABTrackerEnterprise {
  private projectId: string;
  private ingestUrl: string;
  private configUrl: string;
  private visitorId: string;
  private sessionId: string;
  private assignments: StoredAssignments;
  private exposures: ExposureRecord; // YENİ: Exposure takibi
  private config?: ProjectConfig;
  private eventQueue: any[] = [];
  private debug: boolean;
  private activeExperiments: Set<string> = new Set();
  private antiFlickerTimeout: number;
  private attributionWindowDays: number;
  private isRevealed: boolean = false;
  private trackedGoals: Set<string> = new Set(); // Aynı goal'u tekrar saymamak için

  constructor(opts: InitOptions) {
    this.projectId = opts.projectId;
    this.ingestUrl = opts.ingestUrl;
    this.configUrl = opts.configUrl;
    this.debug = !!opts.debug;
    this.antiFlickerTimeout = opts.antiFlickerTimeout ?? 1500;
    this.attributionWindowDays = opts.attributionWindowDays ?? 30;

    // 1.  HEMEN gizle
    this.hidePageInstantly();

    // 2. Identity
    this.visitorId = this.resolveVisitorId();
    this.sessionId = this.resolveSessionId();
    this.assignments = safeJSONParse(LS.getItem(STORAGE_KEYS.ASSIGNMENTS), {});
    this.exposures = safeJSONParse(LS.getItem(STORAGE_KEYS.EXPOSURES), {});

    // 3.  Eski exposure'ları temizle
    this.cleanupExpiredExposures();

    // 4. Init
    this.init();

    // 5.  Events
    this.setupSystemEvents();

    // 6. Global goal dinleyicileri kur (tüm sayfalarda çalışır)
    this.setupGlobalGoalListeners();
  }

  // ==================== ZERO FLICKER SYSTEM ====================

  private styleTagId = "ab-antiflicker-style";

  private hidePageInstantly() {
    const css = `
      html.ab-loading {
        visibility: hidden ! important;
      }
      html.ab-loading * {
        animation-play-state: paused !important;
        transition: none !important;
      }
    `;

    const style = document.createElement("style");
    style.id = this.styleTagId;
    style.textContent = css;

    (document.head || document.documentElement).appendChild(style);
    document.documentElement.classList.add("ab-loading");

    this.log("Page hidden instantly");
  }

  private revealPage() {
    if (this.isRevealed) return;
    this.isRevealed = true;

    document.documentElement.classList.remove("ab-loading");

    const style = document.getElementById(this.styleTagId);
    if (style) {
      setTimeout(() => style.remove(), 100);
    }

    this.log("Page revealed");
  }

  // ==================== EXPOSURE MANAGEMENT ====================

  /**
   * Kullanıcıyı bir teste "expose" olarak işaretle
   * Bu, kullanıcının test sayfasını en az 1 kere gördüğü anlamına gelir
   */
  private recordExposure(experimentId: string, variantId: string) {
    const now = new Date().toISOString();

    if (this.exposures[experimentId]) {
      // Zaten expose olmuş, sayacı artır
      this.exposures[experimentId].exposureCount++;
    } else {
      // İlk exposure
      this.exposures[experimentId] = {
        variantId,
        exposedAt: now,
        exposureCount: 1,
      };
    }

    LS.setItem(STORAGE_KEYS.EXPOSURES, JSON.stringify(this.exposures));
    this.log(`Exposure recorded: ${experimentId} -> ${variantId}`);
  }

  /**
   * Kullanıcının belirli bir teste expose olup olmadığını kontrol et
   */
  private isExposedToExperiment(experimentId: string): boolean {
    return !!this.exposures[experimentId];
  }

  /**
   * Kullanıcının herhangi bir teste expose olup olmadığını kontrol et
   */
  private hasAnyExposure(): boolean {
    return Object.keys(this.exposures).length > 0;
  }

  /**
   * Kullanıcının expose olduğu tüm aktif testleri getir
   */
  private getExposedExperiments(): Array<{
    experimentId: string;
    experimentName?: string;
    variantId: string;
    variantName?: string;
  }> {
    const result: Array<{
      experimentId: string;
      experimentName?: string;
      variantId: string;
      variantName?: string;
    }> = [];

    for (const [experimentId, exposure] of Object.entries(this.exposures)) {
      const assignment = this.assignments[experimentId];
      if (assignment) {
        result.push({
          experimentId,
          experimentName: assignment.experimentName,
          variantId: exposure.variantId,
          variantName: assignment.variantName,
        });
      }
    }

    return result;
  }

  /**
   * Attribution penceresi dışındaki eski exposure'ları temizle
   */
  private cleanupExpiredExposures() {
    const now = Date.now();
    const windowMs = this.attributionWindowDays * 24 * 60 * 60 * 1000;
    let changed = false;

    for (const [experimentId, exposure] of Object.entries(this.exposures)) {
      const exposedAt = new Date(exposure.exposedAt).getTime();
      if (now - exposedAt > windowMs) {
        delete this.exposures[experimentId];
        changed = true;
        this.log(`Expired exposure removed: ${experimentId}`);
      }
    }

    if (changed) {
      LS.setItem(STORAGE_KEYS.EXPOSURES, JSON.stringify(this.exposures));
    }
  }

  // ==================== INITIALIZATION ====================

  private async init() {
    const startTime = performance.now();

    const failsafeTimer = setTimeout(() => {
      this.log("Failsafe timeout reached");
      this.revealPage();
    }, this.antiFlickerTimeout);

    try {
      await this.loadConfig();

      if (!this.config) {
        this.revealPage();
        clearTimeout(failsafeTimer);
        return;
      }

      await this.processExperiments();
      this.setupGoals();

      this.log(
        `Init completed in ${Math.round(performance.now() - startTime)}ms`
      );
    } catch (err) {
      this.log("Init Error", err);
    } finally {
      clearTimeout(failsafeTimer);
      requestAnimationFrame(() => {
        this.revealPage();
      });
    }
  }

  private async loadConfig() {
    const cached = safeJSONParse<{ ts: number; data: ProjectConfig } | null>(
      LS.getItem(STORAGE_KEYS.CONFIG_CACHE),
      null
    );
    const CACHE_TTL = 60 * 1000;

    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      this.config = cached.data;
      this.log("Using cached config");
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 800);

      const res = await fetch(this.configUrl, {
        signal: controller.signal,
        cache: "no-cache",
      });

      clearTimeout(timeoutId);

      if (!res.ok) throw new Error("Fetch failed");

      this.config = await res.json();
      LS.setItem(
        STORAGE_KEYS.CONFIG_CACHE,
        JSON.stringify({ ts: Date.now(), data: this.config })
      );
      this.log("Config fetched");
    } catch (e) {
      if (cached) {
        this.config = cached.data;
        this.log("Using stale cache due to fetch error");
      }
    }
  }

  // ==================== IDENTITY & SESSION ====================

  private resolveVisitorId(): string {
    let vid = CookieUtils.get(STORAGE_KEYS.VISITOR_ID);
    if (!vid) vid = LS.getItem(STORAGE_KEYS.VISITOR_ID);
    if (!vid) vid = generateUUID();
    //@ts-ignore
    CookieUtils.set(STORAGE_KEYS.VISITOR_ID, vid, 365);
    //@ts-ignore
    LS.setItem(STORAGE_KEYS.VISITOR_ID, vid);
    //@ts-ignore
    return vid;
  }

  private resolveSessionId(): string {
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
    const now = Date.now();
    const lastActive = parseInt(LS.getItem(STORAGE_KEYS.LAST_ACTIVITY) || "0");
    let sid = SS.getItem(STORAGE_KEYS.SESSION_ID);

    if (!sid || now - lastActive > SESSION_TIMEOUT_MS) {
      sid = generateUUID();
      //@ts-ignore
      SS.setItem(STORAGE_KEYS.SESSION_ID, sid);
      this.enqueueEvent("SESSION_START", { referrer: document.referrer });
    }

    LS.setItem(STORAGE_KEYS.LAST_ACTIVITY, now.toString());
    //@ts-ignore
    return sid;
  }

  private updateActivity() {
    LS.setItem(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
  }

  // ==================== EXPERIMENT PROCESSING ====================

  private async processExperiments(): Promise<void> {
    if (!this.config) return;

    const url = window.location.href;
    const path = window.location.pathname;
    const changePromises: Promise<void>[] = [];

    for (const exp of this.config.experiments) {
      if (exp.status !== "RUNNING") continue;

      // URL Check
      const regex = new RegExp(exp.urlPattern);
      if (!regex.test(url) && !regex.test(path)) continue;

      // Audience Check
      if (exp.audiences && !this.checkAudiences(exp.audiences)) continue;

      // Get or create assignment
      let variantId = this.assignments[exp.id]?.variantId;
      let variant: VariantConfig | undefined;

      if (!variantId) {
        if (!this.isUserInSample(exp.id, exp.trafficAllocation)) continue;

        variantId = this.bucket(exp.id, exp.variants);
        variant = exp.variants.find((v) => v.id === variantId);

        this.assignments[exp.id] = {
          variantId,
          variantName: variant?.name,
          experimentName: exp.name,
          assignedAt: new Date().toISOString(),
        };
        LS.setItem(STORAGE_KEYS.ASSIGNMENTS, JSON.stringify(this.assignments));
      } else {
        variant = exp.variants.find((v) => v.id === variantId);
      }

      // Apply changes
      if (variant && !variant.isControl) {
        changePromises.push(this.applyChanges(variant.changes));
      }

      // EXPOSURE KAYDI - Kullanıcı testi gördü!
      this.recordExposure(exp.id, variantId);

      // Log view (sadece ilk kez)
      if (!this.activeExperiments.has(exp.id)) {
        this.activeExperiments.add(exp.id);

        // Backend'e gönder
        this.enqueueEvent("EXPERIMENT_VIEW", {
          experimentId: exp.id,
          experimentName: exp.name,
          variantId: variantId,
          variantName: variant?.name,
          isControl: variant?.isControl ?? false,
        });

        // DataLayer'a push et
        DataLayerHelper.pushExperimentView(
          exp.id,
          exp.name,
          variantId,
          variant?.name,
          variant?.isControl ?? false
        );
      }
    }

    await Promise.all(changePromises);
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

  private bucket(salt: string, variants: VariantConfig[]): string {
    const hash = this.hashCode(this.visitorId + salt);
    let weightSum = 0;
    for (const v of variants) {
      weightSum += v.trafficWeight;
      if (hash % 100 < weightSum) return v.id;
    }
    return variants[0].id;
  }

  private isUserInSample(expId: string, allocation: number): boolean {
    const hash = this.hashCode(this.visitorId + expId + "alloc");
    return hash % 100 < allocation;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  // ==================== DOM MANIPULATION ====================

  private async applyChanges(changes: ChangeInstruction[]): Promise<void> {
    const promises = changes.map((change) => {
      const timeout = change.waitForSelector ?? 50;
      return this.waitForElement(change.selector, timeout).then((elements) => {
        this.applyChangeToElements(elements, change);
      });
    });

    await Promise.all(promises);
  }

  private applyChangeToElements(
    elements: Element[],
    change: ChangeInstruction
  ) {
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
          case "insertAdjacentHTML":
            if (change.allowInnerHTML && change.value)
              el.insertAdjacentHTML("beforeend", change.value);
            break;
          case "replaceNode":
            if (change.allowInnerHTML && change.value)
              el.outerHTML = change.value;
            break;
          case "moveNode":
            if (change.value) {
              const target = document.querySelector(change.value);
              if (target) target.appendChild(el);
            }
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

  private waitForElement(
    selector: string,
    timeout: number
  ): Promise<Element[]> {
    return new Promise((resolve) => {
      const els = document.querySelectorAll(selector);
      if (els.length) {
        resolve(Array.from(els));
        return;
      }

      if (timeout <= 0) {
        resolve([]);
        return;
      }

      let resolved = false;

      const done = (elements: Element[]) => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        resolve(elements);
      };

      const observer = new MutationObserver(() => {
        const nodes = document.querySelectorAll(selector);
        if (nodes.length) {
          done(Array.from(nodes));
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        const finalEls = document.querySelectorAll(selector);
        done(Array.from(finalEls));
      }, timeout);
    });
  }

  // ==================== GOAL TRACKING (WITH ATTRIBUTION) ====================

  /**
   * Global goal dinleyicileri - tüm sayfalarda çalışır
   * Bu sayede purchase gibi eventler herhangi bir sayfada tetiklenebilir
   */
  private setupGlobalGoalListeners() {
    // Click events (delegation)
    document.addEventListener(
      "click",
      (e) => {
        this.handleGoalInteraction(e, "CLICK");
      },
      true
    );

    // Form submit events
    document.addEventListener(
      "submit",
      (e) => {
        this.handleGoalInteraction(e, "FORM_SUBMIT");
      },
      true
    );

    // Page visibility için flush
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushEvents();
    });

    window.addEventListener("pagehide", () => this.flushEvents());

    this.log("Global goal listeners initialized");
  }

  private setupGoals() {
    if (!this.config) return;

    // Scroll goals
    this.setupScrollGoals();

    // Visibility goals
    this.setupVisibilityGoals();

    // Pageview goals
    this.checkPageviewGoals();
  }

  /**
   * Goal interaction handler - ATTRIBUTION KONTROLÜ İLE
   */
  private handleGoalInteraction(e: Event, type: GoalType) {
    if (!this.config) return;
    this.updateActivity();

    const target = e.target as HTMLElement;

    this.config.goals.forEach((goal) => {
      if (goal.type !== type || !goal.selector) return;

      // Selector eşleşiyor mu?
      if (!target.matches(goal.selector) && !target.closest(goal.selector))
        return;

      // Conversion'ı kaydetmeye çalış
      this.tryRecordConversion(goal);
    });
  }

  /**
   * Conversion kaydetme - ATTRIBUTION KONTROLÜ
   * Sadece kullanıcı en az 1 teste expose olmuşsa conversion sayılır
   */
  private tryRecordConversion(
    goal: GoalConfig,
    customData?: Record<string, any>
  ) {
    // Aynı goal zaten sayıldı mı?  (session bazlı)
    const goalSessionKey = `${goal.id}_${this.sessionId}`;
    if (this.trackedGoals.has(goalSessionKey)) {
      this.log(`Goal already tracked this session: ${goal.id}`);
      return;
    }

    // ATTRIBUTION KONTROLÜ
    // Kullanıcı hiçbir teste expose olmadıysa, conversion SAYILMAZ
    if (!this.hasAnyExposure()) {
      this.log(`Goal ${goal.id} ignored - user has no experiment exposure`);
      return;
    }

    // Hangi testlere attribution yapılacak?
    let attributedExperiments = this.getExposedExperiments();

    // Eğer goal belirli experimentlere ait ise, sadece onları filtrele
    if (goal.experimentIds && goal.experimentIds.length > 0) {
      attributedExperiments = attributedExperiments.filter((exp) =>
        goal.experimentIds!.includes(exp.experimentId)
      );

      // Filtrelenmiş listede hiç experiment yoksa, conversion sayılmaz
      if (attributedExperiments.length === 0) {
        this.log(
          `Goal ${goal.id} ignored - user not exposed to relevant experiments`
        );
        return;
      }
    }

    // Goal'u tracked olarak işaretle
    this.trackedGoals.add(goalSessionKey);

    // Backend'e gönder
    this.enqueueEvent("GOAL_CONVERSION", {
      goalId: goal.id,
      goalName: goal.name,
      goalType: goal.type,
      attributedExperiments: attributedExperiments,
      ...customData,
    });

    // DataLayer'a push et
    DataLayerHelper.pushGoalConversion(
      goal.id,
      goal.name,
      goal.type,
      attributedExperiments,
      customData
    );

    this.log(`Goal conversion recorded: ${goal.id}`, {
      attributedTo: attributedExperiments.map((e) => e.experimentId),
    });
  }

  private setupScrollGoals() {
    if (!this.config) return;

    const scrollGoals = this.config.goals.filter((g) => g.type === "SCROLL");
    if (scrollGoals.length === 0) return;

    let ticking = false;

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          requestAnimationFrame(() => {
            const scrollPercent =
              (window.scrollY /
                (document.documentElement.scrollHeight - window.innerHeight)) *
              100;

            scrollGoals.forEach((goal) => {
              const threshold = parseInt(goal.selector || "50", 10);
              if (scrollPercent >= threshold) {
                this.tryRecordConversion(goal);
              }
            });
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  private setupVisibilityGoals() {
    if (!this.config) return;

    const visibilityGoals = this.config.goals.filter(
      (g) => g.type === "ELEMENT_VISIBILITY" && g.selector
    );
    if (visibilityGoals.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibilityGoals.forEach((goal) => {
              if (entry.target.matches(goal.selector!)) {
                this.tryRecordConversion(goal);
              }
            });
          }
        });
      },
      { threshold: 0.5 }
    );

    visibilityGoals.forEach((goal) => {
      document
        .querySelectorAll(goal.selector!)
        .forEach((el) => observer.observe(el));
    });
  }

  private checkPageviewGoals() {
    if (!this.config) return;
    const url = window.location.href;

    this.config.goals.forEach((goal) => {
      if (
        goal.type === "PAGE_VIEW" &&
        goal.urlPattern &&
        new RegExp(goal.urlPattern).test(url)
      ) {
        this.tryRecordConversion(goal);
      }
    });
  }

  // ==================== EVENTS ====================

  private setupSystemEvents() {
    const handleUrlChange = () => {
      this.log("URL Changed", window.location.href);
      this.processExperiments().catch((err) => this.log("SPA Error", err));
      this.checkPageviewGoals();
    };

    window.addEventListener("popstate", handleUrlChange);

    const originalPush = history.pushState;
    history.pushState = function (...args) {
      const res = originalPush.apply(this, args);
      handleUrlChange();
      return res;
    };

    const originalReplace = history.replaceState;
    history.replaceState = function (...args) {
      const res = originalReplace.apply(this, args);
      handleUrlChange();
      return res;
    };
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
    this.eventQueue = [];

    fetch(this.ingestUrl, {
      method: "POST",
      body: payload,
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    }).catch((e) => this.log("Flush Error", e));
  }

  // ==================== PUBLIC API ====================

  /**
   * Manuel custom event tracking
   * Attribution kuralları burada da geçerli!
   */
  public trackEvent(eventName: string, data?: Record<string, any>) {
    // Attribution kontrolü
    if (!this.hasAnyExposure()) {
      this.log(
        `Custom event ${eventName} ignored - user has no experiment exposure`
      );
      return;
    }

    const exposedExperiments = this.getExposedExperiments();

    // Config'deki CUSTOM_EVENT goal'larını kontrol et
    if (this.config) {
      this.config.goals.forEach((goal) => {
        if (goal.type === "CUSTOM_EVENT" && goal.eventName === eventName) {
          this.tryRecordConversion(goal, data);
        }
      });
    }

    // DataLayer'a push et
    DataLayerHelper.pushCustomEvent(eventName, exposedExperiments, data);

    // Backend'e gönder
    this.enqueueEvent("CUSTOM_EVENT", {
      eventName,
      attributedExperiments: exposedExperiments,
      ...data,
    });
  }

  /**
   * Kullanıcının belirli bir teste expose olup olmadığını kontrol et
   */
  public isExposed(experimentId: string): boolean {
    return this.isExposedToExperiment(experimentId);
  }

  /**
   * Kullanıcının herhangi bir teste expose olup olmadığını kontrol et
   */
  public hasExposure(): boolean {
    return this.hasAnyExposure();
  }

  /**
   * Kullanıcının gördüğü variant'ı getir
   */
  public getVariant(experimentId: string): string | null {
    return this.assignments[experimentId]?.variantId || null;
  }

  /**
   * Tüm aktif exposure'ları getir
   */
  public getExposures(): ExposureRecord {
    return { ...this.exposures };
  }

  /**
   * Event queue'yu flush et
   */
  public flush() {
    this.flushEvents();
  }

  private log(msg: string, data?: any) {
    if (this.debug) console.log(`[AB-SDK] ${msg}`, data || "");
  }
}

// Global Init
(window as any).initAB = (config: InitOptions) => {
  return new ABTrackerEnterprise(config);
};
