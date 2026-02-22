/**
 * Core type definitions for the URL monitoring application
 */

// ============================================================================
// ENUMS
// ============================================================================

export enum CheckInterval {
  ONE_MINUTE = 60,
  FIVE_MINUTES = 300
}

export enum ProbeLocation {
  US_EAST = 'us-east',
  EU_WEST = 'eu-west',
  ME_CENTRAL = 'me-central',
  IN_MUMBAI = 'in-mumbai',
  IN_HYDERABAD = 'in-hyderabad'
}

export enum AlertType {
  FAILURE = 'failure',
  RECOVERY = 'recovery',
  SSL_WARNING = 'ssl_warning',
  SSL_CRITICAL = 'ssl_critical'
}

export enum TimePeriod {
  LAST_24_HOURS = '24h',
  LAST_7_DAYS = '7d',
  LAST_30_DAYS = '30d'
}

// ============================================================================
// CORE DOMAIN INTERFACES
// ============================================================================

export interface Tenant {
  id: string;
  name: string;
  encryptedConfig: Record<string, any>;
  createdAt: Date;
}

export interface Monitor {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  checkInterval: CheckInterval;
  timeoutSeconds: number;
  expectedStatusCodes: number[];
  probeLocations: ProbeLocation[];
  failureThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckResult {
  id: string;
  monitorId: string;
  location: ProbeLocation;
  timestamp: Date;
  success: boolean;
  responseTime?: number; // milliseconds
  statusCode?: number;
  errorMessage?: string;
  sslExpiryDate?: Date;
}

export interface Alert {
  id: string;
  monitorId: string;
  type: AlertType;
  triggeredAt: Date;
  resolvedAt?: Date;
  consecutiveFailures: number;
  message: string;
  notificationStatus: Record<string, any>;
}

export interface UptimeMetrics {
  monitorId: string;
  period: TimePeriod;
  totalChecks: number;
  successfulChecks: number;
  uptimePercentage: number;
  averageResponseTime: number;
  lastOutageDuration?: number; // minutes
}

export interface SSLCertificateInfo {
  expiryDate: Date;
  issuer: string;
  subject: string;
  daysUntilExpiry: number;
}

export interface NotificationChannel {
  id: string;
  tenantId: string;
  name: string;
  type: 'email' | 'webhook' | 'sms' | 'voice';
  configuration: Record<string, any>; // encrypted sensitive data
  enabled: boolean;
  createdAt: Date;
}

// ============================================================================
// SERVICE INTERFACES
// ============================================================================

export interface ScheduledCheck {
  monitorId: string;
  nextRunTime: Date;
  interval: CheckInterval;
}

export interface AlertDecision {
  shouldAlert: boolean;
  alertType: AlertType;
  consecutiveFailures: number;
  affectedLocations: ProbeLocation[];
}

export interface NotificationResult {
  channelId: string;
  success: boolean;
  errorMessage?: string;
  deliveredAt: Date;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateMonitorRequest {
  name: string;
  url: string;
  checkInterval: CheckInterval;
  timeoutSeconds: number;
  expectedStatusCodes?: number[];
  probeLocations: ProbeLocation[];
  failureThreshold?: number;
}

export interface UpdateMonitorRequest extends Partial<CreateMonitorRequest> {
  id: string;
}

export interface MonitorResponse extends Monitor {
  currentStatus?: 'up' | 'down' | 'unknown';
  lastCheckTime?: Date;
  lastResponseTime?: number;
}

export interface CreateNotificationChannelRequest {
  name?: string;
  type: 'email' | 'webhook' | 'sms' | 'voice';
  configuration: Record<string, any>;
  enabled?: boolean;
}

export interface UptimeQuery {
  monitorId: string;
  period: TimePeriod;
  location?: ProbeLocation;
}

export interface CheckHistoryQuery {
  monitorId: string;
  startTime?: Date;
  endTime?: Date;
  location?: ProbeLocation;
  limit?: number;
}

export interface AlertHistoryQuery {
  monitorId?: string;
  alertType?: AlertType;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

export interface JWTPayload {
  tenantId: string;
  userId: string;
  exp: number;
  iat: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  otp?: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  tenant: Tenant;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}
