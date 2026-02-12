'use strict';

class EngineError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'ENGINE_ERROR';
    this.details = options.details || {};
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

class BugDetectorError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'BUG_DETECTOR_ERROR', ...options });
    this.phase = options.phase || 'unknown'; // 'evidence', 'analysis', 'classification', 'issue_creation', 'approval'
    this.bugContext = options.bugContext || null;
  }
}

class FixError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'FIX_ERROR', ...options });
    this.phase = options.phase || 'unknown'; // 'generation', 'safety_review', 'application', 'verification', 'rollback'
    this.bugId = options.bugId || null;
  }
}

class ApprovalError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'APPROVAL_ERROR', ...options });
    this.approvalId = options.approvalId || null;
  }
}

class AdapterError extends EngineError {
  constructor(message, options = {}) {
    super(message, { code: 'ADAPTER_ERROR', ...options });
    this.adapterType = options.adapterType || 'unknown'; // 'bug_tracker', 'notification', 'llm'
    this.operation = options.operation || null;
  }
}

module.exports = {
  EngineError,
  BugDetectorError,
  FixError,
  ApprovalError,
  AdapterError
};
