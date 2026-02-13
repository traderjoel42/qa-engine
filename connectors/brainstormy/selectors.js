'use strict';

/**
 * Default selectors for Brainstormy UI elements.
 * These serve as fallback values when not specified in app.config.json.
 * Keys use camelCase to match the existing connector.config.selectors convention.
 * Ordered by priority: data-testid > role/aria > CSS class.
 */
const DEFAULT_SELECTORS = {
  // Clerk Authentication
  clerkEmailInput: 'input[name="identifier"], input[type="email"]',
  clerkPasswordInput: 'input[name="password"], input[type="password"]',
  clerkSubmitButton: 'button[data-localization-key="formButtonPrimary"], button[type="submit"]',

  // Auth state
  userMenu: '[data-testid="user-menu"], [data-testid="user-button"]',
  logoutButton: '[data-testid="logout-button"], button:has-text("Sign out")',

  // Navigation
  sidebarProjects: '[data-testid="sidebar-projects"], a[href="/projects"]',
  storySidebarItem: '[data-testid="story-nav-item"], .sidebar-story-link',

  // Project CRUD
  newProjectButton: '[data-testid="new-project-button"], button:has-text("New Project")',
  projectNameInput: '[data-testid="project-name-input"], input[name="project-name"]',
  createProjectSubmit: '[data-testid="create-project-button"], button[type="submit"]',

  // Story CRUD
  newStoryButton: '[data-testid="new-story-button"], button:has-text("New Story")',
  storyNameInput: '[data-testid="story-name-input"], input[name="story-name"]',
  storyVerticalSelect: '[data-testid="story-vertical-select"], select[name="vertical"]',
  createStorySubmit: '[data-testid="create-story-button"], button[type="submit"]',

  // Session CRUD
  newSessionButton: '[data-testid="new-session-button"], button:has-text("New Session")',
  sessionTypeSelect: '[data-testid="session-type-select"], select[name="session-type"]',
  createSessionSubmit: '[data-testid="create-session-button"], button[type="submit"]',
  sessionList: '[data-testid="session-list"], .session-list',
  sessionItem: '[data-testid="session-item"], .session-list-item',
  endSessionButton: '[data-testid="end-session-button"], button:has-text("End Session")',

  // Chat
  chatInput: '[data-testid="chat-input"], textarea[placeholder*="message"]',
  chatSend: '[data-testid="send-button"], button[aria-label="Send"]',
  aiMessage: '[data-testid="ai-message"], .message-assistant',
  userMessage: '[data-testid="user-message"], .message-user',
  generatingIndicator: '[data-testid="generating"], .streaming-indicator',

  // Search
  searchInput: '[data-testid="search-input"], input[placeholder*="Search"]',
  searchSubmit: '[data-testid="search-submit"]',
  searchResults: '[data-testid="search-results"], .search-results',
  searchResultItem: '[data-testid="search-result-item"], .search-result',

  // Bible
  bibleTab: '[data-testid="bible-tab"], a[href*="bible"], button:has-text("Story Bible")',
  bibleTemplateSelect: '[data-testid="bible-template-select"], select[name="template"]',
  bibleGenerateButton: '[data-testid="bible-generate"], button:has-text("Generate")',
  bibleSection: '[data-testid="bible-section"], .bible-section',
  bibleGeneratingIndicator: '[data-testid="bible-generating"], .bible-progress',

  // Reports
  reportTab: '[data-testid="report-tab"], a[href*="reports"]',
  reportTypeSelect: '[data-testid="report-type-select"], select[name="report-type"]',
  reportGenerateButton: '[data-testid="report-generate"], button:has-text("Generate")',
  reportContent: '[data-testid="report-content"], .report-content',
  reportCitation: '[data-citation-id], .citation-link',

  // Bookmarks
  bookmarkButton: '[data-testid="bookmark-button"], button[aria-label="Bookmark"]',
  bookmarkTitleInput: '[data-testid="bookmark-title-input"], input[name="bookmark-title"]',
  bookmarkSaveButton: '[data-testid="bookmark-save"], button:has-text("Save")',
  bookmarksTab: '[data-testid="bookmarks-tab"], a[href*="bookmarks"]',
  bookmarkItem: '[data-testid="bookmark-item"], .bookmark-list-item',

  // Session summary
  sessionSummaryButton: '[data-testid="session-summary-button"], button:has-text("Summary")',
  sessionSummaryContent: '[data-testid="session-summary"], .session-summary-content',

  // App state
  readyIndicator: '[data-testid="app-loaded"], #app-root'
};

module.exports = DEFAULT_SELECTORS;
