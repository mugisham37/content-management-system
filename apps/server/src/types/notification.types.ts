import { 
  NotificationType, 
  NotificationChannel, 
  NotificationStatus, 
  NotificationPriority 
} from '@prisma/client';

// =============================================================================
// NOTIFICATION INTERFACES
// =============================================================================

export interface INotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  data?: Record<string, any>;
  metadata?: Record<string, any>;
  expiresAt?: Date;
  scheduledAt?: Date;
  sentAt?: Date;
  readAt?: Date;
  archivedAt?: Date;
  clickedAt?: Date;
  actionUrl?: string;
  imageUrl?: string;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
  templateId?: string;
  batchId?: string;
  parentId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  template?: INotificationTemplate;
  analytics?: INotificationAnalytics[];
}

export interface INotificationTemplate {
  id: string;
  name: string;
  subject?: string;
  body: string;
  htmlContent?: string;
  type: NotificationType;
  channels: NotificationChannel[];
  variables: string[];
  isActive: boolean;
  conditions?: any;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationPreferences {
  id: string;
  userId: string;
  channels: Record<NotificationType, NotificationChannel[]>;
  quietHours?: {
    start: string;
    end: string;
    timezone: string;
  };
  frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
  categories: Record<string, boolean>;
  enabled: boolean;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationAnalytics {
  id: string;
  notificationId: string;
  userId?: string;
  event: string;
  timestamp: Date;
  metadata?: any;
  tenantId?: string;
}

export interface INotificationResponse {
  notifications: INotification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  pages: number;
  aggregations?: Record<string, any>;
}

export interface NotificationBatch {
  id: string;
  notifications: INotification[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  scheduledAt: Date;
  processedAt?: Date;
  errors?: string[];
}

export interface NotificationRule {
  id: string;
  name: string;
  description?: string;
  conditions: Record<string, any>;
  actions: Array<{
    type: 'create_notification' | 'send_email' | 'trigger_webhook';
    config: Record<string, any>;
  }>;
  isActive: boolean;
  priority: number;
  tenantId?: string;
}

export interface NotificationAnalytics {
  totalSent: number;
  totalRead: number;
  totalUnread: number;
  readRate: number;
  channelDistribution: Record<NotificationChannel, number>;
  typeDistribution: Record<NotificationType, number>;
  priorityDistribution: Record<NotificationPriority, number>;
  timeSeriesData: Array<{
    date: string;
    sent: number;
    read: number;
    clicked: number;
  }>;
  topUsers: Array<{
    userId: string;
    count: number;
    readRate: number;
  }>;
}

export interface NotificationServiceOptions {
  enableCache?: boolean;
  cacheTtl?: number;
  enableAudit?: boolean;
  enableAnalytics?: boolean;
  enableBatching?: boolean;
  enableTemplates?: boolean;
  enableRules?: boolean;
  enableRealtime?: boolean;
  enableDigest?: boolean;
  batchSize?: number;
  batchTimeout?: number;
  maxRetries?: number;
  enableDeduplication?: boolean;
  enableRateLimiting?: boolean;
  enablePersonalization?: boolean;
}

// =============================================================================
// RE-EXPORT PRISMA ENUMS FOR CONVENIENCE
// =============================================================================

export {
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
} from '@prisma/client';

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isNotificationType(value: string): value is NotificationType {
  return Object.values(NotificationType).includes(value as NotificationType);
}

export function isNotificationChannel(value: string): value is NotificationChannel {
  return Object.values(NotificationChannel).includes(value as NotificationChannel);
}

export function isNotificationStatus(value: string): value is NotificationStatus {
  return Object.values(NotificationStatus).includes(value as NotificationStatus);
}

export function isNotificationPriority(value: string): value is NotificationPriority {
  return Object.values(NotificationPriority).includes(value as NotificationPriority);
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type CreateNotificationInput = Omit<
  INotification,
  'id' | 'createdAt' | 'updatedAt' | 'sentAt' | 'readAt' | 'archivedAt' | 'clickedAt'
> & {
  userId: string | string[];
  batchable?: boolean;
  deduplicationKey?: string;
};

export type UpdateNotificationInput = Partial<
  Pick<
    INotification,
    'title' | 'message' | 'status' | 'priority' | 'channels' | 'data' | 'metadata' | 'expiresAt' | 'actionUrl' | 'imageUrl'
  >
>;

export type NotificationFilter = {
  userId?: string;
  status?: NotificationStatus | NotificationStatus[];
  type?: NotificationType | NotificationType[];
  priority?: NotificationPriority | NotificationPriority[];
  channels?: NotificationChannel | NotificationChannel[];
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  tenantId?: string;
  includeExpired?: boolean;
  includeRead?: boolean;
};

export type NotificationSort = {
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'status' | 'type';
  sortOrder?: 'asc' | 'desc';
};

export type NotificationPagination = {
  page?: number;
  limit?: number;
};

export type GetNotificationsParams = NotificationFilter & NotificationSort & NotificationPagination;
