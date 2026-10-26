import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { notifications, users } from '../db/schema.js';

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  href?: string;
};

/** Durable in-app delivery. This is deliberately separate from Hocuspocus/Yjs. */
export class NotificationService {
  constructor(private readonly db: Database) {}

  async create(input: NotificationInput) {
    const [notification] = await this.db.insert(notifications).values(input).returning();
    return notification;
  }

  async createMany(inputs: NotificationInput[]) {
    if (!inputs.length) return [];
    return this.db.insert(notifications).values(inputs).returning();
  }

  async notifyUsers(userIds: string[], input: Omit<NotificationInput, 'userId'>) {
    return this.createMany(userIds.filter((id, index) => userIds.indexOf(id) === index).map((userId) => ({ ...input, userId })));
  }

  async notifyAdminsAndModerators(input: Omit<NotificationInput, 'userId'>, excludeUserId?: string) {
    const recipients = await this.db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.role, ['admin', 'moderator']));
    return this.notifyUsers(recipients.map(({ id }) => id).filter((id) => id !== excludeUserId), input);
  }

  async markRead(userId: string, id: string) {
    const [notification] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification;
  }

  async markAllRead(userId: string) {
    return this.db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.userId, userId));
  }
}
