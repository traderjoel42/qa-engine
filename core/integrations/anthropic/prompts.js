'use strict';

function bugAnalysisPrompt({ appName, agentId, testName, scenarioName, failedStep, errorMessage, consoleErrors, networkFailures, screenshotPath }) {
  return `
You are analyzing a test failure for ${appName}.

TEST INFORMATION:
- Agent: ${agentId}
- Test: ${testName}
- Scenario: ${scenarioName}
- Step that failed: ${failedStep}

ERROR:
${errorMessage}

EVIDENCE:
- Console errors: ${consoleErrors}
- Network failures: ${networkFailures}
${screenshotPath ? `- Screenshot: ${screenshotPath}` : ''}

Analyze and respond with ONLY valid JSON (no markdown, no explanation):
{
  "root_cause": "what actually broke",
  "affected_component": "which part of the app",
  "likely_location": "file/function if determinable, or 'unknown'",
  "impact": "high|medium|low",
  "fix_approach": "high-level strategy to fix",
  "related_bugs": []
}`.trim();
}

function fixGenerationPrompt({ appName, bugTitle, rootCause, affectedComponent, likelyLocation, fixApproach, relevantCode }) {
  return `
You are fixing a bug in ${appName}.

BUG: ${bugTitle}
ROOT CAUSE: ${rootCause}
AFFECTED COMPONENT: ${affectedComponent}
LIKELY LOCATION: ${likelyLocation}
FIX APPROACH: ${fixApproach}

RELEVANT CODE:
${relevantCode}

CONSTRAINTS:
- Make minimal changes
- Don't break existing functionality
- Add comments explaining the fix
- Include a regression test

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "files_to_modify": [
    {
      "path": "...",
      "changes": [
        {
          "type": "replace|insert|delete",
          "line": 123,
          "old_code": "...",
          "new_code": "..."
        }
      ]
    }
  ],
  "regression_test": {
    "file": "...",
    "test_code": "..."
  },
  "explanation": "..."
}`.trim();
}

function bugClassificationPrompt({ errorMessage, rootCause, affectedComponent }) {
  return `
Classify this bug based on the information provided.

ERROR: ${errorMessage}
ROOT CAUSE: ${rootCause}
AFFECTED COMPONENT: ${affectedComponent}

Respond with ONLY valid JSON:
{
  "severity": "critical|high|medium|low",
  "category": "memory|data-accuracy|ui|backend|performance|other",
  "confidence": 0.0-1.0
}`.trim();
}

module.exports = {
  bugAnalysisPrompt,
  fixGenerationPrompt,
  bugClassificationPrompt
};
