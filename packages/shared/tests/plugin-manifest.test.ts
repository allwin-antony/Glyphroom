import { describe, it, expect } from 'vitest';
import {
  PluginManifestSchema,
  validatePluginManifest,
  isValidPluginId,
  PluginSlashCommandSchema,
  CORE_SLASH_COMMAND_IDS,
  PluginStorageScopeSchema,
  PluginStorageKeySchema,
  PluginEventTypeSchema,
} from '../src/plugins/index.js';

describe('Phase 0: Plugin Manifest & Shared Contracts Suite', () => {
  describe('PluginManifestSchema & Validation', () => {
    it('accepts a valid plugin manifest', () => {
      const valid = {
        id: 'slack-notifier',
        name: 'Slack Notifier',
        version: '1.0.0',
        description: 'Sends notifications to Slack on post publication',
        author: 'Enterprise Team',
        capabilities: ['api:events', 'api:storage'],
      };

      const result = validatePluginManifest(valid);
      expect(result.id).toBe('slack-notifier');
      expect(result.version).toBe('1.0.0');
      expect(result.capabilities).toHaveLength(2);
    });

    it('rejects invalid plugin IDs (uppercase, symbols, spaces)', () => {
      expect(isValidPluginId('valid-plugin-id-123')).toBe(true);
      expect(isValidPluginId('slack')).toBe(true);

      // Invalid IDs
      expect(isValidPluginId('SlackNotifier')).toBe(false);
      expect(isValidPluginId('slack_notifier')).toBe(false);
      expect(isValidPluginId('slack notifier')).toBe(false);
      expect(isValidPluginId('-leading-hyphen')).toBe(false);
      expect(isValidPluginId('trailing-hyphen-')).toBe(false);
      expect(isValidPluginId('double--hyphen')).toBe(false);

      expect(() =>
        validatePluginManifest({
          id: 'Invalid_ID',
          name: 'Invalid',
          version: '1.0.0',
        })
      ).toThrow();
    });

    it('rejects malformed SemVer strings', () => {
      const base = {
        id: 'test-plugin',
        name: 'Test',
        capabilities: ['ui:slots'],
      };

      expect(() => validatePluginManifest({ ...base, version: '1.0' })).toThrow();
      expect(() => validatePluginManifest({ ...base, version: 'v1.0.0' })).toThrow();
      expect(() => validatePluginManifest({ ...base, version: 'beta' })).toThrow();
      expect(() => validatePluginManifest({ ...base, version: '1.0.0-rc1' })).toThrow();
    });

    it('rejects unknown capabilities', () => {
      expect(() =>
        validatePluginManifest({
          id: 'test-plugin',
          name: 'Test',
          version: '1.0.0',
          capabilities: ['unknown:capability' as any],
        })
      ).toThrow();
    });
  });

  describe('PluginSlashCommandSchema', () => {
    it('accepts a valid declarative plugin slash command', () => {
      const cmd = {
        id: 'jira-issue',
        pluginId: 'jira-embed',
        label: 'Jira Issue',
        description: 'Embed a Jira ticket preview',
        keywords: ['jira', 'ticket', 'issue'],
        order: 10,
      };

      const parsed = PluginSlashCommandSchema.parse(cmd);
      expect(parsed.id).toBe('jira-issue');
      expect(parsed.pluginId).toBe('jira-embed');
    });

    it('strictly forbids overriding reserved core slash command IDs', () => {
      for (const coreId of CORE_SLASH_COMMAND_IDS) {
        expect(() =>
          PluginSlashCommandSchema.parse({
            id: coreId,
            pluginId: 'malicious-plugin',
            label: 'Override Core',
            description: 'Attempting to override core command',
          })
        ).toThrow(/conflicts with a reserved core command ID/);
      }
    });
  });

  describe('PluginStorage Schema & Key Validation', () => {
    it('validates supported scope formats', () => {
      expect(PluginStorageScopeSchema.safeParse('global').success).toBe(true);
      expect(
        PluginStorageScopeSchema.safeParse('space:550e8400-e29b-41d4-a716-446655440000').success
      ).toBe(true);
      expect(
        PluginStorageScopeSchema.safeParse('post:550e8400-e29b-41d4-a716-446655440000').success
      ).toBe(true);

      // Invalid scopes
      expect(PluginStorageScopeSchema.safeParse('user:123').success).toBe(false);
      expect(PluginStorageScopeSchema.safeParse('space:not-a-uuid').success).toBe(false);
      expect(PluginStorageScopeSchema.safeParse('').success).toBe(false);
    });

    it('enforces key length and character constraints', () => {
      expect(PluginStorageKeySchema.safeParse('webhookUrl').success).toBe(true);
      expect(PluginStorageKeySchema.safeParse('settings:api_key.v1').success).toBe(true);

      // Empty or too long
      expect(PluginStorageKeySchema.safeParse('').success).toBe(false);
      expect(PluginStorageKeySchema.safeParse('a'.repeat(201)).success).toBe(false);

      // Disallowed characters (e.g. whitespace or SQL injection chars)
      expect(PluginStorageKeySchema.safeParse('bad key with spaces').success).toBe(false);
      expect(PluginStorageKeySchema.safeParse('key;DROP TABLE').success).toBe(false);
    });
  });

  describe('PluginEvent Contracts', () => {
    it('validates core domain event types', () => {
      const validTypes = [
        'post:created',
        'post:submitted_for_review',
        'post:reviewed',
        'post:published',
        'space:created',
        'space:archived',
        'comment:created',
      ];

      for (const t of validTypes) {
        expect(PluginEventTypeSchema.safeParse(t).success).toBe(true);
      }

      expect(PluginEventTypeSchema.safeParse('user:deleted').success).toBe(false);
    });
  });
});
