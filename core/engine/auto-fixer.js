'use strict';

const { FixError } = require('./errors');

/**
 * Dangerous patterns that auto-fixes must never contain.
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM\s+users/i,
  /TRUNCATE\s+TABLE/i,
  /system\s*\(/,
  /exec\s*\(/,
  /eval\s*\(/,
  /Function\s*\(/,
  /child_process/,
  /\.env/,
  /process\.env\./,
  /secret|password|token|api_key/i
];

/**
 * Maximum number of individual changes allowed in an auto-fix.
 */
const MAX_CHANGES = 10;

class AutoFixer {
  /**
   * @param {Object} options
   * @param {import('../integrations/adapters/llm')} options.llm - LLM adapter for fix generation
   * @param {Object} [options.codeExecutor] - Code execution interface { applyChanges, rollback, createBranch }
   * @param {Object} [options.testRunner] - Test runner interface { runTest, runSuite }
   * @param {Object} [options.storage] - Storage interface { saveFix, updateFix }
   * @param {Object} [options.bugTracker] - Bug tracker for status updates
   * @param {import('../integrations/adapters/notification')} [options.notifier] - For success/failure notifications
   */
  constructor(options = {}) {
    if (!options.llm) {
      throw new FixError('AutoFixer requires options.llm adapter', {
        phase: 'construction'
      });
    }

    this._llm = options.llm;
    this._bugTracker = options.bugTracker || null;
    this._notifier = options.notifier || null;

    // Code executor with no-op defaults (Phase 1: no real file ops)
    this._codeExecutor = options.codeExecutor || {
      createBranch: async (name) => ({ name, created: true }),
      applyChanges: async (changes) => ({ applied: true, filesModified: changes.length }),
      rollback: async () => ({ rolledBack: true })
    };

    // Test runner with no-op defaults
    this._testRunner = options.testRunner || {
      runTest: async (testId) => ({ passed: true, details: 'No-op test runner' }),
      runSuite: async (suiteId) => ({ passed: true, total: 0, failures: 0 })
    };

    // Storage with no-op defaults
    this._storage = options.storage || {
      saveFix: async (fix) => fix,
      updateFix: async (id, updates) => ({ id, ...updates })
    };
  }

  /**
   * Full fix workflow: verify approval → generate → safety review → apply → verify → report.
   *
   * @param {Object} app - App configuration
   * @param {Object} bug - BugRecord
   * @param {Object} approval - ApprovalRecord (must have status 'approved')
   * @returns {Promise<Object>} FixResult
   */
  async generateAndApplyFix(app, bug, approval) {
    if (!app) {
      throw new FixError('generateAndApplyFix requires app config', { phase: 'generation' });
    }
    if (!bug) {
      throw new FixError('generateAndApplyFix requires bug record', { phase: 'generation' });
    }
    if (!approval) {
      throw new FixError('generateAndApplyFix requires approval record', { phase: 'generation' });
    }

    const startedAt = new Date().toISOString();

    // 1. Verify approval status
    if (approval.status !== 'approved') {
      throw new FixError(`Fix not approved. Current status: ${approval.status}`, {
        phase: 'generation',
        bugId: bug.bug_id
      });
    }

    // Save fix tracking record
    const fixRecord = {
      id: `fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      bug_id: bug.bug_id,
      status: 'in-progress',
      started_at: startedAt
    };
    await this._storage.saveFix(fixRecord);

    try {
      // 2. Load bug context
      const context = await this.loadBugContext(bug);

      // 3. Generate fix via LLM
      let fix;
      try {
        fix = await this.generateFix(app, bug, context);
      } catch (err) {
        await this._storage.updateFix(fixRecord.id, { status: 'failed', error: err.message });
        return this._buildFixResult('failed', null, null, null, bug.bug_id, startedAt, `Fix generation failed: ${err.message}`);
      }

      // 4. Safety review
      const safetyCheck = this.reviewFix(bug, fix);
      if (!safetyCheck.safe) {
        await this._storage.updateFix(fixRecord.id, { status: 'safety-rejected', reason: safetyCheck.reason });
        return this._buildFixResult('safety-rejected', fix, safetyCheck, null, bug.bug_id, startedAt, `Safety review failed: ${safetyCheck.reason}`);
      }

      // 5. Apply fix
      try {
        await this._codeExecutor.createBranch(`auto-fix/${bug.bug_id}`);
        await this.applyFix(app, fix);
      } catch (err) {
        await this._storage.updateFix(fixRecord.id, { status: 'apply-error', error: err.message });
        await this.rollbackFix(app, fix);
        return this._buildFixResult('apply-error', fix, safetyCheck, null, bug.bug_id, startedAt, `Fix application failed: ${err.message}`);
      }

      // 6. Verify fix
      let verification;
      try {
        verification = await this.verifyFix(app, bug);
      } catch (err) {
        await this.rollbackFix(app, fix);
        await this._storage.updateFix(fixRecord.id, { status: 'verify-failed', error: err.message });
        return this._buildFixResult('verify-failed', fix, safetyCheck, null, bug.bug_id, startedAt, `Verification failed: ${err.message}`);
      }

      // 7. Handle verification result
      if (verification.passed) {
        await this._storage.updateFix(fixRecord.id, {
          status: 'verified',
          fix_data: fix,
          verification_result: verification,
          completed_at: new Date().toISOString()
        });

        return this._buildFixResult('verified', fix, safetyCheck, verification, bug.bug_id, startedAt, fix.explanation);
      } else {
        // Verification failed — rollback
        await this.rollbackFix(app, fix);
        await this._storage.updateFix(fixRecord.id, {
          status: 'rolled-back',
          verification_result: verification,
          completed_at: new Date().toISOString()
        });

        return this._buildFixResult('rolled-back', fix, safetyCheck, verification, bug.bug_id, startedAt, 'Fix applied but verification failed — rolled back');
      }

    } catch (err) {
      // Unexpected error — ensure cleanup
      await this._storage.updateFix(fixRecord.id, { status: 'failed', error: err.message });
      try { await this.rollbackFix(app, {}); } catch (_) { /* best effort */ }
      throw new FixError(`Auto-fix failed unexpectedly: ${err.message}`, {
        phase: 'unknown',
        bugId: bug.bug_id,
        details: { originalError: err.message }
      });
    }
  }

  /**
   * Generate a fix plan via LLM.
   */
  async generateFix(app, bug, context) {
    const prompt = this._buildFixPrompt(app, bug, context);

    const response = await this._llm.complete(prompt, {
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 2048,
      temperature: 0.1,
      systemPrompt: 'You are a senior developer fixing a bug. Return your fix as valid JSON only, with no markdown fencing or extra text. Make minimal, targeted changes.'
    });

    return this._parseFixResponse(response.content);
  }

  /**
   * Static safety review of a fix plan.
   * Returns { safe: boolean, reason: string|null }.
   */
  reviewFix(bug, fix) {
    if (!fix || !fix.files_to_modify || !Array.isArray(fix.files_to_modify)) {
      return { safe: false, reason: 'Fix has no files_to_modify array' };
    }

    // Check 1: Files are within allowed paths
    const allowedPaths = this.getAllowedPathsForBug(bug);
    for (const file of fix.files_to_modify) {
      if (!this._isPathAllowed(file.path, allowedPaths)) {
        return { safe: false, reason: `Fix modifies unexpected file: ${file.path}` };
      }
    }

    // Check 2: No dangerous patterns in new code
    for (const file of fix.files_to_modify) {
      for (const change of (file.changes || [])) {
        const newCode = change.new_code || '';
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(newCode)) {
            return { safe: false, reason: `Dangerous pattern detected in ${file.path}: ${pattern}` };
          }
        }
      }
    }

    // Check 3: Reasonable change count
    const totalChanges = fix.files_to_modify.reduce(
      (sum, f) => sum + (f.changes || []).length,
      0
    );

    if (totalChanges > MAX_CHANGES) {
      return { safe: false, reason: `Too many changes for auto-fix: ${totalChanges} (max ${MAX_CHANGES})` };
    }

    // Check 4: At least one change
    if (totalChanges === 0) {
      return { safe: false, reason: 'Fix contains no changes' };
    }

    return { safe: true, reason: null };
  }

  /**
   * Apply a fix plan via the code executor.
   */
  async applyFix(app, fix) {
    const changes = [];

    for (const file of fix.files_to_modify) {
      for (const change of (file.changes || [])) {
        changes.push({
          file: file.path,
          type: change.type,
          line: change.line,
          old_code: change.old_code,
          new_code: change.new_code
        });
      }
    }

    // Apply regression test if present
    if (fix.regression_test) {
      changes.push({
        file: fix.regression_test.file,
        type: 'insert',
        new_code: fix.regression_test.test_code
      });
    }

    return await this._codeExecutor.applyChanges(changes);
  }

  /**
   * Verify the fix by re-running the original failing test.
   */
  async verifyFix(app, bug) {
    // Run the original failing test
    const originalResult = await this._testRunner.runTest(bug.evidence?.test_id || bug.test_name);

    // Run regression suite (healer agent tests)
    const regressionResult = await this._testRunner.runSuite('healer-regression');

    return {
      passed: originalResult.passed && regressionResult.passed,
      originalTest: originalResult,
      regressionTests: regressionResult
    };
  }

  /**
   * Rollback a fix via the code executor.
   */
  async rollbackFix(app, fix) {
    try {
      await this._codeExecutor.rollback();
    } catch (err) {
      throw new FixError(`Rollback failed: ${err.message}`, {
        phase: 'rollback',
        details: { originalError: err.message }
      });
    }
  }

  /**
   * Load code context around the bug's likely location.
   * In Phase 1, this returns a stub — real implementation needs file system access.
   */
  async loadBugContext(bug) {
    const location = bug.likely_location || 'unknown';
    const filePath = location.includes(':') ? location.split(':')[0] : location;

    return {
      relevant_code: `// Code around ${location} would be loaded here in production`,
      file_path: filePath,
      surrounding_files: [],
      language: this._detectLanguage(filePath)
    };
  }

  /**
   * Determine which file paths are allowed for modification based on bug category.
   */
  getAllowedPathsForBug(bug) {
    const basePaths = ['src/', 'lib/', 'services/', 'config/', 'backend/', 'frontend/'];
    const categoryPaths = {
      'memory': ['services/', 'src/memory/', 'src/search/', 'backend/services/', 'config/'],
      'data-accuracy': ['services/', 'src/citations/', 'src/bible/', 'backend/services/', 'config/'],
      'ui': ['frontend/', 'src/components/', 'src/pages/', 'public/'],
      'backend': ['backend/', 'services/', 'src/', 'lib/'],
      'performance': ['services/', 'src/', 'backend/', 'config/']
    };

    return categoryPaths[bug.category] || basePaths;
  }

  // --- Private helpers ---

  _buildFixPrompt(app, bug, context) {
    const appName = app.name || app.id || 'Application';

    return `You are fixing a bug in ${appName}.

BUG INFORMATION:
- Bug ID: ${bug.bug_id}
- Title: ${bug.title}
- Root cause: ${bug.root_cause}
- Affected component: ${bug.affected_component}
- Likely location: ${bug.likely_location}
- Fix approach: ${bug.fix_approach}

RELEVANT CODE:
${context.relevant_code}

CONSTRAINTS:
- Make minimal changes (as few files and lines as possible)
- Don't break existing functionality
- Add comments explaining the fix
- Include a regression test if possible

Return JSON (no markdown fencing):
{
  "files_to_modify": [
    {
      "path": "file/path.ext",
      "changes": [
        {
          "type": "replace",
          "line": 42,
          "old_code": "original code",
          "new_code": "fixed code"
        }
      ]
    }
  ],
  "regression_test": {
    "file": "tests/test_file.ext",
    "test_code": "test function code"
  },
  "explanation": "Brief explanation of the fix"
}`;
  }

  _parseFixResponse(content) {
    let jsonStr = content.trim();

    // Strip markdown code fences
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate structure
      if (!parsed.files_to_modify || !Array.isArray(parsed.files_to_modify)) {
        throw new Error('Missing or invalid files_to_modify array');
      }

      return {
        files_to_modify: parsed.files_to_modify.map(f => ({
          path: f.path,
          changes: (f.changes || []).map(c => ({
            type: c.type || 'replace',
            line: c.line || 0,
            old_code: c.old_code || '',
            new_code: c.new_code || ''
          }))
        })),
        regression_test: parsed.regression_test || null,
        explanation: parsed.explanation || 'No explanation provided'
      };
    } catch (err) {
      throw new FixError(`Failed to parse fix response: ${err.message}`, {
        phase: 'generation',
        details: { raw: content.substring(0, 500) }
      });
    }
  }

  _isPathAllowed(path, allowedPaths) {
    if (!path) return false;
    return allowedPaths.some(allowed => path.startsWith(allowed));
  }

  _detectLanguage(filePath) {
    if (!filePath) return 'unknown';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.js')) return 'javascript';
    if (filePath.endsWith('.ts')) return 'typescript';
    if (filePath.endsWith('.jsx') || filePath.endsWith('.tsx')) return 'react';
    return 'unknown';
  }

  _buildFixResult(status, fix, safetyCheck, verification, bugId, startedAt, explanation) {
    return {
      status,
      fix: fix || null,
      safetyCheck: safetyCheck || null,
      verification: verification || null,
      bugId,
      startedAt,
      completedAt: new Date().toISOString(),
      explanation
    };
  }
}

module.exports = AutoFixer;
