/**
 * Validation functions for domain models
 */

import {
  Monitor,
  CheckResult,
  Alert,
  Tenant,
  UptimeMetrics,
  NotificationChannel,
  CreateMonitorRequest,
  CreateNotificationChannelRequest,
  CheckInterval,
  ProbeLocation,
  AlertType,
  TimePeriod,
  ValidationResult,
  ValidationError
} from '../types/index';

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

function createValidationResult(errors: ValidationError[] = []): ValidationResult {
  return {
    isValid: errors.length === 0,
    errors
  };
}

function addError(errors: ValidationError[], field: string, message: string, code: string): void {
  errors.push({ field, message, code });
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUrl(url: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!url || url.trim().length === 0) {
    addError(errors, 'url', 'URL is required', 'REQUIRED');
  } else if (!isValidUrl(url)) {
    addError(errors, 'url', 'Valid HTTP/HTTPS URL is required', 'INVALID_URL');
  }

  return createValidationResult(errors);
}

// ============================================================================
// DOMAIN MODEL VALIDATION FUNCTIONS
// ============================================================================

export function validateMonitor(monitor: Partial<Monitor>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!monitor.name || monitor.name.trim().length === 0) {
    addError(errors, 'name', 'Monitor name is required', 'REQUIRED');
  } else if (monitor.name.length > 255) {
    addError(errors, 'name', 'Monitor name must be 255 characters or less', 'MAX_LENGTH');
  }

  if (!monitor.url || !isValidUrl(monitor.url)) {
    addError(errors, 'url', 'Valid HTTP/HTTPS URL is required', 'INVALID_URL');
  }

  if (!monitor.tenantId || monitor.tenantId.trim().length === 0) {
    addError(errors, 'tenantId', 'Tenant ID is required', 'REQUIRED');
  }

  // Check interval validation
  if (monitor.checkInterval !== undefined) {
    const validIntervals = Object.values(CheckInterval);
    if (!validIntervals.includes(monitor.checkInterval)) {
      addError(errors, 'checkInterval', 'Invalid check interval', 'INVALID_ENUM');
    }
  }

  // Timeout validation
  if (monitor.timeoutSeconds !== undefined) {
    if (monitor.timeoutSeconds < 1 || monitor.timeoutSeconds > 300) {
      addError(errors, 'timeoutSeconds', 'Timeout must be between 1 and 300 seconds', 'OUT_OF_RANGE');
    }
  }

  // Expected status codes validation
  if (monitor.expectedStatusCodes) {
    if (!Array.isArray(monitor.expectedStatusCodes) || monitor.expectedStatusCodes.length === 0) {
      addError(errors, 'expectedStatusCodes', 'At least one expected status code is required', 'REQUIRED');
    } else {
      for (const code of monitor.expectedStatusCodes) {
        if (!Number.isInteger(code) || code < 100 || code > 599) {
          addError(errors, 'expectedStatusCodes', 'Status codes must be integers between 100 and 599', 'INVALID_STATUS_CODE');
          break;
        }
      }
    }
  }

  // Probe locations validation
  if (monitor.probeLocations) {
    if (!Array.isArray(monitor.probeLocations) || monitor.probeLocations.length === 0) {
      addError(errors, 'probeLocations', 'At least one probe location is required', 'REQUIRED');
    } else {
      const validLocations = Object.values(ProbeLocation);
      for (const location of monitor.probeLocations) {
        if (!validLocations.includes(location)) {
          addError(errors, 'probeLocations', 'Invalid probe location', 'INVALID_ENUM');
          break;
        }
      }
    }
  }

  // Failure threshold validation
  if (monitor.failureThreshold !== undefined) {
    if (!Number.isInteger(monitor.failureThreshold) || monitor.failureThreshold < 1 || monitor.failureThreshold > 10) {
      addError(errors, 'failureThreshold', 'Failure threshold must be an integer between 1 and 10', 'OUT_OF_RANGE');
    }
  }

  return createValidationResult(errors);
}

export function validateCreateMonitorRequest(request: CreateMonitorRequest): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields validation
  if (!request.name || request.name.trim().length === 0) {
    addError(errors, 'name', 'Monitor name is required', 'REQUIRED');
  } else if (request.name.length > 255) {
    addError(errors, 'name', 'Monitor name must be 255 characters or less', 'MAX_LENGTH');
  }

  if (!request.url || !isValidUrl(request.url)) {
    addError(errors, 'url', 'Valid HTTP/HTTPS URL is required', 'INVALID_URL');
  }

  if (!request.checkInterval) {
    addError(errors, 'checkInterval', 'Check interval is required', 'REQUIRED');
  } else {
    const validIntervals = Object.values(CheckInterval);
    if (!validIntervals.includes(request.checkInterval)) {
      addError(errors, 'checkInterval', 'Invalid check interval', 'INVALID_ENUM');
    }
  }

  if (request.timeoutSeconds === undefined) {
    addError(errors, 'timeoutSeconds', 'Timeout seconds is required', 'REQUIRED');
  } else if (request.timeoutSeconds < 1 || request.timeoutSeconds > 300) {
    addError(errors, 'timeoutSeconds', 'Timeout must be between 1 and 300 seconds', 'OUT_OF_RANGE');
  }

  // Expected status codes validation
  if (request.expectedStatusCodes) {
    if (!Array.isArray(request.expectedStatusCodes) || request.expectedStatusCodes.length === 0) {
      addError(errors, 'expectedStatusCodes', 'At least one expected status code is required', 'REQUIRED');
    } else {
      for (const code of request.expectedStatusCodes) {
        if (!Number.isInteger(code) || code < 100 || code > 599) {
          addError(errors, 'expectedStatusCodes', 'Status codes must be integers between 100 and 599', 'INVALID_STATUS_CODE');
          break;
        }
      }
    }
  }

  if (!request.probeLocations || request.probeLocations.length === 0) {
    addError(errors, 'probeLocations', 'At least one probe location is required', 'REQUIRED');
  } else {
    const validLocations = Object.values(ProbeLocation);
    for (const location of request.probeLocations) {
      if (!validLocations.includes(location)) {
        addError(errors, 'probeLocations', 'Invalid probe location', 'INVALID_ENUM');
        break;
      }
    }
  }

  // Failure threshold validation
  if (request.failureThreshold !== undefined) {
    if (!Number.isInteger(request.failureThreshold) || request.failureThreshold < 1 || request.failureThreshold > 10) {
      addError(errors, 'failureThreshold', 'Failure threshold must be an integer between 1 and 10', 'OUT_OF_RANGE');
    }
  }

  return createValidationResult(errors);
}

export function validateCheckResult(checkResult: Partial<CheckResult>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!checkResult.monitorId || checkResult.monitorId.trim().length === 0) {
    addError(errors, 'monitorId', 'Monitor ID is required', 'REQUIRED');
  }

  if (!checkResult.location) {
    addError(errors, 'location', 'Probe location is required', 'REQUIRED');
  } else {
    const validLocations = Object.values(ProbeLocation);
    if (!validLocations.includes(checkResult.location)) {
      addError(errors, 'location', 'Invalid probe location', 'INVALID_ENUM');
    }
  }

  if (!checkResult.timestamp) {
    addError(errors, 'timestamp', 'Timestamp is required', 'REQUIRED');
  } else if (!(checkResult.timestamp instanceof Date) || isNaN(checkResult.timestamp.getTime())) {
    addError(errors, 'timestamp', 'Valid timestamp is required', 'INVALID_DATE');
  }

  if (checkResult.success === undefined || checkResult.success === null) {
    addError(errors, 'success', 'Success status is required', 'REQUIRED');
  }

  // Optional field validations
  if (checkResult.responseTime !== undefined) {
    if (!Number.isInteger(checkResult.responseTime) || checkResult.responseTime < 0) {
      addError(errors, 'responseTime', 'Response time must be a non-negative integer', 'INVALID_NUMBER');
    }
  }

  if (checkResult.statusCode !== undefined) {
    if (!Number.isInteger(checkResult.statusCode) || checkResult.statusCode < 100 || checkResult.statusCode > 599) {
      addError(errors, 'statusCode', 'Status code must be an integer between 100 and 599', 'INVALID_STATUS_CODE');
    }
  }

  return createValidationResult(errors);
}

export function validateAlert(alert: Partial<Alert>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!alert.monitorId || alert.monitorId.trim().length === 0) {
    addError(errors, 'monitorId', 'Monitor ID is required', 'REQUIRED');
  }

  if (!alert.type) {
    addError(errors, 'type', 'Alert type is required', 'REQUIRED');
  } else {
    const validTypes = Object.values(AlertType);
    if (!validTypes.includes(alert.type)) {
      addError(errors, 'type', 'Invalid alert type', 'INVALID_ENUM');
    }
  }

  if (!alert.triggeredAt) {
    addError(errors, 'triggeredAt', 'Triggered timestamp is required', 'REQUIRED');
  } else if (!(alert.triggeredAt instanceof Date) || isNaN(alert.triggeredAt.getTime())) {
    addError(errors, 'triggeredAt', 'Valid triggered timestamp is required', 'INVALID_DATE');
  }

  if (alert.consecutiveFailures === undefined || alert.consecutiveFailures === null) {
    addError(errors, 'consecutiveFailures', 'Consecutive failures count is required', 'REQUIRED');
  } else if (!Number.isInteger(alert.consecutiveFailures) || alert.consecutiveFailures < 0) {
    addError(errors, 'consecutiveFailures', 'Consecutive failures must be a non-negative integer', 'INVALID_NUMBER');
  }

  if (!alert.message || alert.message.trim().length === 0) {
    addError(errors, 'message', 'Alert message is required', 'REQUIRED');
  }

  // Optional field validations
  if (alert.resolvedAt && (!(alert.resolvedAt instanceof Date) || isNaN(alert.resolvedAt.getTime()))) {
    addError(errors, 'resolvedAt', 'Valid resolved timestamp is required', 'INVALID_DATE');
  }

  return createValidationResult(errors);
}

export function validateTenant(tenant: Partial<Tenant>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!tenant.name || tenant.name.trim().length === 0) {
    addError(errors, 'name', 'Tenant name is required', 'REQUIRED');
  } else if (tenant.name.length > 255) {
    addError(errors, 'name', 'Tenant name must be 255 characters or less', 'MAX_LENGTH');
  }

  if (!tenant.createdAt) {
    addError(errors, 'createdAt', 'Created timestamp is required', 'REQUIRED');
  } else if (!(tenant.createdAt instanceof Date) || isNaN(tenant.createdAt.getTime())) {
    addError(errors, 'createdAt', 'Valid created timestamp is required', 'INVALID_DATE');
  }

  return createValidationResult(errors);
}

export function validateUptimeMetrics(metrics: Partial<UptimeMetrics>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!metrics.monitorId || metrics.monitorId.trim().length === 0) {
    addError(errors, 'monitorId', 'Monitor ID is required', 'REQUIRED');
  }

  if (!metrics.period) {
    addError(errors, 'period', 'Time period is required', 'REQUIRED');
  } else {
    const validPeriods = Object.values(TimePeriod);
    if (!validPeriods.includes(metrics.period)) {
      addError(errors, 'period', 'Invalid time period', 'INVALID_ENUM');
    }
  }

  if (metrics.totalChecks === undefined || metrics.totalChecks === null) {
    addError(errors, 'totalChecks', 'Total checks count is required', 'REQUIRED');
  } else if (!Number.isInteger(metrics.totalChecks) || metrics.totalChecks < 0) {
    addError(errors, 'totalChecks', 'Total checks must be a non-negative integer', 'INVALID_NUMBER');
  }

  if (metrics.successfulChecks === undefined || metrics.successfulChecks === null) {
    addError(errors, 'successfulChecks', 'Successful checks count is required', 'REQUIRED');
  } else if (!Number.isInteger(metrics.successfulChecks) || metrics.successfulChecks < 0) {
    addError(errors, 'successfulChecks', 'Successful checks must be a non-negative integer', 'INVALID_NUMBER');
  }

  if (metrics.uptimePercentage === undefined || metrics.uptimePercentage === null) {
    addError(errors, 'uptimePercentage', 'Uptime percentage is required', 'REQUIRED');
  } else if (typeof metrics.uptimePercentage !== 'number' || isNaN(metrics.uptimePercentage) || metrics.uptimePercentage < 0 || metrics.uptimePercentage > 100) {
    addError(errors, 'uptimePercentage', 'Uptime percentage must be a number between 0 and 100', 'OUT_OF_RANGE');
  }

  if (metrics.averageResponseTime === undefined || metrics.averageResponseTime === null) {
    addError(errors, 'averageResponseTime', 'Average response time is required', 'REQUIRED');
  } else if (typeof metrics.averageResponseTime !== 'number' || isNaN(metrics.averageResponseTime) || metrics.averageResponseTime < 0) {
    addError(errors, 'averageResponseTime', 'Average response time must be a non-negative number', 'INVALID_NUMBER');
  }

  // Cross-field validation
  if (metrics.totalChecks !== undefined && metrics.successfulChecks !== undefined) {
    if (metrics.successfulChecks > metrics.totalChecks) {
      addError(errors, 'successfulChecks', 'Successful checks cannot exceed total checks', 'LOGICAL_ERROR');
    }
  }

  // Optional field validations
  if (metrics.lastOutageDuration !== undefined) {
    if (typeof metrics.lastOutageDuration !== 'number' || isNaN(metrics.lastOutageDuration) || metrics.lastOutageDuration < 0) {
      addError(errors, 'lastOutageDuration', 'Last outage duration must be a non-negative number', 'INVALID_NUMBER');
    }
  }

  return createValidationResult(errors);
}

export function validateNotificationChannel(channel: Partial<NotificationChannel>): ValidationResult {
  const errors: ValidationError[] = [];

  // Required fields
  if (!channel.tenantId || channel.tenantId.trim().length === 0) {
    addError(errors, 'tenantId', 'Tenant ID is required', 'REQUIRED');
  }

  if (!channel.type) {
    addError(errors, 'type', 'Channel type is required', 'REQUIRED');
  } else {
    const validTypes = ['email', 'webhook', 'sms', 'voice'];
    if (!validTypes.includes(channel.type)) {
      addError(errors, 'type', 'Invalid channel type', 'INVALID_ENUM');
    }
  }

  if (!channel.configuration || typeof channel.configuration !== 'object') {
    addError(errors, 'configuration', 'Channel configuration is required', 'REQUIRED');
  } else {
    // Type-specific configuration validation
    if (channel.type === 'email') {
      const hasEnvSmtp = !!(process.env['SMTP_HOST'] && process.env['SMTP_PORT'] && process.env['SMTP_FROM'] && process.env['SMTP_USER'] && process.env['SMTP_PASS']);
      const smtpHost = channel.configuration['smtpHost'] || channel.configuration['host'];
      const smtpPort = channel.configuration['smtpPort'] || channel.configuration['port'];
      const fromEmail = channel.configuration['fromEmail'] || channel.configuration['from'];
      const toEmail = channel.configuration['to'] || channel.configuration['recipients'];

      if (!hasEnvSmtp && (!smtpHost || !smtpPort || !fromEmail)) {
        addError(errors, 'configuration', 'Email configuration requires SMTP host, port, and from address (or set SMTP_* env)', 'MISSING_CONFIG');
      }
      if (fromEmail && !isValidEmail(fromEmail)) {
        addError(errors, 'configuration.from', 'Invalid from email address', 'INVALID_EMAIL');
      }
      if (toEmail) {
        const list = Array.isArray(toEmail) ? toEmail : toEmail.toString().split(',').map((item: string) => item.trim());
        const invalid = list.find((addr: string) => addr && !isValidEmail(addr));
        if (invalid) {
          addError(errors, 'configuration.to', 'Invalid recipient email address', 'INVALID_EMAIL');
        }
      }
    } else if (channel.type === 'webhook') {
      if (!channel.configuration['url'] || !isValidUrl(channel.configuration['url'])) {
        addError(errors, 'configuration.url', 'Valid webhook URL is required', 'INVALID_URL');
      }
    }
  }

  return createValidationResult(errors);
}

export function validateCreateNotificationChannelRequest(request: CreateNotificationChannelRequest): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate as notification channel first
  const channelValidation = validateNotificationChannel(request);
  errors.push(...channelValidation.errors);

  return createValidationResult(errors);
}
