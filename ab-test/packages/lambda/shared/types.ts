// ============================================
// SDK Config Types (SDK'nın beklediği format)
// ============================================

export interface SDKConfig {
  projectId: string;
  version: number;
  experiments: SDKExperiment[];
  goals: SDKGoal[];
  globalJS?: string | null;
}

export interface SDKExperiment {
  id: string;
  name: string;
  type: string;
  status: "RUNNING";
  trafficAllocation: number;
  urlPattern: string;
  audiences: SDKAudience[];
  variants: SDKVariant[];
}

export interface SDKVariant {
  id: string;
  name: string;
  isControl: boolean;
  trafficWeight: number;
  changes: any[];
}

export interface SDKAudience {
  type: string;
  operator: string;
  value: string | null;
  condition: string;
}

export interface SDKGoal {
  id: string;
  name: string;
  type: string;
  urlPattern: string | null;
  selector: string | null;
  eventName: string | null;
  revenueTracking: boolean;
  experimentIds: string[];
}

// ============================================
// Event Types (SDK'nın gönderdiği format)
// ============================================

export interface IncomingEvent {
  projectId: string;
  visitorId: string;
  sessionId: string;
  timestamp: string;
  eventType: EventType;
  url: string;

  // Experiment view
  experimentId?: string;
  experimentName?: string;
  variantId?: string;
  variantName?: string;
  isControl?: boolean;

  // Goal conversion
  goalId?: string;
  goalName?: string;
  goalType?: string;
  attributedExperiments?: AttributedExperiment[];

  // Custom event
  eventName?: string;

  // Revenue
  value?: number;
  currency?: string;

  // Context
  userAgent?: string;
  referrer?: string;

  // Extra data
  [key: string]: any;
}

export type EventType =
  | "SESSION_START"
  | "EXPERIMENT_VIEW"
  | "GOAL_CONVERSION"
  | "CUSTOM_EVENT"
  | "PAGE_VIEW"
  | "CLICK"
  | "FORM_SUBMIT";

export interface AttributedExperiment {
  experimentId: string;
  experimentName?: string;
  variantId: string;
  variantName?: string;
}

// ============================================
// Admin API Types
// ============================================

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
