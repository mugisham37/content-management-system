// =============================================================================
// REPOSITORIES INDEX
// =============================================================================
// Export all repositories for easy importing

export { BaseRepository } from './base.repository'
export { UserRepository } from './user.repository'
export { TenantRepository } from './tenant.repository'
export { ContentTypeRepository } from './content-type.repository'
export { ContentRepository } from './content.repository'
export { ContentVersionRepository } from './content-version.repository'
export { MediaRepository } from './media.repository'
export { WebhookRepository, WebhookDeliveryRepository } from './webhook.repository'
export { WorkflowRepository, WorkflowEntryRepository } from './workflow.repository'
export { ApiKeyRepository } from './api-key.repository'
export { FieldTypeRepository } from './field-type.repository'
export { TranslationRepository } from './translation.repository'
export { PluginRepository } from './plugin.repository'
export { RouteRepository } from './route.repository'

// Export repository types
export type {
  ContentTypeCreateInput,
  ContentTypeUpdateInput,
  ContentTypeWithRelations,
  FieldDefinition as RepositoryFieldDefinition
} from './content-type.repository'

export type {
  CreateFieldTypeInput,
  UpdateFieldTypeInput,
  FieldTypeFilters
} from './field-type.repository'
