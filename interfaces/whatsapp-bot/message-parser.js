'use strict';

const KNOWN_MODES = ['smoke', 'full', 'regression'];
const KNOWN_AGENTS = ['healer', 'sentinel', 'librarian', 'quinn'];

class MessageParser {
  /**
   * Parse a raw message body into a structured command.
   * Checks patterns in priority order: approval > help > status > bugs > run > unknown.
   * @param {string} body - Raw message text
   * @returns {ParsedCommand}
   */
  parse(body) {
    if (!body || typeof body !== 'string') {
      return { type: 'unknown', params: { originalText: '' } };
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return { type: 'unknown', params: { originalText: '' } };
    }

    // 1. Approval responses (highest priority)
    const approval = this.parseApprovalResponse(trimmed);
    if (approval) {
      const typeMap = { 'YES': 'approve', 'NO': 'reject', 'INFO': 'info' };
      return {
        type: typeMap[approval.action],
        params: { approvalId: approval.approvalId }
      };
    }

    // 2. Help
    if (this.isHelpRequest(trimmed)) {
      return { type: 'help', params: {} };
    }

    // 3. Status
    if (this.isStatusQuery(trimmed)) {
      return { type: 'status', params: {} };
    }

    // 4. Bugs
    const bugs = this.parseBugsQuery(trimmed);
    if (bugs) {
      return { type: 'bugs', params: bugs };
    }

    // 5. Run
    const run = this.parseRunCommand(trimmed);
    if (run) {
      return { type: 'run', params: run };
    }

    // 6. Unknown
    return { type: 'unknown', params: { originalText: trimmed } };
  }

  /**
   * Check if a message is an approval response.
   * Format: YES-ABC-247, NO-ABC-247, INFO-ABC-247 (case-insensitive)
   * @param {string} body
   * @returns {{action: 'YES'|'NO'|'INFO', approvalId: string}|null}
   */
  parseApprovalResponse(body) {
    const match = body.match(/^(YES|NO|INFO)-([A-Z]{3}-\d+)$/i);
    if (!match) return null;
    return {
      action: match[1].toUpperCase(),
      approvalId: match[2].toUpperCase()
    };
  }

  /**
   * Check if a message is a run/test command. Extracts mode and agents.
   * @param {string} body
   * @returns {{mode: string|null, agents: string[]}|null}
   */
  parseRunCommand(body) {
    const match = body.trim().match(/^(?:run|test)(?:\s+(.+))?$/i);
    if (!match) return null;

    const args = match[1] ? match[1].toLowerCase().split(/\s+/) : [];

    let mode = null;
    const agents = [];

    for (const arg of args) {
      // Strip trailing "tests" (e.g., "smoke tests" → "smoke")
      const cleaned = arg.replace(/\s*tests?$/i, '');
      if (KNOWN_MODES.includes(cleaned)) {
        mode = cleaned;
      } else if (KNOWN_AGENTS.includes(cleaned)) {
        agents.push(cleaned);
      }
      // Ignore unrecognized args (e.g., "tests" as standalone word)
    }

    return { mode, agents };
  }

  /**
   * Check if a message is a status query.
   * @param {string} body
   * @returns {boolean}
   */
  isStatusQuery(body) {
    return /^(?:status|what'?s?\s+running\??|progress)$/i.test(body);
  }

  /**
   * Check if a message is a bugs query. Returns status filter.
   * @param {string} body
   * @returns {{status: string}|null}
   */
  parseBugsQuery(body) {
    const match = body.match(/^(?:(open|fixed|all)\s+)?(?:bugs|what\s+failed\??)$/i);
    if (!match) return null;
    return { status: match[1] ? match[1].toLowerCase() : 'open' };
  }

  /**
   * Check if a message is a help request.
   * @param {string} body
   * @returns {boolean}
   */
  isHelpRequest(body) {
    return /^(?:help|commands|\?|menu)$/i.test(body);
  }
}

module.exports = MessageParser;
