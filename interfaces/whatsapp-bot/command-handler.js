'use strict';

const NotificationTemplates = require('./notification-templates');
const ScheduleHandler = require('./handlers/schedule-handler');

class CommandHandler {
  /**
   * @param {Object} options
   * @param {Object} options.engine - Composed engine from createEngine()
   * @param {Object} options.notifier - NotificationAdapter for sending responses
   * @param {string} options.defaultAppId - Default app to target
   */
  constructor({ engine, notifier, scheduler, defaultAppId = 'brainstormy' }) {
    if (!engine) throw new Error('CommandHandler requires engine');
    if (!notifier) throw new Error('CommandHandler requires notifier');

    this.engine = engine;
    this.notifier = notifier;
    this.defaultAppId = defaultAppId;
    this.scheduleHandler = scheduler ? new ScheduleHandler(scheduler) : null;
  }

  /**
   * Route a parsed command to the appropriate handler.
   * @param {ParsedCommand} command
   * @param {InboundMessage} message
   * @returns {Promise<CommandResult>}
   */
  async handle(command, message) {
    try {
      switch (command.type) {
        case 'run':
          return await this.handleRun(command.params, message);
        case 'status':
          return await this.handleStatus(message);
        case 'bugs':
          return await this.handleBugs(command.params, message);
        case 'approve':
          return await this.handleApprove(command.params, message);
        case 'reject':
          return await this.handleReject(command.params, message);
        case 'info':
          return await this.handleInfo(command.params, message);
        case 'schedule':
          return await this.handleSchedule(command.params, message);
        case 'help':
          return await this.handleHelp(message);
        case 'unknown':
        default:
          return await this.handleUnknown(command.params, message);
      }
    } catch (error) {
      // Send error notification to user
      await this.notifier.send(
        message.from,
        NotificationTemplates.internalError()
      );
      return {
        success: false,
        message: `Error handling ${command.type}: ${error.message}`
      };
    }
  }

  /**
   * Handle 'run' — send ack immediately, kick off async test run.
   */
  async handleRun(params, message) {
    const { mode, agents } = params;

    // Send immediate acknowledgment
    const ackMessage = NotificationTemplates.runAcknowledgment({
      mode,
      agents,
      appId: this.defaultAppId
    });
    await this.notifier.send(message.from, ackMessage);

    // Kick off test run asynchronously (don't await completion)
    const runOptions = {
      ...(mode && { mode }),
      ...(agents.length > 0 && { agents })
    };

    // Fire and forget — engine sends completion notification via its own notifier
    // engine.run() takes (appId, options) as two separate parameters
    this.engine.run(this.defaultAppId, runOptions).catch(error => {
      // On unexpected failure, notify user
      this.notifier.send(
        message.from,
        `⚠️ Test run failed to start: ${error.message}`
      ).catch(() => {}); // Swallow notification send failure
    });

    return {
      success: true,
      message: ackMessage
    };
  }

  /**
   * Handle 'status' — query engine and send formatted response.
   */
  async handleStatus(message) {
    const status = await this.engine.status();
    const responseMessage = NotificationTemplates.statusReport(status);
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: status };
  }

  /**
   * Handle 'bugs' — query engine with status filter and send list.
   */
  async handleBugs(params, message) {
    // engine.bugs() takes (appId, options) as two separate parameters
    const bugs = await this.engine.bugs(this.defaultAppId, {
      status: params.status
    });
    const responseMessage = NotificationTemplates.bugsList(bugs, params.status);
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: bugs };
  }

  /**
   * Handle 'approve' — route YES to Approval Manager.
   * engine.approve() returns { action: 'approved', ... } on success,
   * or { action: 'error', message } if not found / already responded / timed out.
   */
  async handleApprove(params, message) {
    const result = await this.engine.approve(params.approvalId);
    if (result.action !== 'approved') {
      const errorMsg = `⚠️ ${result.message || 'Could not approve: ' + params.approvalId}`;
      await this.notifier.send(message.from, errorMsg);
      return { success: false, message: errorMsg, data: result };
    }
    const responseMessage = NotificationTemplates.approvalConfirmation(
      params.approvalId,
      'approved'
    );
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: result };
  }

  /**
   * Handle 'reject' — route NO to Approval Manager.
   * engine.reject() returns { action: 'rejected', ... } on success,
   * or { action: 'error', message } if not found / already responded / timed out.
   */
  async handleReject(params, message) {
    const result = await this.engine.reject(params.approvalId);
    if (result.action !== 'rejected') {
      const errorMsg = `⚠️ ${result.message || 'Could not reject: ' + params.approvalId}`;
      await this.notifier.send(message.from, errorMsg);
      return { success: false, message: errorMsg, data: result };
    }
    const responseMessage = NotificationTemplates.approvalConfirmation(
      params.approvalId,
      'rejected'
    );
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: result };
  }

  /**
   * Handle 'info' — fetch and send detailed bug info.
   * engine.bugInfo() delegates to ApprovalManager.handleResponse('INFO-...'),
   * which returns { action, approval_id, message, bug, approval } on success,
   * or { action: 'error', message } on failure.
   */
  async handleInfo(params, message) {
    const result = await this.engine.bugInfo(params.approvalId);
    if (result.action === 'error' || !result.bug) {
      const notFoundMsg = `❓ ${result.message || 'No bug found for approval ID: ' + params.approvalId}`;
      await this.notifier.send(message.from, notFoundMsg);
      return { success: false, message: notFoundMsg };
    }
    const responseMessage = NotificationTemplates.bugDetail(result.bug);
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage, data: result.bug };
  }

  /**
   * Handle 'schedule' — delegate to ScheduleHandler.
   */
  async handleSchedule(params, message) {
    if (!this.scheduleHandler) {
      const msg = '⚠️ Scheduler not configured.';
      await this.notifier.send(message.from, msg);
      return { success: false, message: msg };
    }

    const result = await this.scheduleHandler.handle(params.originalText);
    await this.notifier.send(message.from, result.text);
    return { success: true, message: result.text };
  }

  /**
   * Handle 'help' — send command menu.
   */
  async handleHelp(message) {
    const responseMessage = NotificationTemplates.helpMenu();
    await this.notifier.send(message.from, responseMessage);
    return { success: true, message: responseMessage };
  }

  /**
   * Handle 'unknown' — send help prompt.
   */
  async handleUnknown(params, message) {
    const responseMessage = NotificationTemplates.unknownCommand(
      params.originalText || ''
    );
    await this.notifier.send(message.from, responseMessage);
    return { success: false, message: responseMessage };
  }
}

module.exports = CommandHandler;
