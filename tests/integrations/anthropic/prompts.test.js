'use strict';

const { bugAnalysisPrompt, fixGenerationPrompt, bugClassificationPrompt } = require('../../../core/integrations/anthropic/prompts');

describe('Prompt Templates', () => {
  describe('bugAnalysisPrompt', () => {
    const defaultParams = {
      appName: 'Brainstormy',
      agentId: 'sentinel',
      testName: 'Login Test',
      scenarioName: 'Happy Path',
      failedStep: 'Click submit button',
      errorMessage: 'Element not found: #submit-btn',
      consoleErrors: '2 errors',
      networkFailures: '1 failure',
      screenshotPath: '/evidence/screenshot.png'
    };

    it('includes appName in output', () => {
      const result = bugAnalysisPrompt(defaultParams);
      expect(result).toContain('Brainstormy');
    });

    it('includes agentId, testName, scenarioName', () => {
      const result = bugAnalysisPrompt(defaultParams);
      expect(result).toContain('sentinel');
      expect(result).toContain('Login Test');
      expect(result).toContain('Happy Path');
    });

    it('includes errorMessage', () => {
      const result = bugAnalysisPrompt(defaultParams);
      expect(result).toContain('Element not found: #submit-btn');
    });

    it('includes console error count', () => {
      const result = bugAnalysisPrompt(defaultParams);
      expect(result).toContain('2 errors');
    });

    it('includes network failure count', () => {
      const result = bugAnalysisPrompt(defaultParams);
      expect(result).toContain('1 failure');
    });

    it('omits screenshot line when screenshotPath is null/undefined', () => {
      const result = bugAnalysisPrompt({ ...defaultParams, screenshotPath: null });
      expect(result).not.toContain('Screenshot:');
    });
  });

  describe('fixGenerationPrompt', () => {
    const defaultParams = {
      appName: 'Brainstormy',
      bugTitle: 'Submit button not found',
      rootCause: 'ID changed in recent refactor',
      affectedComponent: 'Login form',
      likelyLocation: 'src/components/LoginForm.js',
      fixApproach: 'Update selector to match new ID',
      relevantCode: 'const btn = document.getElementById("submit-btn");'
    };

    it('includes bug title and root cause', () => {
      const result = fixGenerationPrompt(defaultParams);
      expect(result).toContain('Submit button not found');
      expect(result).toContain('ID changed in recent refactor');
    });

    it('includes relevant code', () => {
      const result = fixGenerationPrompt(defaultParams);
      expect(result).toContain('document.getElementById("submit-btn")');
    });

    it('includes constraints section', () => {
      const result = fixGenerationPrompt(defaultParams);
      expect(result).toContain('Make minimal changes');
      expect(result).toContain('regression test');
    });

    it('produces valid prompt structure', () => {
      const result = fixGenerationPrompt(defaultParams);
      expect(result).toContain('ONLY valid JSON');
      expect(result).toContain('files_to_modify');
    });
  });

  describe('bugClassificationPrompt', () => {
    const defaultParams = {
      errorMessage: 'TypeError: Cannot read property',
      rootCause: 'Null reference in data processing',
      affectedComponent: 'Data pipeline'
    };

    it('includes error message', () => {
      const result = bugClassificationPrompt(defaultParams);
      expect(result).toContain('TypeError: Cannot read property');
    });

    it('includes root cause and affected component', () => {
      const result = bugClassificationPrompt(defaultParams);
      expect(result).toContain('Null reference in data processing');
      expect(result).toContain('Data pipeline');
    });

    it('requests JSON-only response', () => {
      const result = bugClassificationPrompt(defaultParams);
      expect(result).toContain('ONLY valid JSON');
    });
  });
});
